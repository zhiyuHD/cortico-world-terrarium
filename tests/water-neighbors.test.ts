import { expect, it } from 'vitest';
import { newAquarium, stockFish, plantAquatic, dropFishFood, advanceAquarium, validAquarium, aquaticFlower, TERRARIUM_FISH_ACTION_INTERVAL_MS as STEP } from '../src/aquarium.ts';
import { collect, restoreCollected } from '../src/collection.ts';
import { scoreParts } from '../src/scoring.ts';
const now = Date.parse('2026-06-01T08:00:00Z');
const HOUR = 3_600_000;
it('accepts new fish and plants across snapshots, history, collection and restoration', () => {
  const state = newAquarium(now);
  const fish = stockFish(state, 'corydoras', 2, 2); stockFish(state, 'neon_tetra', 1, 1);
  const hornwort = plantAquatic(state, 'hornwort', 3, 3); plantAquatic(state, 'duckweed', 4, 4);
  advanceAquarium(state, now + HOUR, 'UTC'); expect(validAquarium(state)).toBe(true);
  collect(state, fish.id); collect(state, hornwort.id); expect(validAquarium(state)).toBe(true);
  restoreCollected(state, fish.id, 1, 2); restoreCollected(state, hornwort.id, 3, 3);
  expect(validAquarium(JSON.parse(JSON.stringify(state)))).toBe(true);
});
it('moves neon followers towards a leader but lets hungry fish seek food', () => {
  const state = newAquarium(now); state.plants = [];
  const leader = stockFish(state, 'neon_tetra', 1, 1), follower = stockFish(state, 'neon_tetra', 4, 4);
  advanceAquarium(state, now + STEP, 'UTC');
  expect(Math.abs(follower.x - leader.x) + Math.abs(follower.y - leader.y)).toBeLessThan(6);
  follower.energy = 10;
  dropFishFood(state, follower.x, follower.y, 1);
  advanceAquarium(state, now + STEP * 2, 'UTC');
  expect(follower.lastMeal?.kind).toBe('food'); expect(follower.energy).toBeGreaterThan(10);
});
it('keeps fed neon followers within one cell of the leader when no food is present', () => {
  const state = newAquarium(now);
  const leader = stockFish(state, 'neon_tetra', 0, 1), follower = stockFish(state, 'neon_tetra', 1, 1);
  advanceAquarium(state, now + STEP, 'UTC');
  expect(Math.abs(follower.x - leader.x) + Math.abs(follower.y - leader.y)).toBeLessThanOrEqual(1);
});
it('corydoras prefer the oldest uneaten food even when fresh food is closer', () => {
  const state = newAquarium(now); state.plants = [];
  const cory = stockFish(state, 'corydoras', 2, 2);
  const older = dropFishFood(state, 4, 2, 1);
  state.updatedAtMs += 1;
  dropFishFood(state, 1, 2, 1);
  advanceAquarium(state, now + STEP, 'UTC'); expect(cory.x).toBe(3);
  advanceAquarium(state, now + STEP * 2, 'UTC');
  expect(cory.lastMeal).toMatchObject({ id: older.id, kind: 'food' });
  expect(state.food).toHaveLength(1); expect(validAquarium(state)).toBe(true);
});
it('corydoras do not consume food when satiated and still suffer from poor water', () => {
  const state = newAquarium(now); state.plants = [];
  const cory = stockFish(state, 'corydoras', 2, 2); cory.energy = 100;
  dropFishFood(state, 2, 2, 4); state.cleanliness = 0; state.oxygen = 0;
  advanceAquarium(state, now + STEP, 'UTC');
  expect(state.food[0].portions).toBe(4); expect(cory.lastMeal).toBeUndefined(); expect(cory.health).toBeLessThan(100);
});
it('corydoras can graze algae without removing a healthy plant', () => {
  const state = newAquarium(now); state.plants = [];
  const algae = plantAquatic(state, 'algae', 2, 2), cory = stockFish(state, 'corydoras', 2, 2);
  advanceAquarium(state, now + STEP, 'UTC');
  expect(cory.lastMeal).toMatchObject({ id: algae.id, kind: 'algae' }); expect(algae.health).toBeLessThan(100); expect(cory.energy).toBeGreaterThan(60);
});
it('mature healthy hornwort shelters neon fish from distant perch, but contact permits hunting', () => {
  const state = newAquarium(now); state.plants = [];
  const shelter = plantAquatic(state, 'hornwort', 4, 4); shelter.stage = 2; shelter.growthHours = 6;
  const hunter = stockFish(state, 'perch', 3, 4), prey = stockFish(state, 'neon_tetra', 4, 4);
  advanceAquarium(state, now + STEP, 'UTC');
  expect(state.fish.some(f => f.id === prey.id)).toBe(true); expect(state.replays).toHaveLength(0);
  hunter.x = prey.x; hunter.y = prey.y;
  advanceAquarium(state, now + STEP * 2, 'UTC');
  expect(state.fish.some(f => f.id === prey.id)).toBe(false); expect(state.replays).toHaveLength(1);
  expect(validAquarium(state)).toBe(true);
});
it.each([{ growthHours: 0, stage: 0, health: 100 }, { growthHours: 6, stage: 2, health: 10 }])('immature or unhealthy hornwort does not shelter fish: %o', condition => {
  const state = newAquarium(now); state.plants = [];
  Object.assign(plantAquatic(state, 'hornwort', 2, 2), condition);
  stockFish(state, 'perch', 1, 2); const prey = stockFish(state, 'neon_tetra', 2, 2);
  advanceAquarium(state, now + STEP, 'UTC');
  expect(state.fish.some(f => f.id === prey.id)).toBe(false); expect(validAquarium(state)).toBe(true);
});
it('mature healthy duckweed purifies water; immature and unhealthy duckweed do not', () => {
  const state = newAquarium(now); state.plants = []; state.cleanliness = 60;
  const plant = plantAquatic(state, 'duckweed', 2, 2); plant.stage = 2; plant.growthHours = 6;
  const immature = structuredClone(state); immature.plants[0].stage = 0; immature.plants[0].growthHours = 0;
  const unhealthy = structuredClone(state); unhealthy.plants[0].health = 10;
  for (const s of [state, immature, unhealthy]) advanceAquarium(s, now + HOUR, 'UTC');
  expect(state.cleanliness).toBeCloseTo(60.12, 8); expect(immature.cleanliness).toBe(60); expect(unhealthy.cleanliness).toBe(60);
});
it('new plants continue consuming oxygen at night and hornwort provides more oxygen by day', () => {
  const make = (species: 'hornwort' | 'waterweed') => { const s = newAquarium(now); s.plants = []; s.oxygen = 50; plantAquatic(s, species, 2, 2); return s; };
  const hornwort = make('hornwort'), waterweed = make('waterweed');
  advanceAquarium(hornwort, now + HOUR, 'UTC'); advanceAquarium(waterweed, now + HOUR, 'UTC');
  expect(hornwort.oxygen).toBeGreaterThan(waterweed.oxygen);
  const night = newAquarium(now); night.plants = []; night.oxygen = 50;
  plantAquatic(night, 'hornwort', 1, 1); plantAquatic(night, 'duckweed', 2, 2);
  const empty = structuredClone(night); empty.plants = [];
  advanceAquarium(night, now + HOUR, 'Pacific/Honolulu'); advanceAquarium(empty, now + HOUR, 'Pacific/Honolulu');
  expect(night.oxygen).toBeLessThan(empty.oxygen); expect(night.plants[0].growthHours).toBe(0);
});
it('waterlilies produce one bloom event on crossing the growth threshold', () => {
  const state = newAquarium(now); const lily = plantAquatic(state, 'waterlily', 2, 2);
  lily.growthHours = 17.9; lily.stage = 3; expect(aquaticFlower(lily)).toBe('bud');
  const events = advanceAquarium(state, now + HOUR, 'UTC'); expect(aquaticFlower(lily)).toBe('bloom');
  expect(events.filter(e => e.text.includes('开花'))).toHaveLength(1);
  expect(advanceAquarium(state, now + HOUR * 2, 'UTC').filter(e => e.text.includes('开花'))).toHaveLength(0);
  lily.health = 1; expect(aquaticFlower(lily)).toBeUndefined();
});
it('new species respect existing per-species scoring caps and do not add utility bonuses', () => {
  const state = newAquarium(now); state.plants = [];
  for (let i = 0; i < 3; i++) { const p = plantAquatic(state, 'duckweed', i, 2); p.stage = 3; p.growthHours = 12; }
  const capped = scoreParts(state).plants; const extra = plantAquatic(state, 'duckweed', 3, 2); extra.stage = 3; extra.growthHours = 12;
  expect(scoreParts(state).plants).toBe(capped);
  const hornwort = plantAquatic(state, 'hornwort', 4, 2); hornwort.stage = 3; hornwort.growthHours = 12;
  expect(scoreParts(state).plants).toBe(capped + 40);
});
it('new aquatic neighbors remain within capacity and the grid under repeated and offline simulation', () => {
  const state = newAquarium(now); plantAquatic(state, 'duckweed', 2, 2);
  const cory = stockFish(state, 'corydoras', 3, 2); stockFish(state, 'neon_tetra', 4, 3); stockFish(state, 'neon_tetra', 2, 3);
  dropFishFood(state, 4, 4, 3);
  const polled = structuredClone(state);
  advanceAquarium(state, now + HOUR * 2, 'UTC');
  for (let t = now + 10_000; t <= now + HOUR * 2; t += 10_000) advanceAquarium(polled, t, 'UTC');
  expect(polled.fish.map(f => [f.id, f.x, f.y])).toEqual(state.fish.map(f => [f.id, f.x, f.y]));
  expect(polled.fish[0].energy).toBeCloseTo(cory.energy, 7); expect(polled.food).toEqual(state.food);
  expect(validAquarium(polled)).toBe(true); expect(validAquarium(state)).toBe(true);
});
