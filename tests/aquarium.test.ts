import { expect, it } from 'vitest';
import { advanceAquarium, changeWater, dropFishFood, newAquarium, plantAquatic, stockFish, validAquarium, TERRARIUM_FISH_ACTION_INTERVAL_MS } from '../src/aquarium.ts';
const start = Date.parse('2026-06-01T00:00:00Z');

it('swims to fish food every ten minutes, consumes portions and records hourly water history', () => {
  const state = newAquarium(start);
  const fish = stockFish(state, 'guppy', 2, 2);
  dropFishFood(state, 4, 2, 2);
  advanceAquarium(state, start + TERRARIUM_FISH_ACTION_INTERVAL_MS - 1, 'Asia/Shanghai');
  expect(fish.x).toBe(2);
  advanceAquarium(state, start + TERRARIUM_FISH_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(fish.x).toBe(3);
  const energy = fish.energy;
  advanceAquarium(state, start + 2 * TERRARIUM_FISH_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(fish.energy).toBeGreaterThan(energy);
  expect(state.food[0].portions).toBe(1);
  advanceAquarium(state, start + 6 * TERRARIUM_FISH_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(state.food).toEqual([]);
  expect(state.history).toHaveLength(2);
  expect(validAquarium(state)).toBe(true);
});

it('records fish predation scenes that cannot be changed by later feeding or water changes', () => {
  const state = newAquarium(start);
  const hunter = stockFish(state, 'perch', 3, 2);
  const prey = stockFish(state, 'guppy', 4, 2);
  dropFishFood(state, 4, 2, 1);
  const changes = advanceAquarium(state, start + TERRARIUM_FISH_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(changes).toMatchObject([{ kind: 'hunt' }]);
  const replay = state.replays[0];
  expect(replay.frames[0].fish.find(f => f.id === hunter.id)?.x).toBe(3);
  expect(replay.frames[1].fish.map(f => f.id)).toContain(prey.id);
  expect(replay.frames[2].fish.map(f => f.id)).not.toContain(prey.id);
  const saved = structuredClone(replay);
  changeWater(state, 100); dropFishFood(state, 1, 1, 2);
  expect(replay).toEqual(saved);
  expect(validAquarium(state)).toBe(true);
  const corrupt = structuredClone(state); corrupt.replays[0].frames[1].fish[0].x = 8;
  expect(validAquarium(corrupt)).toBe(false);
});

it('models oxygen, polluted water, plant growth and fresh water without changing fish identity', () => {
  const state = newAquarium(start);
  const fish = stockFish(state, 'goldfish', 2, 2);
  state.oxygen = 0; state.cleanliness = 0;
  advanceAquarium(state, start + TERRARIUM_FISH_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(fish.health).toBeLessThan(100);
  const oldId = fish.id;
  dropFishFood(state, 2, 2, 10);
  changeWater(state, 100);
  expect(state.cleanliness).toBe(100); expect(state.oxygen).toBe(90); expect(state.food).toEqual([]);
  expect(fish.id).toBe(oldId);
  const plant = plantAquatic(state, 'waterlily', 2, 3);
  advanceAquarium(state, start + 3 * 3600000, 'Asia/Shanghai');
  expect(plant.growthHours).toBeGreaterThan(0);
  expect(plant.stage).toBeGreaterThan(0);
  expect(validAquarium(state)).toBe(true);
});

it('validates real aquatic boundaries and caps plants and fish', () => {
  const state = newAquarium(start);
  expect(() => stockFish(state, 'unknown', 0, 0)).toThrow('Unknown fish');
  expect(() => plantAquatic(state, 'waterweed', 0, 0)).toThrow('already');
  expect(() => stockFish(state, 'guppy', 5, 0)).toThrow('5×5');
  expect(() => dropFishFood(state, 2, 2, 11)).toThrow('1..10');
  for (let i = 0; i < 12; i++) stockFish(state, 'guppy', 2, 2);
  expect(() => stockFish(state, 'guppy', 2, 2)).toThrow('capacity');
  expect(() => changeWater(state, 0)).toThrow('1..100');
});

it('keeps ten-minute fish actions and elapsed-time metabolism during ten-second polling', () => {
  const offset = start + 3_500;
  const state = newAquarium(offset);
  const fish = stockFish(state, 'guppy', 1, 2);
  dropFishFood(state, 4, 2, 3);
  const polled = structuredClone(state);
  const end = start + 2 * TERRARIUM_FISH_ACTION_INTERVAL_MS;
  advanceAquarium(state, end, 'UTC');
  for (let now = offset + 10_000; now < end; now += 10_000) advanceAquarium(polled, now, 'UTC');
  advanceAquarium(polled, end, 'UTC');
  expect(fish).toMatchObject({ x: 3, y: 2 });
  expect(polled.fish[0]).toMatchObject({ id: fish.id, x: fish.x, y: fish.y });
  expect(polled.food).toEqual(state.food);
  expect(fish.ageHours).toBeCloseTo((end - offset) / 3_600_000, 9);
  expect(fish.energy).toBeCloseTo(60 - fish.ageHours * 2, 9);
  expect(polled.fish[0].ageHours).toBeCloseTo(fish.ageHours, 9);
  expect(polled.fish[0].energy).toBeCloseTo(fish.energy, 9);
  const position = { x: fish.x, y: fish.y };
  advanceAquarium(state, end, 'UTC');
  advanceAquarium(state, end + 1, 'UTC');
  expect(fish).toMatchObject(position);
});
