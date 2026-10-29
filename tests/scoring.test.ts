import { expect, it } from 'vitest';
import { newState, releaseBug, sow } from '../src/state.ts';
import { newAquarium, stockFish, plantAquatic } from '../src/aquarium.ts';
import { score, scoreParts, curvedScore } from '../src/scoring.ts';

const now = Date.parse('2026-06-01T00:00:00Z');
it('limits duplicate species contributions and scores diverse water plants above a monoculture', () => {
  const state = newAquarium(now); state.plants = [];
  for (let i = 0; i < 12; i++) {
    Object.assign(plantAquatic(state, 'waterweed', i % 5, Math.floor(i / 5)), { health: 100, stage: 3 });
  }
  expect(scoreParts(state)).toEqual({ plants: 70, fish: 0, water: 0 });
  state.plants = state.plants.slice(0, 3); expect(scoreParts(state).plants).toBe(70);
  state.plants[1].species = 'algae'; state.plants[2].species = 'waterlily';
  expect(scoreParts(state).plants).toBe(120);
  state.plants.reverse(); expect(scoreParts(state).plants).toBe(120);
});
it('selects the strongest three per species regardless of report ordering', () => {
  const state = newAquarium(now); state.plants = [];
  for (const [i, health] of [10, 100, 50, 80].entries()) Object.assign(plantAquatic(state, 'waterweed', i, 0), { stage: 3, health });
  expect(scoreParts(state).plants).toBe(61);
  state.plants.reverse(); expect(scoreParts(state).plants).toBe(61);
});
it('penalizes hunger independently of energy and rewards surviving to adulthood', () => {
  const state = newState(now), bug = releaseBug(state, 'spider', 1, 1);
  Object.assign(bug, { energy: 100, hunger: 0, ageHours: 24 });
  expect((scoreParts(state) as { bugs: number }).bugs).toBe(40);
  bug.hunger = 90; expect((scoreParts(state) as { bugs: number }).bugs).toBe(4);
  bug.energy = 100; expect((scoreParts(state) as { bugs: number }).bugs).toBe(4);
  bug.hunger = 0; bug.ageHours = 0; expect((scoreParts(state) as { bugs: number }).bugs).toBe(10);
  bug.ageHours = 240; expect((scoreParts(state) as { bugs: number }).bugs).toBe(40);
});
it('awards no points for seeds, eggs, stores, collected specimens or excess watering', () => {
  const state = newState(now), before = score(state);
  sow(state, 'bean', 1, 2);
  state.nests = [{ id: 'nest', x: 0, y: 0, depth: 5, food: 100 }];
  state.eggs = [{ id: 'egg', species: 'ant', x: 0, y: 0, laidAtMs: now, hatchesAtMs: now + 3600000 }];
  for (const plant of state.plants) plant.moisture = 100;
  expect(score(state)).toBe(before); expect((scoreParts(state) as { seeds: number }).seeds).toBe(0);
});
it('reduces fish points in poor water and gives empty aquariums no environment points', () => {
  const state = newAquarium(now); state.oxygen = 100; state.cleanliness = 100;
  expect((scoreParts(state) as { water: number }).water).toBe(0);
  const fish = stockFish(state, 'guppy', 2, 2);
  Object.assign(fish, { ageHours: 24, energy: 100, health: 100 });
  state.plants.forEach(p => { p.stage = 3; p.health = 100; });
  expect(scoreParts(state)).toEqual({ plants: 80, fish: 40, water: 40 });
  state.cleanliness = 10;
  expect(scoreParts(state)).toEqual({ plants: 80, fish: 8, water: 1 });
  fish.health = 0; expect((scoreParts(state) as { water: number }).water).toBe(0);
});
it('makes the highest expansion threshold attainable with healthy, diverse mature aquariums', () => {
  const state = newAquarium(now); state.plants = []; state.fish = [];
  const plants = ['waterweed', 'waterlily', 'algae'] as const;
  const fish = ['guppy', 'goldfish', 'perch'] as const;
  for (let i = 0; i < 9; i++) {
    Object.assign(plantAquatic(state, plants[i % 3], i % 5, Math.floor(i / 5)), { health: 100, stage: 3 });
    Object.assign(stockFish(state, fish[i % 3], 4, 4), { health: 100, energy: 100, ageHours: 24 });
  }
  state.oxygen = 100; state.cleanliness = 100;
  expect(score(state)).toBe(curvedScore(460));
  expect(Object.values(scoreParts(state)).reduce((sum, value) => sum + value, 0)).toBe(score(state));
});

it('keeps early scores unchanged, then grows with diminishing returns and no fixed ceiling', () => {
  for (let base = 0; base <= 200; base++) expect(curvedScore(base)).toBe(base);
  const bases = [200, 400, 600, 800, 1000, 1200];
  const values = bases.map(curvedScore);
  const gains = values.slice(1).map((value, index) => value - values[index]);
  expect(gains.every((gain, index) => gain > 0 && (index === 0 || gain < gains[index - 1]))).toBe(true);
  for (let base = 0; base < 10000; base++) expect(curvedScore(base + 1)).toBeGreaterThanOrEqual(curvedScore(base));
  expect(curvedScore(1e9)).toBeGreaterThan(curvedScore(1e6));
});

it('keeps curved shares integral, preserves zero categories and ignores organism order', () => {
  const state = newAquarium(now); state.plants = []; state.fish = [];
  for (let i = 0; i < 9; i++) {
    Object.assign(plantAquatic(state, (['waterweed', 'algae', 'waterlily'] as const)[i % 3], i % 5, Math.floor(i / 5)), { health: 100, stage: 3 });
    Object.assign(stockFish(state, (['guppy', 'goldfish', 'perch'] as const)[i % 3], 4, 4), { health: 100, energy: 100, ageHours: 24 });
  }
  state.oxygen = 100; state.cleanliness = 100;
  const parts = scoreParts(state);
  expect(Object.values(parts).every(Number.isSafeInteger)).toBe(true);
  expect(Object.values(parts).reduce((sum, value) => sum + value, 0)).toBe(curvedScore(460));
  state.plants.reverse(); state.fish.reverse(); expect(scoreParts(state)).toEqual(parts);
  state.fish = [];
  expect(scoreParts(state)).toEqual({ plants: curvedScore(210), fish: 0, water: 0 });
});
