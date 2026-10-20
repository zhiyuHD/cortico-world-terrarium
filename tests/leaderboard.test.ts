import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { EventEnvelope, ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { start } from '../server/index.ts';
import { LeaderboardClient } from '../src/leaderboard.ts';
import { newState } from '../src/state.ts';
import { newAquarium, stockFish } from '../src/aquarium.ts';
import { score, type LeaderboardSummary } from '../src/scoring.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function service() {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-auth-')); dirs.push(dir);
  const credentialsFile = join(dir, 'server', 'credentials.json');
  const options = { port: 0, dataFile: join(dir, 'server', 'leaderboard.json'), credentialsFile };
  const server = await start(options); servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  return { server, options, url: `http://127.0.0.1:${address.port}`, dir, credentialsFile };
}

it('registers without an ID, saves private credentials and reuses them after client restart', async () => {
  const { url, dir, credentialsFile } = await service();
  const localFile = join(dir, 'client', 'report-credentials.json');
  const options = { url, id: '', credentialsFile: localFile };
  const state = newState(Date.now());
  await new LeaderboardClient(options).report(state, 'day');
  const saved = JSON.parse(await readFile(localFile, 'utf8')) as Record<string, { id: string; token: string }>;
  const credentials = Object.values(saved)[0];
  expect(credentials.id).toMatch(/^box-/);
  expect((await stat(localFile)).mode & 0o777).toBe(0o600);
  expect((await stat(credentialsFile)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(credentialsFile, 'utf8'))).toEqual({ [credentials.id]: credentials.token });
  await new LeaderboardClient(options).report(state, 'night');
  expect(JSON.parse(await readFile(localFile, 'utf8'))).toEqual(saved);
  const response = await (await fetch(url + '/api/leaderboard')).text();
  expect(response).not.toContain(credentials.token);
  expect(JSON.parse(response)).toMatchObject([{ id: credentials.id, phase: 'night' }]);
});

it('forces automatic registration even when a legacy ID contains a server URL', async () => {
  const { url, dir } = await service();
  const options = { url, id: 'https://boxes.example.test', automaticIds: true, credentialsFile: join(dir, 'client/credentials.json') };
  const client = new LeaderboardClient(options), id = await client.claim();
  expect(id).toMatch(/^box-/);
  const saved = JSON.parse(await readFile(options.credentialsFile, 'utf8'));
  expect(Object.keys(saved)).toEqual([url + '/auto']);
  expect(saved[url + '/auto'].id).toBe(id);
  expect(await new LeaderboardClient(options).claim()).toBe(id);
});

it('migrates saved named identities to automatic keys without registering again or changing their token', async () => {
  const { url, dir, credentialsFile } = await service();
  const localFile = join(dir, 'client/credentials.json');
  const original = new LeaderboardClient({ url, id: 'existing-land', credentialsFile: localFile });
  const state = newState(Date.now()); await original.report(state, 'day'); original.close();
  const before = JSON.parse(await readFile(localFile, 'utf8')), serverBefore = await readFile(credentialsFile, 'utf8');
  const options = { url, id: '', automaticIds: true, credentialsFile: localFile };
  const migrated = new LeaderboardClient(options); await migrated.restore();
  expect(migrated.id).toBe('existing-land');
  const after = JSON.parse(await readFile(localFile, 'utf8'));
  expect(after[url + '/auto']).toEqual(before[url + '/id/existing-land']);
  expect(after[url + '/id/existing-land']).toEqual(before[url + '/id/existing-land']);
  expect((await stat(localFile)).mode & 0o777).toBe(0o600);
  await migrated.report(state, 'night'); migrated.close();
  expect(await new LeaderboardClient(options).claim()).toBe('existing-land');
  expect(await readFile(credentialsFile, 'utf8')).toBe(serverBefore);
});

it('uses the legacy selection when several identities were saved and refuses an ambiguous migration', async () => {
  const { url, dir, credentialsFile } = await service(), localFile = join(dir, 'client/credentials.json');
  for (const id of ['first-land', 'second-land']) await new LeaderboardClient({ url, id, credentialsFile: localFile }).claim();
  const before = await readFile(localFile, 'utf8'), serverBefore = await readFile(credentialsFile, 'utf8');
  const options = { url, id: '', automaticIds: true, credentialsFile: localFile };
  await expect(new LeaderboardClient(options).claim()).rejects.toThrow('Multiple saved leaderboard identities');
  expect(await readFile(localFile, 'utf8')).toBe(before); expect(await readFile(credentialsFile, 'utf8')).toBe(serverBefore);
  expect(await new LeaderboardClient({ ...options, id: 'second-land' }).claim()).toBe('second-land');
  expect(await new LeaderboardClient({ ...options, id: 'first-land' }).claim()).toBe('second-land');
});

it('persists legacy supplied credentials once and then reuses them without the old ID or secret', async () => {
  const { url, dir, credentialsFile } = await service();
  const old = new LeaderboardClient({ url, id: 'supplied-land', credentialsFile: join(dir, 'original.json') }); await old.claim();
  const serverBefore = await readFile(credentialsFile, 'utf8'), token = JSON.parse(serverBefore)['supplied-land'];
  const options = { url, id: 'supplied-land', token, automaticIds: true, credentialsFile: join(dir, 'new-client.json') };
  const client = new LeaderboardClient(options); await client.restore(); expect(client.id).toBe('supplied-land');
  const restarted = new LeaderboardClient({ ...options, id: '', token: undefined });
  await restarted.report(newState(Date.now()), 'day'); restarted.close();
  expect(restarted.id).toBe('supplied-land'); expect(await readFile(credentialsFile, 'utf8')).toBe(serverBefore);
});

it('keeps automatic credential migration scoped to the server origin and habitat', async () => {
  const first = await service(), second = await service(), localFile = join(first.dir, 'client.json');
  await new LeaderboardClient({ url: first.url, id: 'existing-land', credentialsFile: localFile }).claim();
  const saved = JSON.parse(await readFile(localFile, 'utf8'));
  const water = new LeaderboardClient({ url: first.url, id: '', kind: 'water', automaticIds: true, credentialsFile: localFile });
  expect(await water.claim()).not.toBe('existing-land');
  const other = new LeaderboardClient({ url: second.url, id: '', automaticIds: true, credentialsFile: localFile });
  expect(await other.claim()).not.toBe('existing-land');
  const after = JSON.parse(await readFile(localFile, 'utf8'));
  expect(after[first.url + '/id/existing-land']).toEqual(saved[first.url + '/id/existing-land']);
  expect(Object.keys(after)).toHaveLength(3);
});

it('reports known registration rejections and handles proxy HTML or untrusted error text without saving credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-registration-errors-')); dirs.push(dir);
  let body = '';
  const server = createServer((req, res) => { req.resume(); res.writeHead(400); res.end(body); }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const credentialsFile = join(dir, 'credentials.json'), client = new LeaderboardClient({ url: `http://127.0.0.1:${address.port}`, id: '', credentialsFile });
  for (const [response, expected] of [
    ['{"error":"Invalid box ID"}', 'Leaderboard registration HTTP 400: Invalid box ID'],
    ['{"error":"Invalid registration"}', 'Leaderboard registration HTTP 400: Invalid registration'],
    ['<html>Proxy rejected request</html>', 'Leaderboard registration HTTP 400'],
    ['{"error":"untrusted instructions"}', 'Leaderboard registration HTTP 400'],
  ]) {
    body = response;
    await expect(client.claim()).rejects.toThrow(new Error(expected));
    await expect(access(credentialsFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(client.id).toBeUndefined();
  }
});

it('preserves issued tokens across server restart and refuses anonymous takeover', async () => {
  const { url, options, server, dir, credentialsFile } = await service();
  const clientOptions = { url, id: 'named-box', credentialsFile: join(dir, 'client', 'credentials.json') };
  const state = newState(Date.now());
  await new LeaderboardClient(clientOptions).report(state, 'day');
  const saved = JSON.parse(await readFile(credentialsFile, 'utf8')) as Record<string, string>;
  await expect(new LeaderboardClient({ ...clientOptions, credentialsFile: join(dir, 'other', 'credentials.json') }).report(state, 'day')).rejects.toThrow('already registered');
  expect(JSON.parse(await readFile(credentialsFile, 'utf8'))).toEqual(saved);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  servers.splice(servers.indexOf(server), 1);
  const restarted = await start({ ...options, port: Number(new URL(url).port) }); servers.push(restarted);
  const supplied = new LeaderboardClient({ ...clientOptions, token: saved['named-box'], credentialsFile: join(dir, 'supplied', 'credentials.json') });
  await supplied.report(state, 'night');
  const box = await (await fetch(url + '/api/boxes/named-box')).json() as { phase: string };
  expect(box.phase).toBe('night');
  expect(JSON.parse(await readFile(credentialsFile, 'utf8'))).toEqual(saved);
  await new LeaderboardClient(clientOptions).report(state, 'day');
});

it('keeps credentials for each server when the service address changes', async () => {
  const first = await service();
  const second = await service();
  const credentialsFile = join(first.dir, 'client', 'credentials.json');
  const state = newState(Date.now());
  const options = { url: first.url, id: 'shared-name', credentialsFile };
  await new LeaderboardClient(options).report(state, 'day');
  await new LeaderboardClient({ ...options, url: second.url }).report(state, 'day');
  await new LeaderboardClient(options).report(state, 'night');
  const saved = Object.values(JSON.parse(await readFile(credentialsFile, 'utf8'))) as Array<{ id: string; token: string }>;
  expect(saved).toHaveLength(2);
  expect(saved[0].token).not.toBe(saved[1].token);
});

it('allows one concurrent registration per ID and validates registration bodies', async () => {
  const { url, credentialsFile } = await service();
  const register = (body: string) => fetch(url + '/api/registrations', { method: 'POST', body });
  const results = await Promise.all([register('{"id":"claimed"}'), register('{"id":"claimed"}')]);
  expect(results.map(response => response.status).sort()).toEqual([201, 409]);
  const issued = await results.find(response => response.status === 201)!.json() as { id: string; token: string };
  expect(JSON.parse(await readFile(credentialsFile, 'utf8'))).toEqual({ [issued.id]: issued.token });
  expect((await register('{"id":"bad name"}')).status).toBe(400);
  expect((await register('null')).status).toBe(400);
  expect((await register('{"id":"another","token":"override"}')).status).toBe(400);
  expect((await register('x'.repeat(1025))).status).toBe(413);
  const report = await fetch(url + '/api/reports', { method: 'PUT', headers: { authorization: `Bearer ${issued.token}` }, body: JSON.stringify({ id: issued.id, state: newState(Date.now()) }) });
  expect(report.status).toBe(200);
});

it('persists renamed boxes across World restarts without changing credentials', async () => {
  const { TerrariumWorld } = await import('../src/world.ts');
  const { TERRARIUM_DEFAULTS } = await import('../src/config.ts');
  const { saveState } = await import('../src/state.ts');
  const { url, dir } = await service();
  const now = Date.now();
  const stateFile = join(dir, 'deployment', 'terrarium', 'state.json');
  await saveState(stateFile, newState(now - 60_000));
  const warnings: unknown[] = [];
  const events: Array<Omit<EventEnvelope, 'cursor'>> = [];
  const host = {
    log: { warn: (...args: unknown[]) => { warnings.push(args); } },
    async pushEvent(event: Omit<EventEnvelope, 'cursor'>) { events.push(event); return { ...event, cursor: events.length } as EventEnvelope; },
  } as unknown as WorldHost;
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: url, rankAlertMinDrop: 1, rankAlertCooldownMinutes: 0 }, stateFile, timezone: 'Asia/Shanghai', now: () => now };
  const world = new TerrariumWorld(options);
  try {
    await world.start(host);
    const credentialsFile = join(dir, 'deployment', 'terrarium', 'report-credentials.json');
    const saved = JSON.parse(await readFile(credentialsFile, 'utf8')) as Record<string, { id: string; token: string }>;
    const issued = Object.values(saved)[0];
    expect((await fetch(url + '/api/boxes/' + issued.id)).status).toBe(200);
    const callContext = {} as ToolCallContext;
    const rename = world.tools().find(tool => tool.name === 'terrarium_rename')!;
    const name = '  苔藓与星光 🌱  ';
    expect(JSON.parse(String(await rename.handler({ name }, callContext)))).toEqual({ name: name.trim() });
    const inspect = world.tools().find(tool => tool.name === 'terrarium_inspect')!;
    expect(JSON.parse(String(await inspect.handler({ habitat: 'land' }, callContext))).name).toBe(name.trim());
    expect(await (await fetch(url + '/api/boxes/' + issued.id)).json()).toMatchObject({ id: issued.id, state: { name: name.trim() } });
    expect(await (await fetch(url + '/api/leaderboard')).json()).toMatchObject([{ id: issued.id, state: { name: name.trim() } }]);
    for (const invalid of ['', '   ', 'a\nb', 'a'.repeat(65), 123]) {
      await expect(rename.handler({ name: invalid }, callContext)).rejects.toThrow('Name must');
    }
    expect(JSON.parse(String(await inspect.handler({ habitat: 'land' }, callContext))).name).toBe(name.trim());

    await world.stop();
    const restarted = new TerrariumWorld({ ...options, now: () => now + 60_000 });
    try {
      await restarted.start(host);
      expect(JSON.parse(await readFile(credentialsFile, 'utf8'))).toEqual(saved);
      expect(JSON.parse(String(await restarted.tools().find(tool => tool.name === 'terrarium_inspect')!.handler({ habitat: 'land' }, callContext))).name).toBe(name.trim());
      const second = new LeaderboardClient({ url, id: 'another-box', credentialsFile: join(dir, 'another-client.json') });
      const duplicate = newState(now);
      duplicate.name = name.trim();
      await second.report(duplicate, 'day');
      expect((await (await fetch(url + '/api/leaderboard')).json()).map((entry: { state: { name: string } }) => entry.state.name)).toEqual([name.trim(), name.trim()]);
      expect(warnings).toEqual([]);
    } finally { await restarted.stop(); }
  } finally { await world.stop(); }
});

it('persists concurrent reports from different boxes', async () => {
  const { url, dir, options } = await service();
  const ids = ['first-box', 'second-box', 'third-box'];
  const state = newState(Date.now());
  await Promise.all(ids.map(id => new LeaderboardClient({ url, id, credentialsFile: join(dir, id, 'credentials.json') }).report(state, 'day')));
  const saved = JSON.parse(await readFile(options.dataFile, 'utf8'));
  expect(Object.keys(saved).sort()).toEqual([...ids].sort());
  const leaderboard = await (await fetch(url + '/api/leaderboard')).json() as Array<{ id: string }>;
  expect(leaderboard.map(box => box.id).sort()).toEqual([...ids].sort());
});

async function rankingService(initial?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-ranking-')); dirs.push(dir);
  const dataFile = join(dir, 'leaderboard.json'), credentialsFile = join(dir, 'server-credentials.json');
  if (initial) await writeFile(dataFile, JSON.stringify(initial));
  const server = await start({ port: 0, dataFile, credentialsFile }); servers.push(server);
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  return { dir, server, credentialsFile, url: `http://127.0.0.1:${address.port}` };
}
const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
const context = {} as ToolCallContext;

it('reads both rankings before claiming and preserves each claimed identity through reads and restart', async () => {
  const { dir, server, credentialsFile, url } = await rankingService();
  let registrations = 0;
  const readHeaders: Array<string | undefined> = [];
  server.on('request', req => { if (req.method === 'POST') registrations++; if (req.method === 'GET' && req.url?.startsWith('/api/leaderboard')) readHeaders.push(req.headers.authorization); });
  const now = Date.now(), stateFile = join(dir, 'deployment', 'land', 'state.json'), waterStateFile = join(dir, 'deployment', 'water', 'state.json');
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: url, rankAlertMinDrop: 1, rankAlertCooldownMinutes: 0 }, stateFile, waterStateFile, timezone: 'Asia/Shanghai', now: () => now };
  let world = new TerrariumWorld(options);
  const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await world.tools().find(tool => tool.name === name)!.handler(args, context)));
  try {
    await world.start(host);
    expect(await call('terrarium_leaderboard')).toEqual({ habitat: 'land', total: 0, entries: [], own: null });
    expect(await call('terrarium_leaderboard', { habitat: 'water' })).toEqual({ habitat: 'water', total: 0, entries: [], own: null });
    expect(registrations).toBe(0);
    await expect(access(options.stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(credentialsFile)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const args of [{ habitat: 'other' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }]) await expect(call('terrarium_leaderboard', args)).rejects.toThrow();
    const land = await call('terrarium_claim', { habitat: 'land', name: '小园' });
    const water = await call('terrarium_claim', { habitat: 'water', name: '水庭' });
    const landFile = join(dir, 'deployment', 'land', 'report-credentials.json'), waterFile = join(dir, 'deployment', 'water', 'report-credentials.json');
    const saved = await Promise.all([readFile(landFile, 'utf8'), readFile(waterFile, 'utf8')]);
    const grown = newState(now); grown.plants.forEach(plant => { plant.stage = 3; plant.health = 100; plant.moisture = 100; });
    await new LeaderboardClient({ url, id: 'land-leader', credentialsFile: join(dir, 'competitor-land.json') }).report(grown, 'day');
    const aquarium = newAquarium(now); stockFish(aquarium, 'guppy', 2, 2);
    await new LeaderboardClient({ url, id: 'water-leader', kind: 'water', credentialsFile: join(dir, 'competitor-water.json') }).report(aquarium, 'day');
    const registered = registrations;
    for (const [habitat, ownId, leader] of [['land', land.id, 'land-leader'], ['water', water.id, 'water-leader']]) {
      const ranking = await call('terrarium_leaderboard', { habitat, limit: 1 }) as LeaderboardSummary;
      expect(ranking).toMatchObject({ habitat, total: 2, entries: [{ rank: 1, id: leader }], own: { rank: 2, id: ownId } });
      expect(ranking.entries).toHaveLength(1);
      expect(Object.values(ranking.own!.scoreParts).reduce((sum, n) => sum + n, 0)).toBe(ranking.own!.score);
      expect(ranking.entries[0]).not.toHaveProperty('state');
      for (const json of saved) for (const credential of Object.values(JSON.parse(json)) as Array<{ token: string }>) expect(JSON.stringify(ranking)).not.toContain(credential.token);
    }
    await world.stop(); world = new TerrariumWorld(options); await world.start(host);
    expect(await call('terrarium_leaderboard', { habitat: 'land' })).toMatchObject({ own: { id: land.id, rank: 2 } });
    expect(await call('terrarium_leaderboard', { habitat: 'water' })).toMatchObject({ own: { id: water.id, rank: 2 } });
    expect(registrations).toBe(registered);
    expect(readHeaders.every(header => header === undefined)).toBe(true);
    expect(await Promise.all([readFile(landFile, 'utf8'), readFile(waterFile, 'utf8')])).toEqual(saved);
  } finally { await world.stop(); }
});

it('returns own rank beyond the top 100 and retains the original public gallery response', async () => {
  const state = newState(Date.now());
  const initial = Object.fromEntries(Array.from({ length: 101 }, (_, i) => {
    const id = `rank-${String(i + 1).padStart(3, '0')}`;
    return [id, { id, kind: 'land', state, score: score(state), reportedAt: new Date(state.updatedAtMs).toISOString() }];
  }));
  const { url, dir } = await rankingService(initial);
  const client = new LeaderboardClient({ url, id: 'rank-101', token: 'existing-private-token', credentialsFile: join(dir, 'unused.json') });
  const result = await client.leaderboard(100);
  expect(result.total).toBe(101); expect(result.entries).toHaveLength(100); expect(result.own).toMatchObject({ id: 'rank-101', rank: 101, score: score(state) });
  expect(result.entries[0].rank).toBe(1); expect(result.entries.at(-1)!.rank).toBe(100);
  const gallery = await (await fetch(url + '/api/leaderboard?kind=land')).json();
  expect(gallery).toHaveLength(100); expect(gallery[0].state).toEqual(state);
  for (const query of ['view=summary', 'view=summary&kind=water&limit=0', 'view=summary&kind=land&limit=101', 'view=summary&kind=land&ownId=bad%20id']) expect((await fetch(url + '/api/leaderboard?' + query)).status).toBe(400);
  expect(await client.leaderboard(1)).toMatchObject({ total: 101, entries: [{ id: 'rank-001' }], own: { rank: 101 } });
  await expect(access(join(dir, 'unused.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reports disabled rankings without creating a box or credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-ranking-disabled-')); dirs.push(dir);
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, stateFile: join(dir, 'land', 'state.json'), timezone: 'Asia/Shanghai' });
  try {
    await world.start(host);
    await expect(world.tools().find(tool => tool.name === 'terrarium_leaderboard')!.handler({}, context)).rejects.toThrow('Leaderboard is disabled');
    await expect(access(join(dir, 'land', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await world.stop(); }
});

it('emits rank drops once per habitat, persists baselines and opt-outs, and silently re-enables alerts', async () => {
  const { dir, url, server } = await rankingService();
  let now = Date.now() - 20 * 60_000, failReads = false, rankingReads = 0;
  server.prependListener('request', (req, res) => {
    if (req.method === 'GET' && req.url?.includes('view=summary')) {
      rankingReads++;
      if (failReads) res.destroy();
    }
  });
  const events: Array<Omit<EventEnvelope, 'cursor'>> = [], warnings: unknown[] = [];
  const host = { log: { warn: (...args: unknown[]) => warnings.push(args) }, async pushEvent(event: Omit<EventEnvelope, 'cursor'>) { events.push(event); return { ...event, cursor: events.length }; } } as unknown as WorldHost;
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: url, rankAlertMinDrop: 1, rankAlertCooldownMinutes: 0 }, stateFile: join(dir, 'land', 'state.json'), waterStateFile: join(dir, 'water', 'state.json'), timezone: 'Asia/Shanghai', now: () => now };
  let world = new TerrariumWorld(options);
  const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await world.tools().find(tool => tool.name === name)!.handler(args, context)));
  const alerts = () => events.filter(event => event.type === 'terrarium.overtaken');
  const tick = async () => {
    now += options.cfg.tickIntervalMs;
    await vi.advanceTimersByTimeAsync(10_000);
    await call('terrarium_inspect');
  };
  const landLeader = new LeaderboardClient({ url, id: 'land-rival', credentialsFile: join(dir, 'rival-land.json') });
  const waterLeader = new LeaderboardClient({ url, id: 'water-rival', kind: 'water', credentialsFile: join(dir, 'rival-water.json') });
  const reportLand = async (state: ReturnType<typeof newState>) => { state.updatedAtMs = now; await landLeader.report(state, 'day'); };
  const reportWater = async (state: ReturnType<typeof newAquarium>) => { state.updatedAtMs = now; await waterLeader.report(state, 'day'); };
  const grown = newState(now); grown.plants.forEach(plant => { plant.stage = 3; plant.health = 100; plant.moisture = 100; });
  const aquarium = newAquarium(now); stockFish(aquarium, 'guppy', 2, 2);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    await world.start(host);
    expect(rankingReads).toBe(0);
    await call('terrarium_claim', { habitat: 'land' });
    await call('terrarium_claim', { habitat: 'water' });
    expect(alerts()).toEqual([]);
    expect(rankingReads).toBe(0);
    await tick(); // Establish baselines on scheduled polling after claiming.
    await reportLand(grown); await reportWater(aquarium);
    const reads = rankingReads;
    await call('terrarium_inspect');
    expect(rankingReads).toBe(reads);
    expect(alerts()).toEqual([]);
    failReads = true; await tick();
    expect(alerts()).toEqual([]); expect(warnings.length).toBeGreaterThan(0);
    failReads = false; await tick();
    expect(alerts()).toHaveLength(2);
    expect(alerts().map(event => event.senderKey)).toEqual(['terrarium', 'terrarium.water']);
    for (const [index, habitat] of ['land', 'water'].entries()) {
      expect(alerts()[index].text).toContain('第 1 名降至第 2 名');
      expect(alerts()[index].text).toContain(`terrarium_set_rank_alerts({"habitat":"${habitat}","enabled":false})`);
    }
    await tick(); expect(alerts()).toHaveLength(2);
    await world.stop(); world = new TerrariumWorld(options); await world.start(host);
    expect(alerts()).toHaveLength(2);
    expect(await call('terrarium_set_rank_alerts', { enabled: false })).toEqual({ habitat: 'land', enabled: false });
    const poorLand = newState(now); poorLand.plants = []; poorLand.bugs = []; poorLand.seeds = [];
    const poorWater = newAquarium(now); poorWater.plants = []; poorWater.oxygen = 0; poorWater.cleanliness = 0;
    await reportLand(poorLand); await reportWater(poorWater); await tick();
    await world.stop(); world = new TerrariumWorld(options); await world.start(host);
    await reportLand(grown); await reportWater(aquarium); await tick();
    expect(alerts()).toHaveLength(3); expect(alerts().at(-1)!.senderKey).toBe('terrarium.water');
    expect(JSON.parse(await readFile(join(dir, 'land', 'rank-alerts.json'), 'utf8'))).toEqual({ enabled: false });
    expect(await call('terrarium_set_rank_alerts', { enabled: true })).toEqual({ habitat: 'land', enabled: true });
    await tick(); expect(alerts()).toHaveLength(3);
    await reportLand(poorLand); await tick();
    await reportLand(grown); await tick();
    expect(alerts()).toHaveLength(4); expect(alerts().at(-1)!.senderKey).toBe('terrarium');
    for (const args of [{ enabled: 'false' }, { enabled: false, habitat: 'bad' }, {}]) await expect(call('terrarium_set_rank_alerts', args)).rejects.toThrow();
  } finally { await world.stop(); vi.useRealTimers(); }
});

it('can disable reminders before claiming without contacting the server or creating a box', async () => {
  const { dir, url, server } = await rankingService();
  let requests = 0; server.on('request', () => requests++);
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: url, rankAlertMinDrop: 1, rankAlertCooldownMinutes: 0 }, stateFile: join(dir, 'land', 'state.json'), timezone: 'Asia/Shanghai' });
  try {
    await world.start(host);
    requests = 0;
    await world.tools().find(tool => tool.name === 'terrarium_set_rank_alerts')!.handler({ enabled: false }, context);
    expect(JSON.parse(String(await world.tools().find(tool => tool.name === 'terrarium_inspect')!.handler({}, context))).land.claimed).toBe(false);
    expect(requests).toBe(0);
    await expect(access(join(dir, 'land', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(dir, 'land', 'report-credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await world.stop(); }
});

it('checks water ranks when no land box is owned', async () => {
  const { dir, url } = await rankingService();
  let now = Date.now() - 60_000;
  const events: Array<Omit<EventEnvelope, 'cursor'>> = [];
  const host = { log: { warn() {} }, async pushEvent(event: Omit<EventEnvelope, 'cursor'>) { events.push(event); return { ...event, cursor: events.length }; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: url, rankAlertMinDrop: 1, rankAlertCooldownMinutes: 0 }, stateFile: join(dir, 'land', 'state.json'), timezone: 'Asia/Shanghai', now: () => now });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    await world.start(host);
    await world.tools().find(tool => tool.name === 'terrarium_claim')!.handler({ habitat: 'water' }, context);
    now += TERRARIUM_DEFAULTS.tickIntervalMs;
    await vi.advanceTimersByTimeAsync(10_000);
    await world.tools().find(tool => tool.name === 'terrarium_inspect')!.handler({}, context);
    const rival = newAquarium(now); stockFish(rival, 'guppy', 2, 2);
    await new LeaderboardClient({ url, id: 'water-rival', kind: 'water', credentialsFile: join(dir, 'rival.json') }).report(rival, 'day');
    now += TERRARIUM_DEFAULTS.tickIntervalMs;
    await vi.advanceTimersByTimeAsync(10_000);
    await world.tools().find(tool => tool.name === 'terrarium_inspect')!.handler({}, context);
    expect(events.filter(event => event.type === 'terrarium.overtaken')).toMatchObject([{ senderKey: 'terrarium.water' }]);
    await expect(access(join(dir, 'land', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await world.stop(); vi.useRealTimers(); }
});

it('rejects an ignored HTTP success response instead of recording an accepted snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-ignored-')); dirs.push(dir);
  const server = createServer((req, res) => {
    req.resume(); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/registrations') { res.writeHead(201); res.end(JSON.stringify({ id: 'box-fixture', token: 'a'.repeat(64) })); }
    else res.end(JSON.stringify({ accepted: false, ignored: true, upgradeRequired: true }));
  });
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const client = new LeaderboardClient({ url: `http://127.0.0.1:${address.port}`, id: '', credentialsFile: join(dir, 'credentials.json') });
  try {
    await expect(client.report(newState(Date.now()), 'day')).rejects.toThrow('not accepted');
    expect(client.status()).toMatchObject({ state: 'error', consecutiveFailures: 1 });
    expect(client.status().lastSuccessAt).toBeUndefined();
    expect(client.status().lastSuccessStateAt).toBeUndefined();
  } finally { client.close(); }
});


it('recalculates persisted leaderboard totals on restart without changing uploaded state or revisions', async () => {
  const { server, options } = await service();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  servers.splice(servers.indexOf(server), 1);
  const land = newState(Date.now()), water = newAquarium(Date.now());
  const registry = {
    'box-land-fixture': { id: 'box-land-fixture', kind: 'land', state: land, score: 9999, reportedAt: new Date().toISOString(), reportRevision: 'a'.repeat(32) },
    'box-water-fixture': { id: 'box-water-fixture', kind: 'water', state: water, score: 9998, reportedAt: new Date().toISOString(), reportRevision: 'b'.repeat(32) },
  };
  await writeFile(options.dataFile, JSON.stringify(registry));
  const restarted = await start(options); servers.push(restarted);
  const address = restarted.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const url = `http://127.0.0.1:${address.port}`;
  for (const entry of Object.values(registry)) {
    const result = await (await fetch(`${url}/api/boxes/${entry.id}`)).json();
    expect(result).toEqual({ ...entry, score: score(entry.state) });
    const summary = await (await fetch(`${url}/api/leaderboard?kind=${entry.kind}&view=summary`)).json();
    expect(summary.entries[0].score).toBe(Object.values(summary.entries[0].scoreParts).reduce((sum: number, part) => sum + Number(part), 0));
  }
});
