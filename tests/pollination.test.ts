import { expect, it } from 'vitest';
import { advance, newState, releaseBug, settlePlantGrowth, sow, validState } from '../src/state.ts';
import { flowerStage, TERRARIUM_SUNFLOWER } from '../src/habitat.ts';
import { TERRARIUM_POLLINATION, visitFlower } from '../src/pollination.ts';
import { collect, restoreCollected } from '../src/collection.ts';

const start = Date.parse('2026-06-01T00:00:00Z'), hour = 3_600_000;
function meadow() {
  const state = newState(start);
  state.plants = [0, 1].map(x => ({ id: `daisy-${x}`, species: 'daisy', x, y: 4, moisture: 50, growthHours: 18, stage: 3, dry: false, health: 100 }));
  return state;
}
it('accepts new flower species through sowing and distinguishes self visits, foreign pollen and same-species cross pollination', () => {
  const state = meadow(), bee = releaseBug(state, 'bee', 0, 4);
  sow(state, 'lavender', 4, 4);
  expect(flowerStage(state.plants[0])).toBe('bloom');
  expect(visitFlower(bee, state.plants[0], start)).toBe(false);
  bee.x = 1;
  expect(visitFlower(bee, state.plants[1], start + 1)).toBe(false);
  expect(visitFlower(bee, state.plants[1], start + TERRARIUM_POLLINATION.nectarIntervalMs)).toBe(true);
  expect(state.plants[1].pollination).toBe(1);
  bee.x = 0; bee.pollen!.species = 'lavender';
  expect(visitFlower(bee, state.plants[0], start + hour)).toBe(false);
  bee.pollen = { species: 'daisy', plantId: 'daisy-1' };
  state.plants[0].pollination = TERRARIUM_POLLINATION.maxCharges;
  expect(visitFlower(bee, state.plants[0], start + 2 * hour)).toBe(false);
  expect(state.plants[0].pollination).toBe(TERRARIUM_POLLINATION.maxCharges);
});
it('lets pollinators cross-pollinate tomato flowers for fruit bonuses', () => {
  const state = newState(start);
  state.plants = [0, 1].map(x => ({ id: `tomato-${x}`, species: 'tomato' as const, x, y: 4, moisture: 50, growthHours: 30, fruitGrowthHours: 18, stage: 3, dry: false, health: 100 }));
  const bee = releaseBug(state, 'bee', 0, 4);
  expect(visitFlower(bee, state.plants[0], start)).toBe(false);
  bee.x = 1;
  expect(visitFlower(bee, state.plants[1], start + TERRARIUM_POLLINATION.nectarIntervalMs)).toBe(true);
  expect(state.plants[1].pollination).toBe(1);
});
it('converts a pollination charge into extra seed food once and preserves completed rounds through collection', () => {
  const state = meadow(), plant = state.plants[0];
  plant.growthHours = TERRARIUM_SUNFLOWER.seedHours;
  plant.pollination = 1;
  settlePlantGrowth(state, plant, 'bloom', start);
  expect(state.food?.[0]).toMatchObject({ kind: 'flower_seed', portions: TERRARIUM_SUNFLOWER.seedPortions + TERRARIUM_POLLINATION.bonusSeedPortions });
  expect(plant.pollination).toBe(0);
  settlePlantGrowth(state, plant, 'bloom', start);
  expect(state.food).toHaveLength(1);
  collect(state, plant.id); restoreCollected(state, plant.id, 0, 4);
  settlePlantGrowth(state, state.plants.find(p => p.id === plant.id)!, 'bloom', start);
  expect(state.food).toHaveLength(1);
  expect(validState(state)).toBe(true);
});
it('seeks flowers by day, rests at night, survives save/reload, and summarizes pollination instead of individual visits', () => {
  const whole = meadow(); releaseBug(whole, 'butterfly', 0, 4);
  const stepped = structuredClone(whole);
  const changes = advance(whole, start + 3 * hour, 'Asia/Shanghai');
  for (let i = 1; i <= 18; i++) advance(stepped, start + i * hour / 6, 'Asia/Shanghai');
  expect(whole.plants.map(p => p.pollination ?? 0)).toEqual(stepped.plants.map(p => p.pollination ?? 0));
  expect(whole.plants.some(p => (p.pollination ?? 0) > 0)).toBe(true);
  expect(changes.filter(c => c.text.includes('异株授粉'))).toHaveLength(1);
  expect(validState(JSON.parse(JSON.stringify(whole)))).toBe(true);
  const night = meadow(); night.updatedAtMs = Date.parse('2026-06-01T12:00:00Z');
  const bee = releaseBug(night, 'bee', 0, 4);
  advance(night, night.updatedAtMs + hour, 'Asia/Shanghai');
  expect(bee).toMatchObject({ x: 0, y: 4 });
  expect(bee.pollen).toBeUndefined();
});
it('rejects malformed pollen and pollination fields at save boundaries', () => {
  const state = meadow(), bee = releaseBug(state, 'bee', 0, 4);
  state.plants[0].pollination = -1;
  expect(validState(state)).toBe(false);
  delete state.plants[0].pollination;
  bee.pollen = { species: 'daisy', plantId: '' };
  expect(validState(state)).toBe(false);
});
