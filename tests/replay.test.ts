import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { TERRARIUM_MAX_REPLAYS, TERRARIUM_REPLAY_RETENTION_MS } from '../src/replay.ts';
import { advance, loadState, newState, releaseBug, saveState, TERRARIUM_BUG_ACTION_INTERVAL_MS, water } from '../src/state.ts';
import { TerrariumWorld } from '../src/world.ts';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const start = Date.parse('2026-06-01T00:00:00Z');

it('moves every minute and records the actual movement, contact and capture scenes', () => {
  const state = newState(start);
  const prey = releaseBug(state, 'aphid', 4, 0);
  const hunter = releaseBug(state, 'beetle', 4, 2);
  advance(state, start + TERRARIUM_BUG_ACTION_INTERVAL_MS - 1, 'Asia/Shanghai');
  expect(hunter.y).toBe(2);
  advance(state, start + TERRARIUM_BUG_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(hunter.y).toBe(1);
  expect(state.replays).toBeUndefined();
  const changes = advance(state, start + 2 * TERRARIUM_BUG_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  const replay = state.replays![0];
  expect(changes.filter(change => change.kind === 'hunt')).toHaveLength(1);
  expect(replay).toMatchObject({ recordedAtMs: state.updatedAtMs, hunterId: hunter.id, preyId: prey.id });
  const [before, contact, after] = replay.frames;
  expect(before.bugs.find(bug => bug.id === hunter.id)).toMatchObject({ x: 4, y: 1 });
  expect(contact.bugs.find(bug => bug.id === hunter.id)).toMatchObject({ x: 4, y: 0 });
  expect(contact.bugs.find(bug => bug.id === prey.id)).toMatchObject({ x: 4, y: 0 });
  expect(after.bugs.some(bug => bug.id === prey.id)).toBe(false);
  expect(after.bugs.find(bug => bug.id === hunter.id)?.energy).toBeGreaterThan(contact.bugs.find(bug => bug.id === hunter.id)!.energy);
  const recorded = structuredClone(replay);
  water(state, 'clover'); hunter.x = 0;
  expect(replay).toEqual(recorded);
});

it('records the same hunt times during frequent polling and offline catch-up', () => {
  const state = newState(start + 3 * 60_000);
  releaseBug(state, 'aphid', 4, 0); releaseBug(state, 'beetle', 4, 2);
  const polled = structuredClone(state);
  const end = start + 30 * 60_000;
  advance(state, end, 'Asia/Shanghai');
  for (let now = polled.updatedAtMs + 60_000; now <= end; now += 60_000) advance(polled, now, 'Asia/Shanghai');
  expect(polled.bugs.map(({ id, x, y }) => ({ id, x, y }))).toEqual(state.bugs.map(({ id, x, y }) => ({ id, x, y })));
  expect(polled.replays?.map(replay => replay.recordedAtMs)).toEqual(state.replays?.map(replay => replay.recordedAtMs));
  expect(state.replays![0].recordedAtMs).toBe(start + 5 * TERRARIUM_BUG_ACTION_INTERVAL_MS);
});

it('bounds persisted replays, rejects corrupt scene data and expires old hunts', async () => {
  const state = newState(start);
  const hunter = releaseBug(state, 'spider', 4, 0);
  for (let i = 1; i <= TERRARIUM_MAX_REPLAYS + 4; i++) {
    hunter.energy = 60;
    releaseBug(state, 'aphid', 4, 0);
    advance(state, start + i * TERRARIUM_BUG_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  }
  expect(state.replays).toHaveLength(TERRARIUM_MAX_REPLAYS);
  expect(state.replays![0].recordedAtMs).toBe(start + 5 * TERRARIUM_BUG_ACTION_INTERVAL_MS);
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-replays-')); dirs.push(dir);
  const file = join(dir, 'state.json');
  await saveState(file, state);
  expect(await loadState(file, state.updatedAtMs)).toEqual(state);
  const invalid = JSON.parse(await readFile(file, 'utf8'));
  invalid.replays[0].frames[0].bugs[0].x = 5;
  await writeFile(file, JSON.stringify(invalid));
  await expect(loadState(file, state.updatedAtMs)).rejects.toThrow('Invalid terrarium state');
  advance(state, state.updatedAtMs + TERRARIUM_REPLAY_RETENTION_MS + 1, 'Asia/Shanghai');
  expect(state.replays).toEqual([]);
});

it('exposes replay availability and recorded scenes through World tools without filling inspection with frames', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-replay-world-')); dirs.push(dir);
  const file = join(dir, 'state.json');
  const state = newState(start);
  releaseBug(state, 'beetle', 4, 0); releaseBug(state, 'aphid', 4, 0);
  await saveState(file, state);
  const now = start + TERRARIUM_BUG_ACTION_INTERVAL_MS;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, stateFile: file, timezone: 'Asia/Shanghai', now: () => now });
  const events: unknown[] = [];
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { events.push(event); return event; } } as unknown as WorldHost;
  try {
    await world.start(host);
    const context = {} as ToolCallContext;
    const inspect = JSON.parse(String(await world.tools().find(tool => tool.name === 'terrarium_inspect')!.handler({ habitat: 'land' }, context)));
    const replay = world.tools().find(tool => tool.name === 'terrarium_replay')!;
    const summaries = JSON.parse(String(await replay.handler({}, context)));
    expect(inspect.replays).toMatchObject({ count: 1, latestId: summaries[0].id, tool: 'terrarium_replay' });
    expect(summaries[0].frames).toBeUndefined();
    const recorded = JSON.parse(String(await replay.handler({ id: summaries[0].id }, context)));
    expect(recorded.frames).toHaveLength(3);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'terrarium.hunt', text: expect.stringContaining(recorded.id) })]));
    await expect(replay.handler({ id: 'missing' }, context)).rejects.toThrow('Unknown or expired');
    const declaration = world.webUi();
    expect(await declaration.invoke!('garden', 'state', [])).toMatchObject({ claimed: true, state: { replays: [recorded] } });
  } finally { await world.stop(); }
});

it('uploads and retains recorded scenes through a real leaderboard server restart', async () => {
  const { start: startServer } = await import('../server/index.ts');
  const { LeaderboardClient } = await import('../src/leaderboard.ts');
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-replay-server-')); dirs.push(dir);
  const options = { port: 0, dataFile: join(dir, 'leaderboard.json'), credentialsFile: join(dir, 'server-credentials.json') };
  let server = await startServer(options);
  const url = () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    return 'http://127.0.0.1:' + address.port;
  };
  const state = newState(Date.now() - 2 * TERRARIUM_BUG_ACTION_INTERVAL_MS);
  releaseBug(state, 'beetle', 4, 2); releaseBug(state, 'aphid', 4, 0);
  advance(state, Date.now(), 'Asia/Shanghai');
  expect(state.replays).toHaveLength(1);
  const client = new LeaderboardClient({ url: url(), id: 'replay-box', credentialsFile: join(dir, 'client-credentials.json') });
  try {
    await client.report(state, 'day');
    const box = await (await fetch(url() + '/api/boxes/replay-box')).json();
    expect(box.state.replays).toEqual(state.replays);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = await startServer(options);
    const restored = await (await fetch(url() + '/api/boxes/replay-box')).json();
    expect(restored.state.replays).toEqual(state.replays);
    expect((await fetch(url() + '/api/reports', { method: 'PUT', body: 'x'.repeat(1048577) })).status).toBe(413);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
