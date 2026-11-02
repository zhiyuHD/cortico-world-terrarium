import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { expect, it } from 'vitest';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { TERRARIUM_PLANT_REQUIREMENTS } from '../src/habitat.ts';
import { loadState, newState, saveState } from '../src/state.ts';
import { TerrariumWorld } from '../src/world.ts';

it('compares onlyDry with each cell own species minimum and lists the skipped cells', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-water-'));
  const file = join(dir, 'land', 'state.json');
  const now = Date.parse('2026-06-01T04:00:00Z');
  const state = newState(now);
  const size = 5;
  const cell = (x: number, y: number) => state.soil[y * size + x];
  state.plants.length = 0;
  const mushroom = TERRARIUM_PLANT_REQUIREMENTS.mushroom.minMoisture;
  cell(2, 2).moisture = mushroom + 29.4;
  state.seeds.push({ id: 'seed-1', species: 'mushroom', x: 2, y: 2, ageHours: 0 });
  cell(1, 1).moisture = 20;
  cell(4, 4).moisture = 100;
  for (const soil of state.soil) if ([cell(2, 2), cell(1, 1), cell(4, 4)].includes(soil)) continue; else soil.moisture = 90;
  await saveState(file, state);
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => now });
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  const context = {} as ToolCallContext;
  try {
    await world.start(host);
    const call = async (name: string, args: Record<string, unknown>) => JSON.parse(String(await world.tools().find(tool => tool.name === name)!.handler(args, context)));
    const preview = await call('terrarium_garden', { operation: 'water_area', preview: true, onlyDry: true, x1: 0, y1: 0, x2: 4, y2: 4 });
    expect(preview.soil.map((soil: { x: number; y: number }) => `${soil.x},${soil.y}`)).toEqual(['1,1']);
    const skipped = new Map<string, { moisture: number }>(preview.skippedCells.map((soil: { x: number; y: number }) => [`${soil.x},${soil.y}`, soil]));
    expect(skipped.get('2,2')).toMatchObject({ minimum: mushroom, reason: 'above minimum' });
    expect(skipped.get('2,2')!.moisture).toBeCloseTo(mushroom + 29.4, 5);
    expect(skipped.get('4,4')).toMatchObject({ minimum: 30, reason: 'saturated' });
    expect(preview.watering).toMatchObject({ requested: 25, watered: 1, skipped: 24 });
    expect((await loadState(file, now)).soil[1 * size + 1].moisture).toBe(20);
  } finally {
    await world.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

it('waters a seed cell whose moisture is under its own minimum', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-water-'));
  const file = join(dir, 'land', 'state.json');
  const now = Date.parse('2026-06-01T04:00:00Z');
  const state = newState(now);
  state.plants.length = 0;
  state.seeds.push({ id: 'seed-1', species: 'lavender', x: 0, y: 0, ageHours: 0 });
  state.soil[0].moisture = TERRARIUM_PLANT_REQUIREMENTS.lavender.minMoisture - 1;
  for (let i = 1; i < state.soil.length; i++) state.soil[i].moisture = 60;
  await saveState(file, state);
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => now });
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  const context = {} as ToolCallContext;
  try {
    await world.start(host);
    const result = JSON.parse(String(await world.tools().find(tool => tool.name === 'terrarium_garden')!.handler({ operation: 'water_area', onlyDry: true, x1: 0, y1: 0, x2: 4, y2: 4 }, context)));
    expect(result.soil.map((soil: { x: number; y: number }) => `${soil.x},${soil.y}`)).toEqual(['0,0']);
    expect((await loadState(file, now)).soil[0].moisture).toBe(TERRARIUM_PLANT_REQUIREMENTS.lavender.minMoisture - 1 + 35);
  } finally {
    await world.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
