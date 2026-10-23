import { expect, it } from 'vitest';
import { advance, newState, releaseBug, removeOrganism, validState, TERRARIUM_WEB_LIFETIME_MS, TERRARIUM_WEBS_PER_SPIDER } from '../src/state.ts';
import { flightDraw, TERRARIUM_FLY_ACTION_INTERVAL_MS, TERRARIUM_FLY_MOVE_PROBABILITY, TERRARIUM_FLY_SPECIES } from '../src/flight.ts';

it('moves 75% of flying actions, stays otherwise, and never leaves the grid', () => {
  let moved = 0;
  for (let i = 0; i < 4000; i++) {
    const start = 6 * 3_600_000 + i * TERRARIUM_FLY_ACTION_INTERVAL_MS;
    const state = newState(start), bug = releaseBug(state, TERRARIUM_FLY_SPECIES[i % TERRARIUM_FLY_SPECIES.length], i % 5, i % 5);
    const x = bug.x, y = bug.y;
    advance(state, start + TERRARIUM_FLY_ACTION_INTERVAL_MS - 1, 'UTC');
    expect([bug.x, bug.y]).toEqual([x, y]);
    advance(state, start + TERRARIUM_FLY_ACTION_INTERVAL_MS, 'UTC');
    const distance = Math.abs(bug.x - x) + Math.abs(bug.y - y);
    expect(distance).toBe(flightDraw(bug.id, start + TERRARIUM_FLY_ACTION_INTERVAL_MS) < TERRARIUM_FLY_MOVE_PROBABILITY ? 1 : 0);
    expect(bug.x).toBeGreaterThanOrEqual(0); expect(bug.x).toBeLessThan(5);
    expect(bug.y).toBeGreaterThanOrEqual(0); expect(bug.y).toBeLessThan(5);
    moved += distance;
  }
  expect(moved / 4000).toBeGreaterThan(TERRARIUM_FLY_MOVE_PROBABILITY - .035);
  expect(moved / 4000).toBeLessThan(TERRARIUM_FLY_MOVE_PROBABILITY + .035);
});

it('keeps flight positions identical across frequent polling, saves and offline catch-up', () => {
  const original = newState(0); releaseBug(original, 'moth', 2, 2);
  const offline = structuredClone(original); let polled = structuredClone(original);
  advance(offline, 120_000, 'UTC');
  for (let at = 997; at < 120_000; at += 997) { advance(polled, at, 'UTC'); polled = JSON.parse(JSON.stringify(polled)); }
  advance(polled, 120_000, 'UTC');
  expect(polled.bugs.map(({ id, x, y }) => ({ id, x, y }))).toEqual(offline.bugs.map(({ id, x, y }) => ({ id, x, y })));
});

it('weaves at most once per hour, retains three webs and clears owned webs when removed', () => {
  const state = newState(0), spider = releaseBug(state, 'spider', 0, 2);
  spider.energy = 100; advance(state, 60_000, 'UTC'); expect(state.webs).toHaveLength(1);
  spider.x = 1; advance(state, 120_000, 'UTC'); expect(state.webs).toHaveLength(1);
  for (let hour = 1; hour <= 4; hour++) { spider.x = hour; advance(state, hour * 3600_000 + 60_000, 'UTC'); }
  expect(state.webs).toHaveLength(TERRARIUM_WEBS_PER_SPIDER); expect(validState(state)).toBe(true);
  expect(new Set(state.webs!.map(web => web.x))).toEqual(new Set([2, 3, 4]));
  removeOrganism(state, spider.id); expect(state.webs).toEqual([]);
});

it('catches an arriving fly with the web owner and preserves valid before, contact and after replay frames', () => {
  const state = newState(0), spider = releaseBug(state, 'spider', 4, 4), fly = releaseBug(state, 'fruit_fly', 2, 2);
  const draw = flightDraw(fly.id, TERRARIUM_FLY_ACTION_INTERVAL_MS);
  expect(draw).toBeLessThan(TERRARIUM_FLY_MOVE_PROBABILITY);
  const [dx, dy] = [[1,0],[0,1],[-1,0],[0,-1]][Math.floor(draw / TERRARIUM_FLY_MOVE_PROBABILITY * 4)];
  state.webs = [{ id: 'test-web', spiderId: spider.id, x: fly.x + dx, y: fly.y + dy, createdAtMs: 0 }];
  spider.energy = 40; spider.hunger = 70;
  const changes = advance(state, TERRARIUM_FLY_ACTION_INTERVAL_MS, 'UTC');
  expect(state.bugs.map(bug => bug.id)).toEqual([spider.id]); expect(spider.energy).toBeGreaterThan(69); expect(spider.hunger).toBeLessThan(11);
  expect(changes.filter(change => change.kind === 'hunt')).toHaveLength(1);
  const replay = state.replays![0]; expect(replay.frames).toHaveLength(3);
  expect(replay.frames[0].bugs.find(bug => bug.id === fly.id)).toMatchObject({ x: 2, y: 2 });
  expect(replay.frames[1].bugs.find(bug => bug.id === fly.id)).toMatchObject({ x: spider.x, y: spider.y });
  expect(replay.frames[2].bugs.some(bug => bug.id === fly.id)).toBe(false);
  expect(validState(JSON.parse(JSON.stringify(state)))).toBe(true);
});

it('does not catch flies with expired webs or webs belonging to a starving spider', () => {
  for (const expired of [true, false]) {
    const start = expired ? TERRARIUM_WEB_LIFETIME_MS - TERRARIUM_FLY_ACTION_INTERVAL_MS : 0;
    const state = newState(start), spider = releaseBug(state, 'spider', 4, 4), fly = releaseBug(state, 'mosquito', 2, 2);
    if (!expired) spider.hunger = 100;
    state.webs = [{ id: 'old-web', spiderId: spider.id, x: 2, y: 2, createdAtMs: 0 }];
    advance(state, start + TERRARIUM_FLY_ACTION_INTERVAL_MS, 'UTC');
    expect(state.bugs.some(bug => bug.id === fly.id)).toBe(true);
    expect(state.webs!.some(web => web.id === 'old-web')).toBe(false);
    expect(validState(state)).toBe(true);
  }
});

it('rejects invalid owners and duplicate web cells without requiring webs in older states', () => {
  const state = newState(0); expect(validState(state)).toBe(true);
  const spider = releaseBug(state, 'spider', 0, 2);
  state.webs = [{ id: 'web', spiderId: 'missing', x: 0, y: 2, createdAtMs: 0 }]; expect(validState(state)).toBe(false);
  state.webs[0].spiderId = spider.id; expect(validState(state)).toBe(true);
  state.webs.push({ ...state.webs[0], id: 'duplicate' }); expect(validState(state)).toBe(false);
});

it('lets flying bugs drink nectar without damaging flowers and hatch from saved eggs', () => {
  let end = TERRARIUM_FLY_ACTION_INTERVAL_MS;
  while (flightDraw('bug-1', end) < TERRARIUM_FLY_MOVE_PROBABILITY) end += TERRARIUM_FLY_ACTION_INTERVAL_MS;
  const state = newState(end - TERRARIUM_FLY_ACTION_INTERVAL_MS);
  const flower = state.plants.find(plant => plant.species === 'clover')!; flower.growthHours = 20; flower.stage = 2;
  const fly = releaseBug(state, 'moth', flower.x, flower.y); fly.energy = 40; fly.hunger = 50;
  advance(state, end, 'UTC'); expect(fly.energy).toBeGreaterThan(44); expect(fly.hunger).toBeLessThan(36); expect(flower.health).toBe(100);
  const hatching = newState(0); hatching.eggs = [{ id: 'egg', species: 'mosquito', x: 2, y: 2, laidAtMs: 0, hatchesAtMs: 4 * 3600_000 }];
  advance(hatching, 3600_000 - 1, 'UTC'); expect(hatching.bugs).toHaveLength(0);
  advance(hatching, 3600_000, 'UTC'); expect(hatching.bugs).toHaveLength(1); expect(hatching.bugs[0]).toMatchObject({ species: 'mosquito', ageHours: 0, hunger: 0 }); expect(validState(hatching)).toBe(true);
});
