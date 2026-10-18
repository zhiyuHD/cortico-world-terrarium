import { expect, it } from 'vitest';
import { newState, releaseBug, sow } from '../src/state.ts';
import { newAquarium, stockFish } from '../src/aquarium.ts';
import { score, scoreParts } from '../src/scoring.ts';

it('rounds each organism contribution separately before summing the documented score parts', () => {
  const land = newState(Date.now());
  Object.assign(land.plants[0], { stage: 0, health: 95, moisture: 50 }); Object.assign(land.plants[1], { stage: 1, health: 93, moisture: 27 });
  releaseBug(land, 'aphid', 0, 0).energy = 50; releaseBug(land, 'beetle', 1, 0).energy = 50; releaseBug(land, 'spider', 2, 0).energy = 70;
  sow(land, 'basil', 1, 1); sow(land, 'bean', 2, 1);
  expect(scoreParts(land)).toEqual({ plants: 32, bugs: 18, seeds: 4 }); expect(score(land)).toBe(54);
  const water = newAquarium(Date.now()); Object.assign(water.plants[0], { stage: 0, health: 95 }); Object.assign(water.plants[1], { stage: 2, health: 85 });
  Object.assign(stockFish(water, 'guppy', 0, 1), { health: 95, energy: 90 }); Object.assign(stockFish(water, 'goldfish', 1, 1), { health: 85, energy: 80 });
  water.oxygen = 84; water.cleanliness = 81;
  expect(scoreParts(water)).toEqual({ plants: 36, fish: 36, water: 17 }); expect(score(water)).toBe(89);
});

it('scores ant energy without adding points for eggs or stored food', () => {
  const land = newState(Date.now()), initial = score(land);
  releaseBug(land, 'ant', 0, 0).energy = 60;
  land.nests = [{ id: 'nest-2', x: 0, y: 0, depth: 5, food: 100 }];
  land.eggs = [{ id: 'egg-3', species: 'ant', x: 0, y: 0, laidAtMs: land.updatedAtMs, hatchesAtMs: land.updatedAtMs + 6 * 3600000 }];
  expect(score(land) - initial).toBe(5);
});
