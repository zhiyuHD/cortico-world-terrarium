import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { start } from '../server/index.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { TerrariumWorld } from '../src/world.ts';

it('registers each claimed habitat once across repeated tool calls and World restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-claim-'));
  const serverOptions = { port: 0, dataFile: join(dir, 'server', 'leaderboard.json'), credentialsFile: join(dir, 'server', 'credentials.json') };
  const server = await start(serverOptions);
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const url = `http://127.0.0.1:${address.port}`;
  let registrations = 0;
  server.on('request', req => { if (req.method === 'POST' && req.url === '/api/registrations') registrations++; });
  let now = Date.now() - 1200000;
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: url }, stateFile: join(dir, 'local', 'land', 'state.json'), waterStateFile: join(dir, 'local', 'water', 'state.json'), timezone: 'Asia/Shanghai', now: () => now };
  const events: unknown[] = [], warnings: unknown[] = [];
  const host = { log: { warn: (...args: unknown[]) => warnings.push(args) }, async pushEvent(event: unknown) { events.push(event); return event; } } as unknown as WorldHost;
  const context = {} as ToolCallContext;
  let world = new TerrariumWorld(options);
  const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await world.tools().find(tool => tool.name === name)!.handler(args, context)));
  try {
    await world.start(host);
    expect(await call('terrarium_inspect')).toEqual({ land: { habitat: 'land', claimed: false }, water: { habitat: 'water', claimed: false } });
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
      expect(await world.webUi().invoke!('water', 'state', [])).toMatchObject({ claimed: false });
      await world.stop();
    }
    await expect(stat(options.stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
