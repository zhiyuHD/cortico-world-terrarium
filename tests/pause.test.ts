import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { expect, it } from 'vitest';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { loadState, advance, dropLandFood, newState, saveState, type TerrariumState } from '../src/state.ts';
import { TerrariumWorld } from '../src/world.ts';

const HOUR = 3_600_000;
const TZ = 'Asia/Shanghai';
const start = Date.parse('2026-06-01T04:00:00Z');

it('freezes a box for the whole absence and resumes without catching up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-pause-'));
  const file = join(dir, 'land', 'state.json');
  const state = newState(start);
  await saveState(file, state);
  let now = start;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: TZ, stateFile: file, now: () => now });
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  const context = {} as ToolCallContext;
  try {
    await world.start(host);
    const call = async (args: Record<string, unknown>) => JSON.parse(String(await world.tools().find(tool => tool.name === 'terrarium_manage')!.handler(args, context)));
    const frozen = await call({ operation: 'pause', habitat: 'land', paused: true });
    expect(frozen).toMatchObject({ habitat: 'land', paused: true });
    const before = (await loadState(file, now)).plants.map(plant => [plant.moisture, plant.health, plant.growthHours]);
    now += 86 * HOUR;
    await world.tools().find(tool => tool.name === 'terrarium_inspect')!.handler({ habitat: 'land' }, context);
    const saved = await loadState(file, now);
    expect(saved.plants.map(plant => [plant.moisture, plant.health, plant.growthHours])).toEqual(before);
    expect(saved.updatedAtMs).toBe(start);
    const overview = JSON.parse(String(await world.tools().find(tool => tool.name === 'terrarium_inspect')!.handler({ habitat: 'land' }, context)));
    expect(overview.paused).toBe(true);
    expect(overview.frozenHours).toBeCloseTo(86, 2);
    const resumed = await call({ operation: 'pause', habitat: 'land', paused: false });
    expect(resumed.paused).toBe(false);
    expect(resumed.frozenHours).toBeCloseTo(86, 2);
    const restored = await loadState(file, now);
    expect(restored.pausedAtMs).toBeUndefined();
    expect(restored.updatedAtMs).toBe(now);
    for (const plant of restored.plants) expect(plant.health).toBeGreaterThanOrEqual(90);
  } finally {
    await world.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

it('keeps a food pile fresh while paused so it does not expire on resume', async () => {
  const state = newState(start);
  const food = dropLandFood(state, 1, 1, 3);
  state.pausedAtMs = start + HOUR;
  advance(state, start + 4 * HOUR, TZ);
  expect(state.food?.map(pile => pile.id)).toEqual([food.id]);
  state.pausedAtMs = undefined;
  expect(state.updatedAtMs).toBe(start);
});

it('loads a paused save and keeps simulating after resume', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-pause-'));
  const file = join(dir, 'land', 'state.json');
  const state = newState(start);
  state.pausedAtMs = start;
  await saveState(file, state);
  const loaded = await loadState(file, start + 10 * HOUR);
  expect(loaded.pausedAtMs).toBe(start);
  loaded.pausedAtMs = undefined;
  const changes = advance(loaded, start + 11 * HOUR, TZ);
  expect(loaded.updatedAtMs).toBe(start + 11 * HOUR);
  expect(Array.isArray(changes)).toBe(true);
  await rm(dir, { recursive: true, force: true });
});
