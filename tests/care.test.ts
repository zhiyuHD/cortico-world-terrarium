import { expect, it } from 'vitest';
import { landCare, phaseTiming, waterCare } from '../src/care.ts';
import { newState, sow, waterArea, waterSoil, validState } from '../src/state.ts';
import { advanceAquarium, newAquarium, stockFish, validAquarium } from '../src/aquarium.ts';
import { collect, restoreCollected } from '../src/collection.ts';
const start = Date.parse('2026-06-01T00:00:00Z');

it('waters by dose or target, skips sufficiently moist cells and does not heal a no-op', () => {
  const state = newState(start); state.plants[0].health = 40;
  waterSoil(state, 0, 0, { amount: 10 }); expect(state.soil[0].moisture).toBe(55);
  waterSoil(state, 0, 0, { targetMoisture: 60 }); expect(state.soil[0].moisture).toBe(60);
  const health = state.plants[0].health;
  waterSoil(state, 0, 0, { targetMoisture: 30 }); expect(state.plants[0].health).toBe(health);
  state.soil[1].moisture = 0;
  waterArea(state, 0, 0, 1, 0, { amount: 10, onlyDry: true });
  expect(state.soil[0].moisture).toBe(60); expect(state.soil[1].moisture).toBe(10);
  const before = structuredClone(state);
  expect(() => waterArea(state, 0, 0, 4, 4, { amount: -10 })).toThrow();
  expect(() => waterSoil(state, 0, 0, { amount: 10, targetMoisture: 50 })).toThrow(); expect(state).toEqual(before);
});

it('reports exact growth deficits and distinguishes night from unsuitable daylight', () => {
  const state = newState(start); state.plants[0].moisture = 10;
  const care = landCare(state, start, 'Asia/Shanghai');
  expect(care.plants[0]).toMatchObject({ moistureShortfall: 20, moistureExcess: 0, canGrowNow: false, nextStage: 1, suitableHoursRemaining: 2 });
  const night = Date.parse('2026-06-01T15:00:00Z');
  expect(phaseTiming(night, 'Asia/Shanghai')).toMatchObject({ phase: 'night', nextPhaseAtMs: Date.parse('2026-06-01T22:00:00Z') });
  expect(landCare(state, night, 'Asia/Shanghai').plants.every(p => p.waitForDaylight)).toBe(true);
});

it('forecasts with the simulation without mutating the aquarium or emitting its projected events', () => {
  const now = Date.parse('2026-06-01T15:00:00Z'); const state = newAquarium(now);
  stockFish(state, 'guppy', 2, 2); state.oxygen = 50; const before = structuredClone(state);
  const care = waterCare(state, now, 'Asia/Shanghai');
  const projected = structuredClone(state); advanceAquarium(projected, care.oxygenForecast.atMs, 'Asia/Shanghai');
  expect(care.oxygenForecast.oxygen).toBe(projected.oxygen); expect(state).toEqual(before);
  expect(care.plants.every(p => p.waitForDaylight)).toBe(true);
});

it('freezes organisms inside the saved state, restores into valid capacity and rejects malformed collections', () => {
  const land = newState(start); sow(land, 'basil', 2, 2);
  const original = structuredClone(land.plants[0]); collect(land, original.id);
  expect(land.plants.some(p => p.id === original.id)).toBe(false); expect(validState(land)).toBe(true);
  const saved = JSON.parse(JSON.stringify(land)); restoreCollected(saved, original.id, 1, 1);
  expect(saved.plants.find((p: { id: string }) => p.id === original.id)).toMatchObject({ id: original.id, health: original.health, x: 1, y: 1 });
  expect(saved.collection).toEqual([]); expect(validState(saved)).toBe(true);
  const water = newAquarium(start); const fish = stockFish(water, 'guppy', 2, 2); collect(water, fish.id);
  expect(validAquarium(water)).toBe(true); for (let i = 0; i < 12; i++) stockFish(water, 'guppy', 2, 2);
  const before = structuredClone(water); expect(() => restoreCollected(water, fish.id, 2, 2)).toThrow('capacity'); expect(water).toEqual(before);
  expect(validAquarium({ ...water, collection: [{ kind: 'fish', specimen: { ...fish, health: -1 } }] })).toBe(false);
  expect(validState({ ...land, collection: [{ kind: 'fish', specimen: fish }] })).toBe(false);
});

it('warns once below oxygen 40 and rearms only after recovery to 50', () => {
  const state = newAquarium(start); state.oxygen = 39;
  expect(advanceAquarium(state, start + 1000, 'UTC').filter(c => c.kind === 'oxygen')).toHaveLength(1);
  expect(advanceAquarium(state, start + 2000, 'UTC').filter(c => c.kind === 'oxygen')).toHaveLength(0);
  state.oxygen = 55; advanceAquarium(state, start + 3000, 'UTC'); state.oxygen = 39;
  expect(advanceAquarium(state, start + 4000, 'UTC').filter(c => c.kind === 'oxygen')).toHaveLength(1);
});

it('lets healthy-water daylight restore grazed plants and stops healthy goldfish grazing', () => {
  const state = newAquarium(start), algae = state.plants.find(p => p.species === 'algae')!;
  algae.health = 30; const fish = stockFish(state, 'goldfish', 4, 0); fish.energy = 90;
  advanceAquarium(state, start + 3_600_000, 'Asia/Shanghai');
  expect(algae.health).toBeGreaterThan(30); expect(fish.energy).toBeGreaterThan(70); expect(validAquarium(state)).toBe(true);
});

it('reports the actual last consumed food and preserves it in saves and collections', () => {
  const state = newAquarium(start), fish = stockFish(state, 'goldfish', 4, 0);
  const algae = state.plants.find(p => p.species === 'algae')!;
  advanceAquarium(state, start + 10 * 60_000, 'Asia/Shanghai');
  expect(fish.lastMeal).toEqual({ atMs: start + 10 * 60_000, kind: 'algae', id: algae.id });
  expect(waterCare(state, state.updatedAtMs, 'Asia/Shanghai').feeding[0].lastMeal).toEqual(fish.lastMeal);
  collect(state, fish.id); expect(validAquarium(JSON.parse(JSON.stringify(state)))).toBe(true);
  restoreCollected(state, fish.id, 1, 1); expect(state.fish[0].lastMeal).toEqual(fish.lastMeal);
  expect(validAquarium({ ...state, fish: [{ ...fish, lastMeal: { ...fish.lastMeal!, atMs: state.updatedAtMs + 1 } }] })).toBe(false);
});

it('rejects archived IDs that collide with active organisms and refreshes moisture on restore', () => {
  const state = newState(start); const plant = structuredClone(state.plants[0]);
  expect(validState({ ...state, collection: [{ kind: 'plant', specimen: plant }] })).toBe(false);
  collect(state, plant.id); state.soil[6].moisture = 0; restoreCollected(state, plant.id, 1, 1);
  expect(state.plants.find(p => p.id === plant.id)).toMatchObject({ moisture: 0, dry: true });
});

it('accepts frozen land bugs with actual meal timestamps and preserves them when restored', () => {
  const s = newState(start);
  s.bugs.push({ id: 'bug-meal', species: 'aphid', x: 0, y: 0, energy: 60, hunger: 30, ageHours: 2, lastMeal: { atMs: start, kind: 'foraging' } });
  collect(s, 'bug-meal');
  expect(validState(JSON.parse(JSON.stringify(s)))).toBe(true);
  restoreCollected(s, 'bug-meal', 1, 1);
  expect(s.bugs[0].lastMeal?.atMs).toBe(start);
});
