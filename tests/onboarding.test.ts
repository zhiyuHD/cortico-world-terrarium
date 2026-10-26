import { operationTools } from './tool-operations.ts';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { capacity } from '../src/progression.ts';

const host = { log: { warn() {} }, async pushEvent(event: object) { return { ...event, cursor: 1 }; } } as unknown as WorldHost;
const at = Date.parse('2026-06-01T08:00:00Z');
function invoke(world: TerrariumWorld, name: string, args: Record<string, unknown> = {}) {
  return operationTools(world).find(t => t.name === name)!.handler(args, {} as ToolCallContext).then(result => JSON.parse(String(result)));
}
it('keeps a locally claimed habitat when registration fails and never queries rankings during claim', async () => {
  let registrations = 0, reads = 0;
  const server = createServer((req, res) => {
    if (req.url === '/api/registrations') registrations++; else reads++;
    req.resume(); res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"Temporarily unavailable"}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing port');
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-local-claim-')), file = join(dir, 'state.json');
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: `http://127.0.0.1:${address.port}`, requestTimeoutMs: 200 }, stateFile: file, timezone: 'UTC', now: () => at });
  try {
    await world.start(host);
    await vi.waitFor(() => expect(reads).toBe(1));
    reads = 0;
    const result = await invoke(world, 'terrarium_claim', { habitat: 'land', name: 'Test garden' });
    expect(result).toMatchObject({ claimed: true, savedLocally: true, name: 'Test garden', sync: { state: 'error' } });
    expect(result.synchronization).toContain('pending');
    expect(JSON.parse(await readFile(file, 'utf8')).name).toBe('Test garden');
    expect(await invoke(world, 'terrarium_claim', { habitat: 'land', name: 'Different name' })).toMatchObject({ name: 'Test garden', claimed: true });
    expect(registrations).toBe(1); expect(reads).toBe(0);
    expect(await invoke(world, 'terrarium_sync')).toMatchObject({ claimed: true, sync: { state: 'error', consecutiveFailures: 1 } });
    expect(registrations).toBe(2);
    expect((await invoke(world, 'terrarium_inspect')).land.claimed).toBe(true);
  } finally { await world.stop(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
it('reports completed guide tasks, retries chapters without skipping and counts skipped watering and sowing cells', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-guide-')), file = join(dir, 'state.json');
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, stateFile: file, timezone: 'UTC', now: () => at });
  try {
    await world.start(host); await invoke(world, 'terrarium_claim', { habitat: 'land' });
    const observed = await invoke(world, 'terrarium_inspect', { habitat: 'land' });
    expect(observed.guide).toMatchObject({ step: 0, ready: true, next: { action: 'guide', step: 0 } });
    expect(observed.scoreRules).toContain('100%/50%/25%');
    const advanced = await invoke(world, 'terrarium_progress', { action: 'guide', step: 0 });
    expect(advanced).toMatchObject({ guideAdvanced: true, guide: { step: 1, ready: false } });
    expect(await invoke(world, 'terrarium_progress', { action: 'guide', step: 0 })).toMatchObject({ guideAdvanced: false, guide: { step: 1 } });
    expect(await invoke(world, 'terrarium_progress', { action: 'guide' })).toMatchObject({ guideAdvanced: false, guide: { step: 1 } });
    const noop = await invoke(world, 'terrarium_water_area', { x1: 0, y1: 0, x2: 4, y2: 4, onlyDry: true });
    expect(noop.watering).toEqual({ requested: 25, watered: 0, skipped: 25, reason: 'Skipped cells already meet onlyDry threshold or target moisture.' });
    expect(noop.guide.ready).toBe(false);
    expect(await invoke(world, 'terrarium_water', { x: 0, y: 0, amount: 1 })).toMatchObject({ watering: { watered: 1, skipped: 0 }, guide: { ready: true } });
    const initial = JSON.parse(await readFile(file, 'utf8'));
    const planted = await invoke(world, 'terrarium_sow_area', { species: 'fern', x1: 0, y1: 0, x2: 4, y2: 4 });
    expect(planted.planted).toBe(capacity(initial).organisms - initial.plants.length - initial.seeds.length);
    expect(planted.planted + planted.skippedOccupied + planted.skippedCapacity).toBe(25);
    expect(planted.skippedOccupied).toBe(initial.plants.length + initial.seeds.length);
    const saved = JSON.parse(await readFile(file, 'utf8')); expect(saved.seeds).toHaveLength(initial.seeds.length + planted.planted);
    const before = await readFile(file, 'utf8');
    await expect(invoke(world, 'terrarium_sow_area', { species: 'unknown', x1: 0, y1: 0, x2: 4, y2: 4 })).rejects.toThrow('species');
    expect(await readFile(file, 'utf8')).toBe(before);
    await invoke(world, 'terrarium_collection', { action: 'collect', id: 'fern' });
    await expect(invoke(world, 'terrarium_collection', { action: 'restore', id: 'fern', x: planted.seeds[0].x, y: planted.seeds[0].y })).rejects.toThrow('remains in collection');
    expect((await invoke(world, 'terrarium_collection', { action: 'list', id: 'fern' })).entry.specimen.id).toBe('fern');
    await invoke(world, 'terrarium_claim', { habitat: 'water' });
    expect((await invoke(world, 'terrarium_progress', { habitat: 'water' })).guide.text).toContain('含氧');
    const water = await invoke(world, 'terrarium_plant_aquatic', { species: 'waterlily', x: 2, y: 2 });
    expect(water.guide.next.habitat).toBe('water');
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});
