import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import type { EventEnvelope, ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { start } from '../server/index.ts';
import { runAdmin } from '../server/admin.ts';
import { LeaderboardClient } from '../src/leaderboard.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { newState } from '../src/state.ts';
import type { Announcement } from '../src/announcements.ts';

const dirs: string[] = [], servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function service() {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-notice-')); dirs.push(dir);
  const options = { port: 0, dataFile: join(dir, 'service', 'leaderboard.json'), credentialsFile: join(dir, 'service', 'credentials.json') };
  const server = await start(options); servers.push(server);
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const url = `http://127.0.0.1:${address.port}`, tokenFile = join(dir, 'service', 'admin-token');
  const admin = (...args: string[]) => runAdmin([...args, '--server', url, '--token-file', tokenFile]);
  return { dir, options, server, url, tokenFile, admin };
}

it('authenticates administration and targeted reads, preserves legacy responses, and persists revocations and IDs', async () => {
  const { dir, options, server, url, tokenFile, admin } = await service();
  const first = new LeaderboardClient({ url, id: 'first-box', credentialsFile: join(dir, 'first.json') });
  const second = new LeaderboardClient({ url, id: 'second-box', credentialsFile: join(dir, 'second.json') });
  await first.report(newState(Date.now()), 'day'); await second.report(newState(Date.now()), 'day');
  expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
  const firstToken = (Object.values(JSON.parse(await readFile(join(dir, 'first.json'), 'utf8'))) as Array<{ token: string }>)[0].token;
  expect((await fetch(url + '/api/admin/announcements')).status).toBe(401);
  expect((await fetch(url + '/api/admin/announcements', { method: 'POST', body: '{"text":"bad"}', headers: { authorization: `Bearer ${firstToken}` } })).status).toBe(401);
  expect((await fetch(url + '/api/announcements?id=first-box')).status).toBe(401);
  expect((await fetch(url + '/api/announcements?id=second-box', { headers: { authorization: `Bearer ${firstToken}` } })).status).toBe(401);
  const broadcast = await admin('publish', '--title', '更新', '--text', '所有客户端可见') as { id: number };
  const targeted = await admin('publish', '--text', '仅第一箱', '--to', 'first-box') as { id: number };
  expect((await first.announcements(0)).announcements.map(notice => notice.id)).toEqual([broadcast.id, targeted.id]);
  expect((await second.announcements(0)).announcements.map(notice => notice.id)).toEqual([broadcast.id]);
  const publicPage = await (await fetch(url + '/api/announcements/public')).text();
  expect(publicPage).toContain('所有客户端可见'); expect(publicPage).not.toContain('仅第一箱'); expect(publicPage).not.toContain(firstToken);
  expect((await first.announcements(targeted.id)).announcements).toEqual([]);
  const report = await fetch(url + '/api/reports', { method: 'PUT', headers: { authorization: `Bearer ${firstToken}` }, body: JSON.stringify({ id: first.id, state: newState(Date.now()) }) });
  expect(Object.keys(await report.json())).toEqual(['score']);
  expect(Array.isArray(await (await fetch(url + '/api/leaderboard')).json())).toBe(true);
  for (const args of [['publish', '--text', 'x', '--to', 'unknown-box'], ['publish', '--text', ''], ['publish', '--text', 'x', '--expires-hours', '721']]) await expect(admin(...args)).rejects.toThrow();
  await admin('revoke', String(broadcast.id));
  expect((await second.announcements(0)).announcements).toEqual([]);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); servers.splice(servers.indexOf(server), 1);
  const restarted = await start({ ...options, port: Number(new URL(url).port) }); servers.push(restarted);
  expect((await first.announcements(0)).announcements.map(notice => notice.id)).toEqual([targeted.id]);
  const next = await admin('publish', '--text', '重启之后') as { id: number }; expect(next.id).toBeGreaterThan(targeted.id);
  const latest = await (await fetch(url + '/api/announcements/public?view=latest')).text(); expect(latest).toContain('重启之后'); expect(latest).not.toContain('所有客户端可见');
});

it('delivers broadcasts and targeted notices as external events, deduplicating both habitats and restarts', async () => {
  const { dir, url, admin } = await service();
  let now = Date.now() - 600000;
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: url }, stateFile: join(dir, 'deployment', 'land', 'state.json'), waterStateFile: join(dir, 'deployment', 'water', 'state.json'), timezone: 'Asia/Shanghai', now: () => now };
  const events: Array<Omit<EventEnvelope, 'cursor'>> = [], warnings: unknown[] = [];
  const host = { log: { warn: (...args: unknown[]) => warnings.push(args) }, async pushEvent(event: Omit<EventEnvelope, 'cursor'>) { events.push(event); return { ...event, cursor: events.length }; } } as unknown as WorldHost;
  const context = {} as ToolCallContext;
  let world = new TerrariumWorld(options);
  const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await world.tools().find(tool => tool.name === name)!.handler(args, context)));
  const notices = () => events.filter(event => event.type === 'terrarium.announcement');
  const beforeClaim = await admin('publish', '--title', '服务端通知', '--text', '认领前的广播\n第二行正文') as Announcement;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    await world.start(host); await vi.waitFor(() => expect(notices()).toHaveLength(1));
    const land = await call('terrarium_claim', { habitat: 'land' }), water = await call('terrarium_claim', { habitat: 'water' });
    expect(notices()).toHaveLength(1);
    const broadcast = await admin('publish', '--text', '同时持有两个箱子的广播') as Announcement;
    const targetedWater = await admin('publish', '--text', '给水箱', '--to', water.id) as Announcement;
    const other = new LeaderboardClient({ url, id: 'unrelated-box', credentialsFile: join(dir, 'other.json') }); await other.claim();
    await admin('publish', '--text', '别人的消息', '--to', other.id!);
    now += options.cfg.tickIntervalMs;
    await vi.advanceTimersByTimeAsync(10_000);
    await call('terrarium_inspect');
    expect(notices()).toHaveLength(3); expect(notices().map(notice => notice.text).join()).not.toContain('别人的消息');
    expect(notices().at(-1)!.text).toContain('给水箱');
    await world.stop(); world = new TerrariumWorld(options); await world.start(host); expect(notices()).toHaveLength(3);
    const targetedLand = await admin('publish', '--text', '给地箱', '--to', land.id) as Announcement;
    now += options.cfg.tickIntervalMs;
    await vi.advanceTimersByTimeAsync(10_000);
    await call('terrarium_inspect'); expect(notices()).toHaveLength(4);
    expect(notices()).toEqual([beforeClaim, broadcast, targetedWater, targetedLand].map(notice => expect.objectContaining({
      type: 'terrarium.announcement', source: 'terrarium', senderKey: 'terrarium.announcements', origin: 'external',
      text: `服务端公告 #${notice.id}${notice.title ? ` · ${notice.title}` : ''}（${notice.createdAt}）\n${notice.text}`,
    })));
    expect(warnings).toEqual([]);
    expect((await stat(join(dir, 'deployment', 'land', 'announcement-inbox.json'))).mode & 0o777).toBe(0o600);
  } finally { await world.stop(); vi.useRealTimers(); }
});

it('paginates past unrelated targets and falls back to servers without an announcement endpoint', async () => {
  const { dir, url, admin } = await service();
  const client = new LeaderboardClient({ url, id: 'paged-box', credentialsFile: join(dir, 'paged.json') }); await client.claim();
  for (let i = 0; i < 23; i++) await admin('publish', '--text', `公告 ${i}`);
  const first = await client.announcements(0), second = await client.announcements(first.nextCursor);
  expect(first.announcements).toHaveLength(20); expect(second.announcements).toHaveLength(3);
  expect(new Set([...first.announcements, ...second.announcements].map(notice => notice.id)).size).toBe(23);
  const server = createServer((_req, res) => { res.writeHead(404); res.end('{"error":"Not found"}'); }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const oldClient = new LeaderboardClient({ url: `http://127.0.0.1:${address.port}`, id: 'legacy-box', token: 'existing-token', credentialsFile: join(dir, 'legacy.json') });
  expect(await oldClient.announcements(0)).toEqual({ announcements: [], nextCursor: 0 });
});

it('excludes expired notices and rejects malformed announcement requests', async () => {
  const { dir, url, tokenFile, admin } = await service();
  const token = (await readFile(tokenFile, 'utf8')).trim();
  for (const value of [null, { text: 'x', targets: [] }, { text: 'x', targets: ['missing-box'] }, { text: 'x'.repeat(2001) }, { text: 'x', expiresAt: new Date(Date.now() - 1000).toISOString() }]) {
    expect((await fetch(url + '/api/admin/announcements', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(value) })).status).toBe(400);
  }
  expect((await fetch(url + '/api/announcements/public?after=-1')).status).toBe(400);
  await admin('publish', '--text', '仍然有效');
  const { AnnouncementStore } = await import('../server/announcements.ts');
  const storeFile = join(dir, 'expired.json'), store = new AnnouncementStore(storeFile);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(storeFile, JSON.stringify({ nextId: 3, announcements: [
    { id: 1, title: '', text: '过期内容', targets: 'all', createdAt: new Date(Date.now() - 2000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() },
    { id: 2, title: '', text: '有效内容', targets: 'all', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() },
  ] }));
  await store.restore(); expect(store.page(undefined, 0).announcements.map(notice => notice.text)).toEqual(['有效内容']);
  expect((await store.publish({ text: '新内容' }, () => true)).id).toBe(3);
  expect(JSON.parse(await readFile(storeFile, 'utf8')).announcements.map((notice: { id: number }) => notice.id)).toEqual([2, 3]);
});
