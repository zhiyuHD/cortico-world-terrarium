import { expect, it } from 'vitest';
import { advance, newState, releaseBug, feedBug, validState } from '../src/state.ts';
import { advanceAquarium, newAquarium, stockFish, validAquarium } from '../src/aquarium.ts';
import { recordDeath, TERRARIUM_MAX_DEATH_RECORDS } from '../src/deaths.ts';

const time = Date.parse('2026-06-01T06:00:00Z');
it('persists starvation evidence and does not count artificial energy feeding as a meal', () => {
  const s = newState(time); s.plants = [];
  const b = releaseBug(s, 'beetle', 2, 2); b.hunger = 99.99;
  feedBug(s, b.id); advance(s, time + 60_000, 'UTC');
  expect(s.bugs).toHaveLength(0);
  expect(s.deaths).toMatchObject([{ cause: '饥饿值达到 100', organism: { id: b.id, hunger: 100, energy: 95 }, environment: { phase: 'day' } }]);
  expect(s.deaths![0].organism.lastMeal).toBeUndefined();
  expect(validState(JSON.parse(JSON.stringify(s)))).toBe(true);
  s.deaths![0].recordedAtMs = s.updatedAtMs + 1;
  expect(validState(s)).toBe(false);
});

it('records real foraging before lifespan death and preserves a snapshot after organism mutation', () => {
  const s = newState(time);
  const b = releaseBug(s, 'aphid', 0, 0); b.ageHours = 119.99; b.hunger = 80;
  advance(s, time + 60_000, 'UTC');
  expect(s.deaths).toHaveLength(1);
  expect(s.deaths![0].organism.lastMeal).toMatchObject({ atMs: time + 60_000, kind: 'foraging' });
  b.energy = 0;
  expect(s.deaths![0].organism.energy).toBeGreaterThan(0);
});

it('records aquatic predation and environmental death with last meal data', () => {
  const s = newAquarium(time); const prey = stockFish(s, 'guppy', 1, 1), hunter = stockFish(s, 'perch', 1, 1);
  advanceAquarium(s, time + 600_000, 'UTC');
  expect(s.deaths).toMatchObject([{ organism: { id: prey.id }, cause: expect.stringContaining(hunter.id) }]);
  s.oxygen = 0; s.cleanliness = 0; hunter.health = .01;
  advanceAquarium(s, time + 1_200_000, 'UTC');
  expect(s.deaths!.at(-1)).toMatchObject({ organism: { id: hunter.id, lastMeal: { id: prey.id, kind: 'fish' } }, environment: { cleanliness: 0 } });
  expect(validAquarium(JSON.parse(JSON.stringify(s)))).toBe(true);
});

it('bounds death history without changing ecosystem IDs or retaining shared references', () => {
  const s = newState(time);
  for (let i = 0; i < TERRARIUM_MAX_DEATH_RECORDS + 3; i++) recordDeath(s, { id: `bug-${i}`, species: 'beetle', x: 0, y: 0 }, time + i, '寿命', { moisture: 50 });
  expect(s.deaths).toHaveLength(TERRARIUM_MAX_DEATH_RECORDS);
  expect(s.deaths![0].organism.id).toBe('bug-3');
});
