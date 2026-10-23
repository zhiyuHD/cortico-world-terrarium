import { expect, it } from 'vitest';
import { advanceAquarium, newAquarium, stockFish, validAquarium } from '../src/aquarium.ts';
import { advanceFishBreeding, clutchCapacity, TERRARIUM_FISH_BREEDING } from '../src/fish-breeding.ts';
import { collect, restoreCollected } from '../src/collection.ts';
import { inspectState } from '../src/inspect.ts';

import { capacity } from '../src/progression.ts';

const start = Date.parse('2026-06-01T00:00:00Z'), hour = 3_600_000;
function nursery() {
  const state = newAquarium(start);
  state.plants[0].growthHours = 12; state.plants[0].stage = 3;
  for (let i = 0; i < 2; i++) {
    const fish = stockFish(state, 'neon_tetra', 0, 0);
    fish.ageHours = TERRARIUM_FISH_BREEDING.maturityHours; fish.energy = 100;
  }
  return state;
}
it('spawns only from healthy mature pairs near cover, respects cooldown, and does not give a new clutch retroactive incubation', () => {
  const state = nursery();
  expect(advanceFishBreeding(state, start, start + hour)).toEqual({ laid: TERRARIUM_FISH_BREEDING.eggsPerClutch, hatched: 0, lost: 0 });
  expect(state.eggs?.every(egg => egg.incubationHours === 0)).toBe(true);
  expect(advanceFishBreeding(state, start + hour, start + 2 * hour).laid).toBe(0);
  for (const bad of ['young', 'hungry', 'alone', 'water', 'cover']) {
    const s = nursery();
    if (bad === 'young') s.fish[0].ageHours = 0;
    if (bad === 'hungry') s.fish[0].energy = 20;
    if (bad === 'alone') s.fish.pop();
    if (bad === 'water') s.cleanliness = 40;
    if (bad === 'cover') s.plants = [];
    expect(advanceFishBreeding(s, start, start + hour).laid, bad).toBe(0);
  }
});
it('hatches into small juveniles, matures them, persists eggs, and summarizes a whole aquarium advance', () => {
  const state = nursery();
  advanceFishBreeding(state, start - hour, start);
  expect(validAquarium(state)).toBe(true);
  const oldSave = JSON.parse(JSON.stringify(state));
  const changes = advanceAquarium(state, start + 4 * hour, 'Asia/Shanghai');
  const children = state.fish.filter(f => f.juvenile);
  expect(children).toHaveLength(TERRARIUM_FISH_BREEDING.eggsPerClutch);
  expect(changes.filter(c => c.kind === 'birth')).toHaveLength(1);
  expect(state.eggs).toHaveLength(0);
  expect(validAquarium(state)).toBe(true);
  expect(validAquarium(oldSave)).toBe(true);
  for (const fish of children) fish.ageHours = TERRARIUM_FISH_BREEDING.juvenileHours;
  advanceFishBreeding(state, state.updatedAtMs, state.updatedAtMs + 1);
  expect(children.every(f => !f.juvenile)).toBe(true);
});
it('slows incubation in fair water and loses eggs under sustained poor water or lost cover', () => {
  const state = nursery(); advanceFishBreeding(state, start - hour, start);
  state.oxygen = 50;
  advanceFishBreeding(state, start, start + 2 * hour);
  expect(state.eggs?.[0].incubationHours).toBe(1);
  state.oxygen = 0; state.plants = [];
  expect(advanceFishBreeding(state, start + 2 * hour, start + 22 * hour).lost).toBe(TERRARIUM_FISH_BREEDING.eggsPerClutch);
  expect(state.eggs).toHaveLength(0);
});
it('reserves capacity for eggs during stocking and collection restore, and reduces clutches before full occupancy', () => {
  expect(clutchCapacity(9, 12, 2)).toBe(1);
  expect(clutchCapacity(11, 12, 2)).toBe(0);
  const state = nursery();
  const collected = stockFish(state, 'goldfish', 1, 1); collect(state, collected.id);
  advanceFishBreeding(state, start - hour, start);
  while (state.fish.length + state.eggs!.length < capacity(state).organisms) stockFish(state, 'goldfish', 1, 1);
  expect(() => stockFish(state, 'guppy', 2, 2)).toThrow('capacity');
  expect(() => restoreCollected(state, collected.id, 1, 1)).toThrow('capacity');
  expect(state.collection).toHaveLength(1);
  expect(validAquarium(state)).toBe(true);
  const summary = inspectState(state, start, 'UTC', 'summary', 0, 5);
  expect(summary.eggs).toMatchObject({ count: TERRARIUM_FISH_BREEDING.eggsPerClutch });
  const malformed = structuredClone(state); malformed.eggs![0].incubationHours = -1;
  expect(validAquarium(malformed)).toBe(false);
});

it('keeps incubation and hatch state identical across polling, save/reload and offline catch-up', () => {
  const offline = nursery(); advanceFishBreeding(offline, start - hour, start);
  let polled = structuredClone(offline);
  advanceAquarium(offline, start + 6 * hour, 'UTC');
  for (let i = 1; i <= 36; i++) {
    advanceAquarium(polled, start + i * hour / 6, 'UTC');
    expect(validAquarium(polled)).toBe(true);
    polled = JSON.parse(JSON.stringify(polled));
  }
  expect(polled.fish).toEqual(offline.fish);
  expect(polled.eggs).toEqual(offline.eggs);
  const future = structuredClone(polled);
  future.eggs = [{ id: 'future', species: 'neon_tetra', x: 0, y: 0, laidAtMs: future.updatedAtMs + 1, incubationHours: 0, health: 100 }];
  expect(validAquarium(future)).toBe(false);
});
