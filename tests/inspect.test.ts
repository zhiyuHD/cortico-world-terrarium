import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { expect, it } from 'vitest';
import { estimateTokens } from 'cortico/core/util.ts';
import { compactNumbers, inspectState, TERRARIUM_INSPECT_SECTIONS } from '../src/inspect.ts';
import { newState, validState, saveState, type TerrariumState } from '../src/state.ts';
import { newAquarium, stockFish, plantAquatic } from '../src/aquarium.ts';
import { landCare } from '../src/care.ts';
import { colonySnapshot } from '../src/colony.ts';
import { captureConditions, createReturnReport, recentScores } from '../src/return-report.ts';

const now = Date.parse('2026-10-20T06:00:00Z');
function matureLand(): TerrariumState {
  const s = newState(now); s.name = '名'.repeat(64);
  s.plants = Array.from({ length: 12 }, (_, i) => ({ id: `plant-${i}`.padEnd(32, 'x'), species: 'basil', x: i % 5, y: Math.floor(i / 5), moisture: 38.123456789012345, health: 19.123456789012345, growthHours: 100.123456789, stage: 3, dry: false }));
  s.nests = Array.from({ length: 5 }, (_, i) => ({ id: `nest-${i}`, x: i, y: 4, depth: 5, food: 50 }));
  s.bugs = Array.from({ length: 12 }, (_, i) => ({ id: `bug-${i}`.padEnd(32, 'x'), species: 'ant', x: i % 5, y: 4, energy: 19.123456789, hunger: 80.123456789, ageHours: 10.123456789, role: i === 0 ? 'queen' : 'worker', inside: { nestId: `nest-${i % 5}`, x: i % 4, y: Math.floor(i / 4) } }));
  s.collection = Array.from({ length: 48 }, (_, i) => ({ kind: 'plant', specimen: { ...s.plants[i % 12], id: `stored-${i}` } }));
  s.history = Array.from({ length: 168 }, (_, i) => ({ recordedAtMs: now - (167 - i) * 3600000, soilMoisture: s.soil.map(c => c.moisture), plants: structuredClone(s.plants), score: 100 }));
  s.irrigation = s.soil.map(c => ({ x: c.x, y: c.y, intervalMinutes: 60, targetMoisture: 60, lastWateredAtMs: now }));
  return s;
}
const ownership = { habitat: 'land', claimed: true, id: 'box-fixture', name: '名'.repeat(64), sync: { state: 'synced', clientVersion: '0.8.2', mode: 'incremental', transport: 'ws', lastAttemptAt: new Date(now).toISOString(), lastSuccessAt: new Date(now).toISOString(), lastSuccessStateAt: new Date(now).toISOString(), consecutiveFailures: 0 } };

it('keeps full-capacity inspection below the Core warning threshold independently of stored specimens and samples', () => {
  const s = matureLand(), before = captureConditions(s);
  expect(validState(s)).toBe(true); before.atMs -= 12 * 3600000;
  for (const key of Object.keys(before.metrics)) before.metrics[key] = 0;
  const report = createReturnReport(before, s);
  const old = JSON.stringify({ ...s, history: { samples: s.history.length }, colonies: s.nests!.map(n => colonySnapshot(s, n)), care: landCare(s, now, 'UTC'), returnReport: report, scoreHistory: recentScores(s, now) });
  const current = JSON.stringify(compactNumbers({ ...ownership, ...inspectState(s, now, 'UTC', 'summary', 0, 5, report) as object }));
  expect(current.length).toBeLessThan(8_000);
  expect(estimateTokens(current)).toBeLessThan(2_400);
  expect(current.length).toBeLessThan(old.length / 3);
  const parsed = JSON.parse(current);
  expect(parsed.collection).toMatchObject({ count: 48 });
  expect(parsed.bugs).toHaveLength(s.bugs.length); expect(parsed.plants).toHaveLength(s.plants.length);
  expect(parsed.scoreHistory).toBeUndefined(); expect(parsed.colonies).toBeUndefined();
  expect(parsed.returnReport.changes).toBeUndefined();
  s.collection = []; s.history = [];
  const smaller = JSON.stringify(compactNumbers(inspectState(s, now, 'UTC', 'summary', 0, 5)));
  expect(current.length - smaller.length).toBeLessThan(1_000);
});

it('pages detailed diagnostics and return changes, preserves light thresholds, and leaves state unchanged', () => {
  const s = matureLand(), before = captureConditions(s); before.atMs -= 3600000;
  for (const key of Object.keys(before.metrics)) before.metrics[key] = 0;
  const report = createReturnReport(before, s), saved = JSON.stringify(s);
  for (const limit of [5, 10]) for (const section of TERRARIUM_INSPECT_SECTIONS) {
    const text = JSON.stringify(compactNumbers({ ...ownership, ...inspectState(s, now, 'UTC', section, 0, limit, report) as object }));
    expect(text.length, section).toBeLessThan(8_000);
  }
  const first = inspectState(s, now, 'UTC', 'care', 0, 5) as { care: { plants: { items: { id: string }[]; nextOffset: number } } };
  const second = inspectState(s, now, 'UTC', 'care', first.care.plants.nextOffset, 5) as typeof first;
  expect(first.care.plants.items).toHaveLength(5);
  expect(first.care.plants.items.map(p => p.id).some(id => second.care.plants.items.some(p => p.id === id))).toBe(false);
  const soil = compactNumbers(inspectState(s, now, 'UTC', 'soil', 0, 5)) as { requirements: { fern: { minLight: number } } };
  expect(soil.requirements.fern.minLight).toBe(.15);
  expect(JSON.stringify(s)).toBe(saved);
});

it('keeps water state compact at capacity and retrieves food separately', () => {
  const s = newAquarium(now);
  for (let i = 0; i < 12; i++) stockFish(s, 'guppy', i % 5, Math.floor(i / 5));
  for (let i = 2; i < 12; i++) plantAquatic(s, 'waterweed', i % 5, Math.floor(i / 5) + 1);
  s.food = Array.from({ length: 20 }, (_, i) => ({ id: `food-${i}`, x: i % 5, y: 4, portions: 10, droppedAtMs: now }));
  const summary = inspectState(s, now, 'UTC', 'summary', 0, 5) as { fish: unknown[]; food: { portions: number } };
  expect(summary.fish).toHaveLength(12); expect(summary.food.portions).toBe(200);
  expect(JSON.stringify(compactNumbers(summary)).length).toBeLessThan(4_000);
  expect(inspectState(s, now, 'UTC', 'objects', 5, 5)).toMatchObject({ food: { total: 20, offset: 5, nextOffset: 10, items: s.food.slice(5, 10) } });
});

it('keeps complete browser snapshots while default tool inspection stays compact and validates detail requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-compact-')), file = join(dir, 'state.json');
  const state = matureLand(); await saveState(file, state);
  const host = { log: { warn() {} }, async pushEvent(event: object) { return { ...event, cursor: 1 }; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => now });
  const inspect = world.tools().find(t => t.name === 'terrarium_inspect')!;
  const call = async (args: Record<string, unknown>) => String(await inspect.handler(args, {} as ToolCallContext));
  try {
    await world.start(host);
    const text = await call({ habitat: 'land' });
    expect(text.length).toBeLessThan(8_000);
    expect(JSON.parse(text).collection).toEqual({ count: state.collection!.length, tool: 'terrarium_collection' });
    const view = await world.webUi().invoke!('garden', 'state', []) as { state: TerrariumState & { colonies: unknown[]; scoreHistory: unknown[] } };
    expect(view.state.collection).toEqual(state.collection);
    expect(view.state.history).toHaveLength(state.history.length);
    expect(view.state.colonies).toHaveLength(state.nests!.length);
    expect(view.state.scoreHistory.length).toBeGreaterThan(0);
    await expect(call({ section: 'care' })).rejects.toThrow('requires habitat');
    await expect(call({ habitat: 'land', section: 'all' })).rejects.toThrow('Unknown');
    await expect(call({ habitat: 'land', limit: 11 })).rejects.toThrow('1..10');
    await expect(call({ habitat: 'land', offset: -1 })).rejects.toThrow('non-negative');
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});
