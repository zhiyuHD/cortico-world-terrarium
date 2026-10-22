import { expect, it } from 'vitest';
import { newState, sow, validState, migrateState, releaseBug } from '../src/state.ts';
import { compostStatus, compostPlant, fertilizePlot, TERRARIUM_FERTILIZER_GROWTH_HOURS } from '../src/compost.ts';
import { installFacility, observeProgress, upgradeHabitat, TERRARIUM_LEVELS } from '../src/progression.ts';
import { flowerStage, TERRARIUM_FLOWER_BLOOM_HOURS, TERRARIUM_SUNFLOWER } from '../src/habitat.ts';
import { score } from '../src/scoring.ts';
import { reportChanges, applyReportChanges } from '../src/report-protocol.ts';
const now = Date.parse('2026-06-01T20:00:00Z');
function equipped() {
  const state = newState(now);
  observeProgress(state).peakScore = TERRARIUM_LEVELS[1].requiredScore;
  upgradeHabitat(state); installFacility(state, 'compost_bin', 1, 4);
  return state;
}
it('unlocks compost at level two and requires an enabled bin', () => {
  const state = newState(now), original = structuredClone(state);
  expect(compostStatus(state)).toMatchObject({ unlocked: false, fertilizer: 0 });
  expect(() => compostPlant(state, 'fern')).toThrow('level 2');
  expect(state).toEqual(original);
  observeProgress(state).peakScore = TERRARIUM_LEVELS[1].requiredScore; upgradeHabitat(state);
  expect(() => compostPlant(state, 'fern')).toThrow('Install');
  installFacility(state, 'compost_bin', 2, 4, false);
  expect(() => compostPlant(state, 'fern')).toThrow('Install');
  installFacility(state, 'compost_bin', 2, 4);
  expect(compostPlant(state, 'fern')).toMatchObject({ composted: 'fern', received: 1, fertilizer: 1 });
  expect(state.plants.some(p => p.id === 'fern')).toBe(false);
  expect(validState(state)).toBe(true);
});
it('gives one fertilizer per plant independent of size or health, and never duplicates a removal', () => {
  const state = equipped(); state.plants[0].health = 1; state.plants[1].growthHours = 80; state.plants[1].stage = 3;
  compostPlant(state, 'fern'); compostPlant(state, 'clover');
  const saved = structuredClone(state);
  expect(() => compostPlant(state, 'fern')).toThrow('living');
  expect(state).toEqual(saved); expect(state.fertilizer).toBe(2);
});
it('applies consecutive fertilizer without cooldown and advances only the selected plant at night', () => {
  const state = equipped(), bug = releaseBug(state, 'aphid', 0, 0);
  state.fertilizer = 3;
  const before = structuredClone(state);
  const target = state.plants.find(p => p.id === 'clover')!;
  fertilizePlot(state, target.x, target.y); fertilizePlot(state, target.x, target.y, 2);
  expect(target.growthHours).toBe(3 * TERRARIUM_FERTILIZER_GROWTH_HOURS); expect(target.stage).toBe(2);
  expect(state.fertilizer).toBe(0); expect(state.updatedAtMs).toBe(before.updatedAtMs);
  expect(state.soil).toEqual(before.soil); expect(state.plants[0]).toEqual(before.plants[0]);
  expect(bug).toEqual(before.bugs[0]); expect(state.history).toEqual(before.history);
  expect(validState(state)).toBe(true);
});
it('sprouts a seed and applies leftover hours to growth, including bulk fertilization', () => {
  const state = equipped(), seed = sow(state, 'bean', 5, 5); seed.ageHours = .5;
  state.fertilizer = 100;
  fertilizePlot(state, 5, 5, 1);
  const plant = state.plants.find(p => p.id === seed.id)!;
  expect(state.seeds).toHaveLength(0); expect(plant.growthHours).toBe(.5);
  fertilizePlot(state, 5, 5, 99);
  expect(plant.growthHours).toBe(198.5); expect(state.fertilizer).toBe(0);
  expect(validState(state)).toBe(true);
});
it('settles flowers and seed heads immediately without repeating seed drops', () => {
  const state = equipped(), seed = sow(state, 'sunflower', 5, 5); state.fertilizer = 40;
  fertilizePlot(state, 5, 5);
  const plant = state.plants.find(p => p.id === seed.id)!;
  const flowering = fertilizePlot(state, 5, 5, TERRARIUM_FLOWER_BLOOM_HOURS / 2);
  expect(flowerStage(plant)).toBe('bloom'); expect(flowering.changes.some(c => c.text.includes('开花'))).toBe(true);
  fertilizePlot(state, 5, 5, (TERRARIUM_SUNFLOWER.seedHours - plant.growthHours) / 2);
  expect(plant.seedRounds).toBe(1); expect(state.food).toHaveLength(1);
  expect(state.food![0]).toMatchObject({ portions: TERRARIUM_SUNFLOWER.seedPortions, droppedAtMs: now });
  fertilizePlot(state, 5, 5);
  expect(state.food).toHaveLength(1); expect(validState(state)).toBe(true);
});
it.each([0, -1, .5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1])('rejects invalid portions %s without consuming anything', portions => {
  const state = equipped(); state.fertilizer = 2; const original = structuredClone(state);
  expect(() => fertilizePlot(state, 4, 0, portions)).toThrow(); expect(state).toEqual(original);
});
it('rejects empty plots, missing stock, seeds as compost and out-of-grid positions atomically', () => {
  const state = equipped(), seed = sow(state, 'mint', 2, 5); state.fertilizer = 1;
  for (const action of [() => fertilizePlot(state, 4, 0, 2), () => fertilizePlot(state, 2, 2), () => fertilizePlot(state, 6, 0), () => compostPlant(state, seed.id)]) {
    const before = structuredClone(state); expect(action).toThrow(); expect(state).toEqual(before);
  }
});
it('validates inventory, keeps it across save migration and full/incremental state transfer, and awards no inventory score', () => {
  const old = newState(now); expect(migrateState(structuredClone(old))).toEqual(old);
  const state = equipped(), base = structuredClone(state), previousScore = score(state); state.fertilizer = 12;
  expect(score(state)).toBe(previousScore); expect(validState(state)).toBe(true);
  expect(migrateState(JSON.parse(JSON.stringify(state))).fertilizer).toBe(12);
  expect(applyReportChanges(base, reportChanges(base, state))).toEqual(state);
  for (const bad of [-1, .5, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) expect(validState({ ...state, fertilizer: bad })).toBe(false);
});
it('accepts all four land facilities without changing the three water facility limit', () => {
  const state = equipped(); observeProgress(state).peakScore = TERRARIUM_LEVELS[3].requiredScore;
  upgradeHabitat(state); upgradeHabitat(state);
  for (const kind of ['mulch', 'shade', 'grow_light']) installFacility(state, kind, 3, 3);
  expect(state.facilities).toHaveLength(4); expect(validState(state)).toBe(true);
});

it('bulk fertilizer produces the same seed harvests as consecutive portions', () => {
  const bulk = equipped(); sow(bulk, 'sunflower', 5, 5); bulk.fertilizer = 40;
  const repeated = structuredClone(bulk);
  fertilizePlot(bulk, 5, 5, 40);
  for (let i = 0; i < 40; i++) fertilizePlot(repeated, 5, 5);
  expect(bulk).toEqual(repeated); expect(bulk.food!.length).toBeGreaterThan(1);
});
