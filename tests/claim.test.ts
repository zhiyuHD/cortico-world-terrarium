import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { start } from '../server/index.ts';
import { TERRARIUM_CONFIG_GROUP, TERRARIUM_DEFAULTS } from '../src/config.ts';
import { TerrariumWorld } from '../src/world.ts';
import { LeaderboardClient } from '../src/leaderboard.ts';
import { newState, saveState } from '../src/state.ts';

it('registers each claimed habitat once across repeated tool calls and World restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-claim-'));
  const serverOptions = { port: 0, dataFile: join(dir, 'server', 'leaderboard.json'), credentialsFile: join(dir, 'server', 'credentials.json') };
  const server = await start(serverOptions);
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const url = `http://127.0.0.1:${address.port}`;
  let registrations = 0;
  server.on('request', req => { if (req.method === 'POST' && req.url === '/api/registrations') registrations++; });
  let now = Date.now() - 1200000;
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: url, tickIntervalMs: 24 * 60 * 60_000 }, stateFile: join(dir, 'local', 'land', 'state.json'), waterStateFile: join(dir, 'local', 'water', 'state.json'), timezone: 'Asia/Shanghai', now: () => now };
  const events: unknown[] = [], warnings: unknown[] = [];
  const host = { log: { warn: (...args: unknown[]) => warnings.push(args) }, async pushEvent(event: unknown) { events.push(event); return event; } } as unknown as WorldHost;
  const context = {} as ToolCallContext;
  let world = new TerrariumWorld(options);
  const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await world.tools().find(tool => tool.name === name)!.handler(args, context)));
  try {
    await world.start(host);
    expect(await call('terrarium_inspect')).toEqual({ land: { habitat: 'land', claimed: false, sync: { state: 'idle', mode: 'full', consecutiveFailures: 0 } }, water: { habitat: 'water', claimed: false, sync: { state: 'idle', mode: 'full', consecutiveFailures: 0 } } });
    await expect(call('terrarium_sync')).rejects.toThrow('not claimed');
    await expect(world.webUi().invoke!('water', 'sync', [])).rejects.toThrow('not claimed');
    expect(registrations).toBe(0);
    await expect(stat(options.stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(options.waterStateFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(call('terrarium_water', { plant: 'fern' })).rejects.toThrow('not claimed');
    await expect(call('terrarium_stock_fish', { species: 'guppy', x: 1, y: 1 })).rejects.toThrow('not claimed');
    const land = await call('terrarium_claim', { habitat: 'land', name: '林地' });
    const water = await call('terrarium_claim', { habitat: 'water', name: '水庭' });
    expect(land.id).not.toBe(water.id); expect(registrations).toBe(2);
    expect(await call('terrarium_claim', { habitat: 'water', name: 'ignored' })).toEqual(water);
    for (const habitat of ['land', 'water']) {
      const file = join(dir, 'local', habitat, 'report-credentials.json');
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      const saved = Object.values(JSON.parse(await readFile(file, 'utf8'))) as Array<{ id: string; token: string }>;
      expect(saved).toHaveLength(1); expect(saved[0].token).toMatch(/^[a-f0-9]{64}$/);
    }
    const fish = await call('terrarium_stock_fish', { species: 'guppy', x: 1, y: 1 });
    await call('terrarium_feed_fish', { x: 1, y: 1, portions: 3 });
    await call('terrarium_plant_aquatic', { species: 'waterlily', x: 2, y: 2 });
    await call('terrarium_rename', { habitat: 'water', name: '新水庭' });
    now += 600000;
    expect((await call('terrarium_inspect', { habitat: 'water' })).fish[0].energy).toBeGreaterThan(fish.energy);
    const listed = await (await fetch(url + '/api/leaderboard?kind=water')).json();
    expect(listed).toHaveLength(1); expect(listed[0]).toMatchObject({ id: water.id, kind: 'water', state: { name: '新水庭' } });
    expect((await (await fetch(url + '/api/leaderboard?kind=land')).json())[0].id).toBe(land.id);
    await call('terrarium_stock_fish', { species: 'perch', x: 0, y: 1 });
    now += 600000;
    const waterReplays = await call('terrarium_replay', { habitat: 'water' });
    expect(waterReplays).toHaveLength(1);
    const waterReplay = await call('terrarium_replay', { habitat: 'water', id: waterReplays[0].id });
    expect(waterReplay.frames[1].fish.map((f: { id: string }) => f.id)).toContain(fish.id);
    expect(waterReplay.frames[2].fish.map((f: { id: string }) => f.id)).not.toContain(fish.id);
    expect((await call('terrarium_water_history')).length).toBeGreaterThan(0);
    const savedLand = await readFile(options.stateFile, 'utf8'), savedWater = await readFile(options.waterStateFile, 'utf8');
    const synced = await call('terrarium_sync');
    expect(synced).toMatchObject({ id: land.id, sync: { state: 'synced', transport: 'ws', consecutiveFailures: 0 } });
    const panel = await world.webUi().invoke!('water', 'sync', []) as { sync: unknown };
    expect(panel.sync).toMatchObject({ state: 'synced', transport: 'ws' });
    expect((await call('terrarium_inspect', { habitat: 'land' })).sync).toEqual(synced.sync);
    expect((await (await fetch(`${url}/api/boxes/${water.id}`)).json()).state.updatedAtMs).toBe(now);
    expect(await readFile(options.stateFile, 'utf8')).toBe(savedLand);
    expect(await readFile(options.waterStateFile, 'utf8')).toBe(savedWater);
    expect(registrations).toBe(2);

    await world.stop(); world = new TerrariumWorld(options); await world.start(host);
    expect((await call('terrarium_inspect')).land.id).toBe(land.id);
    expect((await call('terrarium_inspect')).water.id).toBe(water.id);
    expect((await call('terrarium_inspect', { habitat: 'water' })).name).toBe('新水庭');
    await call('terrarium_claim', { habitat: 'land' }); await call('terrarium_claim', { habitat: 'water' });
    expect(registrations).toBe(2); expect(warnings).toEqual([]);
    const clientCredentials = await readFile(join(dir, 'local', 'water', 'report-credentials.json'), 'utf8');
    const token = (Object.values(JSON.parse(clientCredentials)) as Array<{ token: string }>)[0].token;
    expect(JSON.stringify(await call('terrarium_inspect'))).not.toContain(token);
    expect(JSON.stringify(listed)).not.toContain(token);
  } finally {
    await world.stop(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true });
  }
});

it('does not claim or register anything when starting and restarting with no saved boxes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-unclaimed-'));
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, stateFile: join(dir, 'land', 'state.json'), waterStateFile: join(dir, 'water', 'state.json'), timezone: 'Asia/Shanghai' };
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  try {
    for (let i = 0; i < 2; i++) {
      const world = new TerrariumWorld(options); await world.start(host);
      expect(await world.webUi().invoke!('garden', 'state', [])).toMatchObject({ claimed: false });
      expect(await world.webUi().invoke!('water', 'state', [])).toMatchObject({ claimed: false, sync: { state: 'disabled' } });
      await expect(world.webUi().invoke!('water', 'sync', [])).rejects.toThrow('not claimed');
      await world.stop();
    }
    await expect(stat(options.stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it.each(['https://boxes.example.test', 'custom-land'])('ignores the retired ID %s for registration and preserves automatically assigned identities on restart', async legacyId => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-claim-id-'));
  const server = await start({ port: 0, dataFile: join(dir, 'server/leaderboard.json'), credentialsFile: join(dir, 'server/credentials.json') });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const cfg = { ...TERRARIUM_DEFAULTS, leaderboardUrl: `http://127.0.0.1:${address.port}`, leaderboardId: legacyId };
  const options = { cfg, stateFile: join(dir, 'local/land/state.json'), waterStateFile: join(dir, 'local/water/state.json'), timezone: 'Asia/Shanghai' };
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  let registrations = 0;
  server.on('request', req => { if (req.method === 'POST' && req.url === '/api/registrations') registrations++; });
  let world = new TerrariumWorld(options);
  const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await world.tools().find(tool => tool.name === name)!.handler(args, {} as ToolCallContext)));
  try {
    await world.start(host);
    expect(Object.hasOwn(TERRARIUM_CONFIG_GROUP.schema.properties, 'worlds.terrarium.leaderboardId')).toBe(false);
    expect(Object.hasOwn(TERRARIUM_DEFAULTS, 'leaderboardId')).toBe(false);
    expect(registrations).toBe(0);
    const land = await call('terrarium_claim', { habitat: 'land', name: '显示名称' });
    expect(land).toMatchObject({ claimed: true, name: '显示名称' }); expect(land.id).toMatch(/^box-/);
    const water = await call('terrarium_claim', { habitat: 'water', name: '水箱' });
    const waterCredentials = await readFile(join(dir, 'local/water/report-credentials.json'), 'utf8');
    expect(registrations).toBe(2);
    await world.stop(); world = new TerrariumWorld({ ...options, cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: cfg.leaderboardUrl } }); await world.start(host);
    expect(await call('terrarium_claim', { habitat: 'land' })).toMatchObject({ id: land.id });
    expect(land.id).not.toBe(water.id);
    expect(await call('terrarium_inspect', { habitat: 'water' })).toMatchObject({ id: water.id, name: '水箱' });
    expect(await readFile(join(dir, 'local/water/report-credentials.json'), 'utf8')).toBe(waterCredentials);
    expect(registrations).toBe(2);
  } finally {
    await world.stop(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true });
  }
});

it('restores an existing named land box and its token when the ID config is absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-claim-legacy-'));
  const credentialsFile = join(dir, 'server/credentials.json'), server = await start({ port: 0, dataFile: join(dir, 'server/leaderboard.json'), credentialsFile });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const url = `http://127.0.0.1:${address.port}`, stateFile = join(dir, 'local/land/state.json'), localCredentials = join(dir, 'local/land/report-credentials.json');
  const old = new LeaderboardClient({ url, id: 'existing-land', credentialsFile: localCredentials });
  const state = newState(Date.now()); state.name = '保留的地箱';
  await old.report(state, 'day'); old.close(); await saveState(stateFile, state);
  const original = JSON.parse(await readFile(localCredentials, 'utf8')), serverBefore = await readFile(credentialsFile, 'utf8');
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: url }, stateFile, timezone: 'Asia/Shanghai' });
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  try {
    await world.start(host);
    const claim = world.tools().find(tool => tool.name === 'terrarium_claim')!;
    expect(JSON.parse(String(await claim.handler({ habitat: 'land' }, {} as ToolCallContext)))).toMatchObject({ id: 'existing-land', name: state.name });
    const migrated = JSON.parse(await readFile(localCredentials, 'utf8'));
    expect(migrated[url + '/auto']).toEqual(original[url + '/id/existing-land']);
    expect(migrated[url + '/id/existing-land']).toEqual(original[url + '/id/existing-land']);
    expect(await readFile(credentialsFile, 'utf8')).toBe(serverBefore);
  } finally {
    await world.stop(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true });
  }
});
