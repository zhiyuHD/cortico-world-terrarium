import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorldHost, ToolCallContext } from 'cortico/core/types.ts';
import { expect, it } from 'vitest';
import { captureConditions, createReturnReport, recentScores } from '../src/return-report.ts';
import { advance, dropLandFood, newState, releaseBug, saveState, sow, validState } from '../src/state.ts';
import { advanceAquarium, newAquarium, validAquarium } from '../src/aquarium.ts';
import { collect, restoreCollected } from '../src/collection.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { TerrariumWorld } from '../src/world.ts';
import { score } from '../src/scoring.ts';
const start = Date.parse('2026-06-01T00:00:00Z');
const hour = 3_600_000;

it('lets a lone hungry queen leave the nursery, eat outside food and return to shelter', () => {
  const state = newState(start); state.plants = [];
  const queen = releaseBug(state, 'ant', 2, 2); queen.energy = 10; queen.hunger = 90;
  const food = dropLandFood(state, 3, 2, 1);
  advance(state, start + 5 * 60_000, 'UTC');
  expect(queen.role).toBe('queen'); expect(queen.inside).toBeDefined();
  expect(queen.energy).toBeGreaterThan(20); expect(queen.hunger).toBeLessThan(60);
  expect(state.food!.some(f => f.id === food.id)).toBe(false); expect(validState(state)).toBe(true);
});

it('protects marked plants from ants while unprotected plants remain harvestable', () => {
  const state = newState(start);
  const queen = releaseBug(state, 'ant', 2, 2); queen.role = 'queen'; queen.energy = 100;
  releaseBug(state, 'ant', 4, 0).role = 'worker';
  state.nests = [{ id: `nest-${state.nextId++}`, x: 2, y: 2, depth: 5, food: 0 }];
  for (const c of state.soil) c.allowAntForaging = false;
  const control = structuredClone(state); control.soil[4].allowAntForaging = true;
  advance(state, start + 2 * 60_000, 'UTC'); advance(control, start + 2 * 60_000, 'UTC');
  expect(state.plants[1].health).toBe(100); expect(control.plants[1].health).toBeLessThan(100);
  expect(validState(state)).toBe(true);
  expect(validState({ ...state, soil: state.soil.map(c => ({ ...c, allowAntForaging: 'no' })) })).toBe(false);
});

it('replays scheduled watering chronologically with the same result as continuous simulation', () => {
  const state = newState(start); state.plants[0].health = 10;
  state.irrigation = [{ x: 0, y: 0, targetMoisture: 60, intervalMinutes: 60, lastWateredAtMs: start }];
  const continuous = structuredClone(state);
  for (let i = 1; i <= 360; i++) advance(continuous, start + i * 60_000, 'UTC');
  const changes = advance(state, start + 6 * hour, 'UTC');
  expect(state).toEqual(continuous);
  expect(changes.filter(c => c.kind === 'irrigation')).toEqual([expect.objectContaining({ text: expect.stringContaining('执行 6 次') })]);
  const previous = state.plants[0].health;
  advance(state, start + 6 * hour + 10_000, 'UTC');
  expect(state.plants[0].health).toBe(previous); expect(validState(state)).toBe(true);
});

it('explains rising moisture in a dry cell without adding water to the whole box', () => {
  const state = newState(start); state.soil.forEach(c => { c.moisture = 75; }); state.soil[0].moisture = 45;
  const before = captureConditions(state); advance(state, start + hour, 'UTC');
  const report = createReturnReport(before, state);
  expect(report.changes.find(c => c.metric === 'soil(0,0).moisture')!.delta).toBeGreaterThan(0);
  expect(report.changes.find(c => c.metric === 'meanMoisture')!.delta).toBeLessThan(0);
  expect(report.moistureExplanation).toContain('没有露水'); expect(report.simulatedHours).toBe(1);
});

it('supports sowing, collecting and sprouting fern and clover without resetting existing saves', () => {
  const state = newState(start); const ids = state.plants.map(p => p.id);
  const fern = sow(state, 'fern', 1, 2); const clover = sow(state, 'clover', 3, 2);
  collect(state, fern.id); restoreCollected(state, fern.id, 1, 2);
  advance(state, start + 10 * hour, 'Asia/Shanghai');
  expect(state.plants).toEqual(expect.arrayContaining([expect.objectContaining({ id: fern.id, species: 'fern' }), expect.objectContaining({ id: clover.id, species: 'clover' })]));
  expect(state.plants.filter(p => ids.includes(p.id))).toHaveLength(ids.length); expect(validState(JSON.parse(JSON.stringify(state)))).toBe(true);
});

it('reports actual aquatic plant damage, species, position and water conditions on death', () => {
  const state = newAquarium(start), plant = state.plants[0]; plant.health = .01; state.cleanliness = 0;
  const changes = advanceAquarium(state, start + 10 * 60_000, 'UTC');
  const text = changes.find(c => c.text.includes('枯死'))!.text;
  for (const part of [plant.id, plant.species, '(0,0)', '水质低于 30', '含氧', '水质 0.0']) expect(text).toContain(part);
  expect(state.plants.some(p => p.id === plant.id)).toBe(false); expect(validAquarium(state)).toBe(true);
});

it('keeps unrecorded old scores blank and records complete scores for new hourly samples', () => {
  for (const state of [newState(start), newAquarium(start)]) {
    delete state.history[0].score;
    if ('fish' in state) advanceAquarium(state, start + hour, 'UTC'); else advance(state, start + hour, 'UTC');
    const samples = recentScores(state, start + hour);
    expect(samples[0].score).toBeNull(); expect(samples.at(-1)!.score).toBe(score(state));
  }
});

it('exposes startup care checks, nest feeding and cell protection through the World and keeps preferences after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-return-')), file = join(dir, 'state.json');
  const state = newState(start); state.nests = [{ id: 'nest-1', x: 2, y: 2, depth: 1, food: 0 }]; state.nextId = 2;
  await saveState(file, state);
  const events: { type: string }[] = [];
  const host = { log: { warn() {} }, async pushEvent(event: { type: string }) { events.push(event); return event; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => start + hour });
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(String(await world.tools().find(t => t.name === name)!.handler(args, {} as ToolCallContext)));
  try {
    await world.start(host);
    const result = await call('terrarium_inspect', { habitat: 'land' });
    expect(result.returnReport.elapsedHours).toBe(1); expect(result.score).toBeDefined();
    expect(result.scoreHistory).toBeUndefined();
    expect(events.filter(e => e.type === 'terrarium.return')).toHaveLength(1);
    expect((await call('terrarium_feed_nest', { id: 'nest-1', portions: 100 })).added).toBe(state.nests[0].depth * 20);
    await call('terrarium_set_ant_foraging', { x: 0, y: 0, enabled: false });
    await expect(call('terrarium_set_ant_foraging', { x: 8, y: 0, enabled: false })).rejects.toThrow();
    const scores = await call('terrarium_score_history', {}); expect(scores.samples.at(-1).score).toBeDefined();
    await world.stop(); await world.start(host);
    expect((await call('terrarium_inspect', { habitat: 'land', section: 'soil' })).soil[0].allowAntForaging).toBe(false);
    expect(events.filter(e => e.type === 'terrarium.return')).toHaveLength(1);
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});


it('hides numeric legacy scores from the current-formula score curve', () => {
  for (const state of [newState(start), newAquarium(start)]) {
    state.history[0].score = 9999; delete state.history[0].scoreVersion;
    if ('fish' in state) advanceAquarium(state, start + hour, 'UTC'); else advance(state, start + hour, 'UTC');
    expect(recentScores(state, start + hour)[0].score).toBeNull();
    expect(recentScores(state, start + hour).at(-1)?.score).toBe(score(state));
  }
});
