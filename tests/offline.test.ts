import { operationTools } from './tool-operations.ts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { start } from '../server/index.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { TerrariumWorld } from '../src/world.ts';

it('stops every network request, keeps working locally and remembers the choice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-offline-'));
  const server = await start({ port: 0, dataFile: join(dir, 'server', 'leaderboard.json'), credentialsFile: join(dir, 'server', 'credentials.json') });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  let requests = 0;
  server.on('request', () => { requests++; });
  server.on('upgrade', () => { requests++; });
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: `http://127.0.0.1:${address.port}`, tickIntervalMs: 24 * 60 * 60_000 }, stateFile: join(dir, 'land', 'state.json'), waterStateFile: join(dir, 'water', 'state.json'), timezone: 'Asia/Shanghai', now: () => Date.now() };
  const warnings: unknown[] = [];
  const host = { log: { warn: (...args: unknown[]) => warnings.push(args) }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  const context = {} as ToolCallContext;
  try {
    let world = new TerrariumWorld(options);
    const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await operationTools(world).find(tool => tool.name === name)!.handler(args, context)));
    await world.start(host);
    await call('terrarium_claim', { habitat: 'land' });
    expect(requests).toBeGreaterThan(0);

    const enabled = await call('terrarium_offline', { action: 'enable' });
    expect(enabled).toMatchObject({ offline: true, disabled: expect.arrayContaining([expect.objectContaining({ feature: 'report' })]), stillWorks: expect.arrayContaining(['模拟与存档']) });
    const settled = requests;
    expect((await call('terrarium_sync')).offline).toBe(true);
    expect((await call('terrarium_leaderboard', { habitat: 'land' })).offline).toBe(true);
    expect((await call('terrarium_forum_read', {}))?.offline).toBe(true);
    expect((await call('terrarium_neighbors', { action: 'status' })).offline).toBe(true);
    expect((await call('terrarium_take_photo', { habitat: 'land' })).offline).toBe(true);
    expect(requests).toBe(settled);
    // Local play is untouched: caring for the box still saves.
    await call('terrarium_sow', { species: 'wheat', x: 1, y: 1 });
    expect((await call('terrarium_inspect', { habitat: 'land' })).seeds).toHaveLength(1);
    expect(warnings).toEqual([]);
    await world.stop();

    world = new TerrariumWorld(options);
    const restarted = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await operationTools(world).find(tool => tool.name === name)!.handler(args, context)));
    await world.start(host);
    expect(await restarted('terrarium_offline')).toMatchObject({ offline: true });
    expect((await restarted('terrarium_sync')).offline).toBe(true);
    expect(requests).toBe(settled);

    expect(await restarted('terrarium_offline', { action: 'disable' })).toMatchObject({ offline: false, disabled: [] });
    await restarted('terrarium_sync');
    expect(requests).toBeGreaterThan(settled);
    expect(JSON.parse(await readFile(join(dir, 'land', 'offline.json'), 'utf8'))).toEqual({ enabled: false });
    await world.stop();
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});
