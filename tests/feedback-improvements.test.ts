import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { newState, saveState } from '../src/state.ts';
import { inspectState } from '../src/inspect.ts';
import { landCare } from '../src/care.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
const now = Date.parse('2026-06-01T12:00:00Z');
it('maps actual coordinates into soil matrices without changing saved state', () => {
  const s = newState(now); s.soil[0].moisture = 10; s.soil[1].moisture = 90; s.soil[5].moisture = 70;
  const before = structuredClone(s);
  const result = inspectState(s, now, 'UTC', 'soil', 0, 5) as { matrix: { size: number; moisture: string[]; daylight: string[] } };
  expect(result.matrix).toMatchObject({ size: 5, moisture: ['DSMMM', 'WMMMM', 'MMMMM', 'MMMMM', 'MMMMM'] });
  expect(result.matrix.daylight).toHaveLength(5); expect(s).toEqual(before);
});
it('reports consecutive hourly moisture observations and stops at recovery or a missing plant', () => {
  const s = newState(now), plant = s.plants[0]; plant.moisture = 10;
  s.history = [80, 10, 15].map((moisture, i) => ({ recordedAtMs: now - (3 - i) * 3600000, soilMoisture: [], plants: [{ ...plant, moisture }] }));
  expect(landCare(s, now, 'UTC').plants[0].moistureHistory).toEqual({ condition: 'dry', matchingSamples: 2, sinceSampleAtMs: now - 2 * 3600000 });
  s.history[2].plants = [];
  expect(landCare(s, now, 'UTC').plants[0].moistureHistory.matchingSamples).toBe(0);
  plant.moisture = 50;
  expect(landCare(s, now, 'UTC').plants[0].moistureHistory.condition).toBe('suitable');
});
it('previews single and area watering with real warnings without healing, saving or completing care', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'watering-preview-')), file = join(dir, 'state.json');
  const s = newState(now); s.plants[0].health = 40; await saveState(file, s);
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => now });
  try {
    await world.start({ log: { warn() {} }, async pushEvent(e: unknown) { return { ...(e as object), cursor: 1 }; } } as unknown as WorldHost);
    const call = async (name: string, args: Record<string, unknown>) => JSON.parse(await world.tools().find(t => t.name === name)!.handler(args, {} as ToolCallContext) as string);
    const before = await readFile(file, 'utf8');
    const single = await call('terrarium_water', { plant: s.plants[0].id, amount: 100, preview: true });
    const area = await call('terrarium_water_area', { x1: 0, y1: 0, x2: 4, y2: 4, targetMoisture: 100, preview: true });
    expect(single.preview).toBe(true); expect(single.plant.moisture).toBe(100); expect(area.preview).toBe(true);
    expect(single.warnings).toHaveLength(1);
    expect(single.plants[0]).toMatchObject({ moistureStatus: 'high', belowMaximum: single.plants[0].maxMoisture - single.plants[0].moisture });
    expect(area.warnings.length).toBe(s.plants.length);
    expect(await readFile(file, 'utf8')).toBe(before);
    const applied = await call('terrarium_water', { plant: s.plants[0].id, amount: 10 });
    expect(applied.plant.moisture).toBe(s.plants[0].moisture + 10);
    expect(applied.plant.health).toBe(45);
    expect(await readFile(file, 'utf8')).not.toBe(before);
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});
