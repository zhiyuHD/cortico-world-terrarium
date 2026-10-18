import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { start } from '../server/index.ts';
import { FeedbackStore } from '../server/feedback.ts';
import { runAdmin } from '../server/admin.ts';
import { LeaderboardClient } from '../src/leaderboard.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { TERRARIUM_CLIENT_VERSION } from '../src/version.ts';
import { TERRARIUM_MAX_FEEDBACK, TERRARIUM_FEEDBACK_PAGE_SIZE, TERRARIUM_FEEDBACK_ANONYMOUS_LIMIT, TERRARIUM_FEEDBACK_BOX_LIMIT } from '../src/feedback.ts';
import { TerrariumWorld } from '../src/world.ts';

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-feedback-'));
  const options = { port: 0, dataFile: join(dir, 'leaderboard.json'), credentialsFile: join(dir, 'credentials.json') };
  let server = await start(options);
  const origin = () => { const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); return `http://127.0.0.1:${address.port}`; };
  const url = origin(), tokenFile = join(dir, 'admin-token');
  const post = (input: unknown, token?: string) => fetch(`${origin()}/api/feedback`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const admin = (...args: string[]) => runAdmin([...args, '--server', origin(), '--token-file', tokenFile]);
  disposals.push(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
  return { dir, url, post, admin, tokenFile, async restart() { await new Promise<void>(resolve => server.close(() => resolve())); server = await start(options); } };
}

it('persists private feedback, lists and resolves it only for administrators across restarts', async () => {
  const f = await fixture();
  const response = await f.post({ text: '  <script>example</script>\n建议  ', contact: ' contact@example.test ', source: 'web' });
  expect(response.status).toBe(201);
  const receipt = await response.json(); expect(Object.keys(receipt).sort()).toEqual(['createdAt', 'id']);
  expect((await stat(join(f.dir, 'feedback.json'))).mode & 0o777).toBe(0o600);
  expect((await fetch(f.url + '/api/feedback')).status).toBe(405);
  expect((await fetch(f.url + '/api/admin/feedback')).status).toBe(401);
  expect((await fetch(f.url + '/api/admin/feedback/1/resolve', { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  expect(await f.admin('feedback-list')).toMatchObject({ feedback: [{ id: receipt.id, text: '<script>example</script>\n建议', contact: 'contact@example.test', source: 'web' }], nextCursor: receipt.id });
  await f.restart();
  expect(await f.admin('feedback-resolve', String(receipt.id))).toEqual({ resolved: true });
  expect(await f.admin('feedback-resolve', String(receipt.id))).toEqual({ resolved: true });
  expect(await f.admin('feedback-list')).toMatchObject({ feedback: [{ id: receipt.id, resolvedAt: expect.any(String) }] });
  expect(await f.admin('feedback-list', '--after', String(receipt.id))).toEqual({ feedback: [], nextCursor: receipt.id });
});

it('rejects invalid feedback and forged box identity without storing it', async () => {
  const f = await fixture();
  for (const input of [null, [], { text: '' }, { text: ' '.repeat(4) }, { text: 'a'.repeat(2001) }, { text: '\u001b[31m' }, { text: 'ok', contact: 'x'.repeat(201) }, { text: 'ok', source: 'admin' }, { text: 'ok', source: ['web'] }, { text: 'ok', clientVersion: 'bad' }]) expect((await f.post(input)).status).toBe(400);
  expect((await f.post({ id: 'not-registered', text: 'forged' }, 'wrong')).status).toBe(401);
  expect((await f.post({ text: 'token without id' }, 'wrong')).status).toBe(401);
  expect((await f.post({ text: 'x'.repeat(20000) })).status).toBe(413);
  expect(await f.admin('feedback-list')).toEqual({ feedback: [], nextCursor: 0 });
  await expect(stat(join(f.dir, 'feedback.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('enforces the anonymous submission limit under concurrent requests and after restarting', async () => {
  const f = await fixture();
  const responses = await Promise.all(Array.from({ length: TERRARIUM_FEEDBACK_ANONYMOUS_LIMIT + 1 }, (_, i) => f.post({ text: `feedback-${i}` })));
  expect(responses.filter(response => response.status === 201)).toHaveLength(TERRARIUM_FEEDBACK_ANONYMOUS_LIMIT);
  expect(responses.filter(response => response.status === 429)).toHaveLength(1);
  const listed = await f.admin('feedback-list') as { feedback: Array<{ id: number }> };
  expect(new Set(listed.feedback.map(item => item.id)).size).toBe(TERRARIUM_FEEDBACK_ANONYMOUS_LIMIT);
  await f.restart(); expect((await f.post({ text: 'retry' })).status).toBe(429);
});

it('reuses existing credentials for associated feedback and enforces a separate per-box limit', async () => {
  const f = await fixture();
  const client = new LeaderboardClient({ url: f.url, id: '', credentialsFile: join(f.dir, 'client.json') });
  const id = await client.claim(), before = await readFile(join(f.dir, 'credentials.json'), 'utf8');
  for (let i = 0; i < TERRARIUM_FEEDBACK_BOX_LIMIT; i++) await client.feedback({ text: `box-${i}` }, 'ai');
  await expect(client.feedback({ text: 'limited' }, 'ai')).rejects.toThrow('limit');
  expect((await f.post({ text: 'anonymous still allowed' })).status).toBe(201);
  expect(await f.admin('feedback-list')).toMatchObject({ feedback: [
    ...Array.from({ length: TERRARIUM_FEEDBACK_BOX_LIMIT }, () => ({ boxId: id, source: 'ai', clientVersion: TERRARIUM_CLIENT_VERSION })),
    { source: 'web' },
  ] });
  expect(await readFile(join(f.dir, 'credentials.json'), 'utf8')).toBe(before);
});

it('submits through the AI tool and World panel without claiming boxes or exposing credentials', async () => {
  const f = await fixture();
  const file = join(f.dir, 'world', 'land', 'state.json');
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: f.url }, timezone: 'UTC', stateFile: file });
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  await world.start(host);
  try {
    const tool = world.tools().find(tool => tool.name === 'terrarium_feedback')!;
    const receipt = JSON.parse(String(await tool.handler({ text: 'AI suggestion' }, {} as ToolCallContext)));
    expect(receipt).toMatchObject({ id: 1 });
    expect(await world.webUi().invoke!('water', 'feedback', [{ text: 'panel suggestion', contact: 'optional' }])).toMatchObject({ id: 2 });
    expect(await f.admin('feedback-list')).toMatchObject({ feedback: [{ source: 'ai', clientVersion: TERRARIUM_CLIENT_VERSION }, { source: 'world' }] });
    const listed = await f.admin('feedback-list') as { feedback: object[] };
    expect(listed.feedback.every(item => !Object.hasOwn(item, 'boxId'))).toBe(true);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(f.dir, 'world', 'land', 'report-credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(f.dir, 'credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await world.stop(); }
});

it('reports feedback unavailable on older or disabled servers without registering', async () => {
  const f = await fixture();
  const { createServer } = await import('node:http');
  const old = createServer((_req, res) => { res.writeHead(404); res.end('{}'); });
  await new Promise<void>(resolve => old.listen(0, '127.0.0.1', resolve));
  const address = old.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const legacy = new LeaderboardClient({ url: `http://127.0.0.1:${address.port}`, id: '', credentialsFile: join(f.dir, 'legacy.json') });
  try { await expect(legacy.feedback({ text: 'suggestion' }, 'ai')).rejects.toThrow('upgrade the server'); }
  finally { await new Promise<void>(resolve => old.close(() => resolve())); }
  const disabled = new LeaderboardClient({ url: '', id: '', credentialsFile: join(f.dir, 'disabled.json') });
  await expect(disabled.feedback({ text: 'suggestion' }, 'ai')).rejects.toThrow('unavailable');
  expect(legacy.id).toBeUndefined();
});

it('keeps a bounded inbox and replaces resolved entries while keeping IDs and pagination monotonic', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-feedback-capacity-'));
  disposals.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'feedback.json');
  const rows = Array.from({ length: TERRARIUM_MAX_FEEDBACK }, (_, i) => ({ id: i + 1, text: 'suggestion', createdAt: '2020-01-01T00:00:00.000Z', source: 'web' }));
  await writeFile(file, JSON.stringify({ nextId: TERRARIUM_MAX_FEEDBACK + 1, feedback: rows }));
  const store = new FeedbackStore(file); await store.restore();
  await expect(store.submit({ text: 'full' })).rejects.toMatchObject({ status: 503 });
  expect(store.list().feedback).toHaveLength(TERRARIUM_FEEDBACK_PAGE_SIZE);
  await store.resolve(1);
  expect(await store.submit({ text: 'new' })).toMatchObject({ id: TERRARIUM_MAX_FEEDBACK + 1 });
  expect(store.list().feedback[0].id).toBe(2);
  expect(store.list(TERRARIUM_MAX_FEEDBACK)).toMatchObject({ feedback: [{ id: TERRARIUM_MAX_FEEDBACK + 1 }], nextCursor: TERRARIUM_MAX_FEEDBACK + 1 });
  const restored = new FeedbackStore(file); await restored.restore();
  expect(restored.list(TERRARIUM_MAX_FEEDBACK)).toEqual(store.list(TERRARIUM_MAX_FEEDBACK));
});
