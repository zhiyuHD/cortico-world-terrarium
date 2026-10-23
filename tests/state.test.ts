import { reportChanges, applyReportChanges, reportStateHash } from '../src/report-protocol.ts';
import { flowerStage, TERRARIUM_FLOWER_BLOOM_HOURS, TERRARIUM_FLOWER_BUD_HOURS, TERRARIUM_PLANT_LOW_HEALTH, TERRARIUM_PLANT_RECOVERED_HEALTH } from '../src/habitat.ts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateState, TERRARIUM_BUG_STARVATION_HOURS, TERRARIUM_BUG_HUNGER_WARNING, advance, feedBug, loadState, move, newState, phase, releaseBug, relocateBug, removeOrganism, saveState, sow, water, waterSoil, waterArea, renameBox, validState, TERRARIUM_PREDATOR_SENSE_RADIUS, TERRARIUM_PREDATOR_SATIATED_ENERGY, TERRARIUM_MAX_NAME_LENGTH, TERRARIUM_ANT_ACTION_INTERVAL_MS, TERRARIUM_BUG_ACTION_INTERVAL_MS } from '../src/state.ts';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('terrarium state', () => {
  it('catches up growth and drying across a local night', () => {
    const start = Date.parse('2026-06-01T16:00:00Z');
    const state = newState(start);
    expect(phase(start, 'Asia/Shanghai')).toBe('night');
    const changes = advance(state, start + 15 * 60 * 60_000, 'Asia/Shanghai');
    expect(changes.some(change => change.kind === 'phase')).toBe(true);
    expect(changes.some(change => change.kind === 'stage')).toBe(true);
    expect(changes.some(change => change.kind === 'dry')).toBe(false);
    expect(state.plants[0].stage).toBeGreaterThan(0);
    expect(advance(state, start + 15 * 60 * 60_000, 'Asia/Shanghai')).toEqual([]);
    const later = advance(state, start + 45 * 60 * 60_000, 'Asia/Shanghai');
    expect(later.filter(change => change.kind === 'dry')).toHaveLength(2);
    expect(state.plants.every(plant => plant.dry)).toBe(true);
    water(state, 'fern');
    expect(state.plants[0].dry).toBe(false);
  });

  it('moves objects only into available cells', () => {
    const state = newState(0);
    expect(move(state, 'coin', 0, 2)).toMatchObject({ x: 0, y: 2 });
    expect(() => move(state, 'coin', 2, 1)).toThrow('occupied');
    expect(() => move(state, 'coin', 0, 0)).toThrow('plant');
    expect(() => move(state, 'coin', 5, 0)).toThrow('grid');
    expect(() => move(state, 'coin', NaN, 1)).toThrow('grid');
  });

  it('persists state and rejects invalid saved positions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'terrarium-'));
    dirs.push(dir);
    const file = join(dir, 'data', 'state.json');
    const state = await loadState(file, 100);
    move(state, 'coin', 1, 2);
    await saveState(file, state);
    expect(await loadState(file, 200)).toEqual(state);
    const invalid = JSON.parse(await readFile(file, 'utf8'));
    invalid.items[0].x = 5; invalid.items[0].y = 0;
    await writeFile(file, JSON.stringify(invalid));
    await expect(loadState(file, 200)).rejects.toThrow('Invalid terrarium state');
  });

  it('migrates the saved two-plant state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'terrarium-v1-')); dirs.push(dir);
    const file = join(dir, 'state.json');
    await writeFile(file, JSON.stringify({ version: 1, updatedAtMs: 100, plants: [
      { id: 'fern', moisture: 45, growthHours: 1, stage: 0, dry: false },
      { id: 'clover', moisture: 50, growthHours: 2, stage: 1, dry: false },
    ], items: [{ id: 'coin', x: 1, y: 1 }, { id: 'pebble', x: 2, y: 1 }] }));
    const state = await loadState(file, 200);
    expect(state.version).toBe(newState(0).version);
    expect(state.plants[1]).toMatchObject({ id: 'clover', x: 4, stage: 1 });
    expect(state.seeds).toEqual([]);
  });
});

it('sprouts seeds and lets predators hunt aphids', () => {
  const start = Date.parse('2026-06-01T00:00:00Z');
  const state = newState(start);
  sow(state, 'basil', 2, 2);
  releaseBug(state, 'aphid', 1, 1);
  releaseBug(state, 'spider', 1, 1);
  const changes = advance(state, start + 4 * 60 * 60_000, 'Asia/Shanghai');
  expect(changes.some(c => c.kind === 'sprout')).toBe(true);
  expect(changes.some(c => c.kind === 'hunt')).toBe(true);
  expect(state.plants.some(p => p.species === 'basil')).toBe(true);
  expect(state.bugs.some(b => b.species === 'aphid')).toBe(false);
});

it('lets the keeper feed, relocate and remove organisms', () => {
  const state = newState(0);
  const bug = releaseBug(state, 'beetle', 1, 1);
  bug.energy = 15;
  expect(feedBug(state, bug.id).energy).toBe(50);
  expect(relocateBug(state, bug.id, 3, 4)).toMatchObject({ x: 3, y: 4 });
  expect(() => relocateBug(state, bug.id, 5, 0)).toThrow('grid');
  const seed = sow(state, 'bean', 2, 2);
  expect(removeOrganism(state, seed.id)).toMatchObject({ id: seed.id, species: 'bean' });
  expect(removeOrganism(state, bug.id)).toMatchObject({ id: bug.id, species: 'beetle' });
  expect(removeOrganism(state, 'fern')).toMatchObject({ id: 'fern', species: 'fern' });
  expect(() => removeOrganism(state, 'missing')).toThrow('Unknown organism');
});

it('reports hunger and allows mature well-fed bug pairs to reproduce', () => {
  const hour = 60 * 60_000;
  const start = Date.parse('2026-06-01T00:00:00Z');
  const state = newState(start);
  state.plants = [];
  const first = releaseBug(state, 'aphid', 4, 4);
  const second = releaseBug(state, 'aphid', 4, 4);
  first.ageHours = 23; second.ageHours = 23;
  first.energy = 75; second.energy = 75;
  const changes = advance(state, start + hour, 'Asia/Shanghai');
  expect(changes.some(change => change.kind === 'birth')).toBe(true);
  expect(state.bugs).toHaveLength(3);
  expect(state.bugs[2]).toMatchObject({ species: 'aphid', energy: 45 });
  const child = state.bugs[2];
  child.energy = 20.1;
  relocateBug(state, child.id, 4, 4);
  const hunger = advance(state, start + hour + 10 * 60_000, 'Asia/Shanghai');
  expect(hunger.some(change => change.kind === 'hungry' && change.text.includes(child.id))).toBe(true);
});

it('waters soil locally and spreads water to adjacent plots over time', () => {
  const start = Date.parse('2026-06-01T00:00:00Z');
  const state = newState(start);
  const control = structuredClone(state);
  const neighbor = state.soil[1].moisture;
  water(state, 'fern');
  expect(state.soil[0].moisture).toBe(state.plants[0].moisture);
  expect(state.soil[1].moisture).toBe(neighbor);
  advance(state, start + 60 * 60_000, 'Asia/Shanghai');
  advance(control, start + 60 * 60_000, 'Asia/Shanghai');
  expect(state.soil[1].moisture).toBeGreaterThan(control.soil[1].moisture);
  expect(state.soil[1].moisture - control.soil[1].moisture).toBeGreaterThan(state.soil[24].moisture - control.soil[24].moisture);
  removeOrganism(state, 'fern');
  const moisture = state.soil[0].moisture;
  sow(state, 'bean', 0, 0);
  expect(state.soil[0].moisture).toBe(moisture);
});

it.each(['moss', 'basil'] as const)('makes shade affect %s growth and evaporation', species => {
  const start = Date.parse('2026-06-01T00:00:00Z');
  const shaded = newState(start);
  const sunny = newState(start);
  const seed = sow(shaded, species, 2, 2);
  sow(sunny, species, 2, 2);
  move(sunny, 'pebble', 4, 4);
  advance(shaded, start + 6 * 60 * 60_000, 'Asia/Shanghai');
  advance(sunny, start + 6 * 60 * 60_000, 'Asia/Shanghai');
  const shadedPlant = shaded.plants.find(p => p.id === seed.id)!;
  const sunnyPlant = sunny.plants.find(p => p.id === seed.id)!;
  expect(shadedPlant.moisture).toBeGreaterThan(sunnyPlant.moisture);
  expect(species === 'moss' ? shadedPlant.growthHours : sunnyPlant.growthHours).toBeGreaterThan(0);
  expect(species === 'moss' ? sunnyPlant.growthHours : shadedPlant.growthHours).toBe(0);
});

it('withholds germination in dry soil and damages waterlogged plants', () => {
  const start = Date.parse('2026-06-01T00:00:00Z');
  const dry = newState(start);
  dry.soil.forEach(cell => { cell.moisture = 0; });
  sow(dry, 'bean', 2, 2);
  advance(dry, start + 3 * 60 * 60_000, 'Asia/Shanghai');
  expect(dry.seeds[0].ageHours).toBe(0);
  waterSoil(dry, 2, 2);
  waterSoil(dry, 2, 2);
  advance(dry, start + 6 * 60 * 60_000, 'Asia/Shanghai');
  expect(dry.seeds).toHaveLength(0);
  expect(dry.plants.some(plant => plant.species === 'bean')).toBe(true);
  const wet = newState(start);
  wet.soil.forEach(cell => { cell.moisture = 100; });
  advance(wet, start + 60 * 60_000, 'Asia/Shanghai');
  expect(wet.plants.every(plant => plant.health < 100 && plant.growthHours === 0 && !plant.dry)).toBe(true);
});

it('migrates v2 soil from plant moisture and preserves organisms and positions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-v2-')); dirs.push(dir);
  const file = join(dir, 'state.json');
  const original = newState(100);
  const seed = sow(original, 'moss', 2, 2);
  const bug = releaseBug(original, 'beetle', 3, 2);
  const { soil: _soil, history: _history, ...old } = original;
  old.plants[0].moisture = 12;
  await writeFile(file, JSON.stringify({ ...old, version: 2 }));
  const state = await loadState(file, 200);
  expect(state.soil[0].moisture).toBe(old.plants[0].moisture);
  expect(state.plants[0].dry).toBe(true);
  expect(state.seeds).toEqual([seed]);
  expect(state.bugs).toEqual([bug]);
  expect(state.items).toEqual(old.items);
  expect(state.history[0].plants[0].moisture).toBe(old.plants[0].moisture);
  await saveState(file, state);
  expect(await loadState(file, 300)).toEqual(state);
});

it('retains bounded hourly history through downtime and rejects corrupt samples', async () => {
  const { TERRARIUM_MAX_HISTORY } = await import('../src/habitat.ts');
  const start = Date.parse('2026-06-01T00:00:00Z');
  const state = newState(start);
  advance(state, start + 10 * 24 * 60 * 60_000, 'Asia/Shanghai');
  expect(state.history).toHaveLength(TERRARIUM_MAX_HISTORY);
  expect(state.history.at(-1)?.recordedAtMs).toBe(state.updatedAtMs);
  expect(state.history.every((sample, i) => i === 0 || sample.recordedAtMs - state.history[i - 1].recordedAtMs === 60 * 60_000)).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-history-')); dirs.push(dir);
  const file = join(dir, 'state.json');
  await saveState(file, state);
  expect(await loadState(file, state.updatedAtMs)).toEqual(state);
  state.history[0].soilMoisture[0] = NaN;
  await saveState(file, state);
  await expect(loadState(file, state.updatedAtMs)).rejects.toThrow('Invalid terrarium state');
});

it('records at the hourly boundary and stops daytime growth at dusk', () => {
  const start = Date.parse('2026-06-01T09:59:00Z');
  const state = newState(start);
  advance(state, start + 2 * 60_000, 'Asia/Shanghai');
  expect(state.history.at(-1)?.recordedAtMs).toBe(start + 60_000);
  expect(state.plants[0].growthHours).toBeCloseTo(1 / 60);
});


it('loads v3 history with legacy timestamps and saves canonical timestamps without losing data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-legacy-history-')); dirs.push(dir);
  const file = join(dir, 'state.json');
  const start = Date.parse('2026-06-01T00:00:00Z');
  const expected = newState(start);
  sow(expected, 'moss', 2, 2);
  releaseBug(expected, 'beetle', 3, 2);
  advance(expected, start + 2 * 60 * 60_000, 'Asia/Shanghai');
  const legacy = { ...expected, history: expected.history.map(({ recordedAtMs, ...sample }, i) =>
    i === 1 ? { ...sample, recordedAtMs } : { ...sample, atMs: recordedAtMs }) };
  await writeFile(file, JSON.stringify(legacy));
  const loaded = await loadState(file, start + 3 * 60 * 60_000);
  expect(loaded).toEqual(expected);
  await saveState(file, loaded);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(expected);
  expect(await loadState(file, start)).toEqual(expected);
  legacy.history[0] = { ...legacy.history[0], atMs: NaN };
  await writeFile(file, JSON.stringify(legacy));
  await expect(loadState(file, start)).rejects.toThrow('Invalid terrarium state');
});


it('round trips Unicode names and rejects invalid names in saved state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-name-')); dirs.push(dir);
  const file = join(dir, 'state.json');
  const state = newState(100);
  expect(state.name).toBeUndefined();
  renameBox(state, '🌱'.repeat(TERRARIUM_MAX_NAME_LENGTH));
  await saveState(file, state);
  expect(await loadState(file, 200)).toEqual(state);
  const invalid = { ...state, name: 'line\nbreak' };
  await writeFile(file, JSON.stringify(invalid));
  await expect(loadState(file, 200)).rejects.toThrow('Invalid terrarium state');
});

it('lays eggs, reserves capacity, hatches juveniles and round trips older and expanded saves', async () => {
  const { migrateState, validState } = await import('../src/state.ts');
  const start = Date.parse('2026-06-01T00:00:00Z'), hour = 3600000;
  const state = newState(start);
  for (let i = 0; i < 2; i++) { const bug = releaseBug(state, 'beetle', 4, 4); bug.ageHours = 23; bug.energy = 100; }
  const events = advance(state, start + hour, 'Asia/Shanghai');
  expect(events.filter(event => event.kind === 'egg')).toHaveLength(1);
  expect(state.eggs).toHaveLength(3); expect(state.bugs).toHaveLength(2);
  expect(state.eggs!.every(egg => egg.hatchesAtMs === start + 2 * hour)).toBe(true);
  expect(migrateState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  expect(advance(state, start + 2 * hour - 1, 'Asia/Shanghai').some(event => event.kind === 'birth')).toBe(false);
  expect(advance(state, start + 2 * hour, 'Asia/Shanghai').filter(event => event.kind === 'birth')).toHaveLength(1);
  expect(state.bugs.slice(2).every(bug => bug.ageHours === 0 && bug.energy === 45)).toBe(true);
  expect(state.eggs).toEqual([]); expect(validState(state)).toBe(true);
  const old = newState(start); expect(migrateState(JSON.parse(JSON.stringify(old)))).toEqual(old);
  const full = newState(start);
  for (let i = 0; i < 11; i++) { const bug = releaseBug(full, 'beetle', 4, 4); bug.ageHours = 23; bug.energy = 100; }
  advance(full, start + hour, 'Asia/Shanghai');
  expect(full.eggs).toHaveLength(1);
  expect(() => releaseBug(full, 'ant', 0, 0)).toThrow('capacity');
  removeOrganism(full, full.eggs![0].id);
  expect(releaseBug(full, 'ant', 0, 0).species).toBe('ant');
});

it('moves ants every ten seconds, digs and stores food while other bugs act every minute', async () => {
  const { TERRARIUM_ANT_ACTION_INTERVAL_MS, TERRARIUM_BUG_ACTION_INTERVAL_MS, dropLandFood, validState } = await import('../src/state.ts');
  const start = Date.parse('2026-06-01T00:00:00Z'), state = newState(start);
  state.plants = [];
  const ant = releaseBug(state, 'ant', 0, 0), beetle = releaseBug(state, 'beetle', 4, 4);
  const queen = releaseBug(state, 'ant', 4, 4); queen.role = 'queen'; ant.role = 'worker';
  dropLandFood(state, 1, 0, 5);
  expect(advance(state, start + TERRARIUM_ANT_ACTION_INTERVAL_MS - 1, 'Asia/Shanghai')).toEqual([]);
  expect(state.nests).toBeUndefined();
  const first = advance(state, start + TERRARIUM_ANT_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(first.some(event => event.kind === 'nest')).toBe(true);
  expect(state.nests).toMatchObject([{ x: 0, y: 0, depth: 1, food: 0 }]);
  expect(beetle).toMatchObject({ x: 4, y: 4 });
  advance(state, start + TERRARIUM_BUG_ACTION_INTERVAL_MS - 1, 'Asia/Shanghai');
  expect(beetle).toMatchObject({ x: 4, y: 4 });
  advance(state, start + TERRARIUM_BUG_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(beetle.x !== 4 || beetle.y !== 4).toBe(true);
  expect(state.nests![0].depth).toBe(5);
  ant.energy = 90;
  advance(state, start + 30 * TERRARIUM_ANT_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(state.nests![0].food).toBeGreaterThan(0);
  const { enterNest } = await import('../src/colony.ts');
  enterNest(ant, state.nests![0]); ant.carrying = 0; state.nests![0].food = 10;
  ant.energy = 15;
  advance(state, start + 31 * TERRARIUM_ANT_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(ant.energy).toBeGreaterThan(34); expect(state.nests![0].food).toBe(9);
  expect(validState(state)).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-ant-')); dirs.push(dir);
  const file = join(dir, 'state.json'); await saveState(file, state);
  expect(await loadState(file, start)).toEqual(state);
  expect(() => dropLandFood(state, 0, 0, 11)).toThrow('1..10');
  expect(() => dropLandFood(state, 5, 0, 1)).toThrow('grid');
});

it('lets ants harvest plants and validates eggs, carrying, nests and food at the save boundary', async () => {
  const { TERRARIUM_ANT_ACTION_INTERVAL_MS, dropLandFood, validState } = await import('../src/state.ts');
  const start = Date.parse('2026-06-01T00:00:00Z'), state = newState(start);
  const ant = releaseBug(state, 'ant', 0, 0); ant.energy = 90;
  const queen = releaseBug(state, 'ant', 1, 0); queen.role = 'queen'; ant.role = 'worker';
  const health = state.plants[0].health;
  advance(state, start + 40 * TERRARIUM_ANT_ACTION_INTERVAL_MS, 'Asia/Shanghai');
  expect(state.plants[0].health).toBeLessThan(health); expect(state.nests![0].food).toBeGreaterThan(0);
  const food = dropLandFood(state, 4, 4, 10);
  const invalid = [
    { ...state, nests: [{ ...state.nests![0], food: 101 }] },
    { ...state, food: [{ ...food, portions: 0 }] },
    { ...state, eggs: [{ id: 'egg-invalid', species: 'ant', x: 0, y: 0, laidAtMs: start, hatchesAtMs: start }] },
    { ...state, bugs: [{ ...ant, carrying: 6 }] },
  ];
  for (const value of invalid) expect(validState(value)).toBe(false);
  removeOrganism(state, food.id); expect(state.food).toEqual([]);
  const solitary = newState(start); solitary.plants = []; dropLandFood(solitary, 0, 0, 1);
  advance(solitary, start + 48 * 3600000, 'Asia/Shanghai'); expect(solitary.food).toEqual([]);
});

it('incubates ant eggs for one hour within the shared population limit', async () => {
  const { TERRARIUM_ANT_ACTION_INTERVAL_MS, validState } = await import('../src/state.ts');
  const start = Date.parse('2026-06-01T00:00:00Z'), hour = 3600000, state = newState(start);
  for (let i = 0; i < 2; i++) { const ant = releaseBug(state, 'ant', i, 0); ant.ageHours = 23; ant.energy = 100; }
  state.nests = [{ id: 'nest-3', x: 0, y: 0, depth: 5, food: 100 }]; state.nextId = 4;
  const changes = advance(state, start + hour, 'Asia/Shanghai');
  expect(changes.some(change => change.kind === 'egg')).toBe(true);
  expect(state.eggs).toHaveLength(3); expect(state.eggs![0].hatchesAtMs).toBe(start + 2 * hour);
  advance(state, start + 2 * hour - TERRARIUM_ANT_ACTION_INTERVAL_MS, 'Asia/Shanghai'); expect(state.bugs).toHaveLength(2);
  const hatched = advance(state, start + 2 * hour, 'Asia/Shanghai');
  expect(hatched.filter(change => change.kind === 'birth')).toHaveLength(1); expect(state.bugs).toHaveLength(5);
  expect(validState(state)).toBe(true);
});

it('acts only once at each boundary when polling starts between action times', () => {
  const start = Date.parse('2026-06-01T00:00:00Z');
  const state = newState(start + 3_500); state.plants = [];
  const worker = releaseBug(state, 'ant', 0, 0); worker.role = 'worker';
  const queen = releaseBug(state, 'ant', 4, 4); queen.role = 'queen';
  const beetle = releaseBug(state, 'beetle', 2, 2);
  const before = start + TERRARIUM_ANT_ACTION_INTERVAL_MS - 1;
  advance(state, before, 'UTC'); expect(state.nests).toBeUndefined();
  const first = before + 1;
  advance(state, first, 'UTC'); expect(state.nests![0].depth).toBe(1);
  expect(advance(state, first, 'UTC')).toEqual([]);
  advance(state, first + 1, 'UTC'); expect(state.nests![0].depth).toBe(1);
  advance(state, first + TERRARIUM_ANT_ACTION_INTERVAL_MS, 'UTC'); expect(state.nests![0].depth).toBe(2);
  advance(state, start + TERRARIUM_BUG_ACTION_INTERVAL_MS - 1, 'UTC'); expect(beetle).toMatchObject({ x: 2, y: 2 });
  advance(state, start + TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC'); expect(beetle).toMatchObject({ x: 2, y: 1 });
  advance(state, start + TERRARIUM_BUG_ACTION_INTERVAL_MS + 1, 'UTC'); expect(beetle).toMatchObject({ x: 2, y: 1 });
});

it('keeps mixed bug actions, aging and energy equal during catch-up and ten-second polling', () => {
  const start = Date.parse('2026-06-01T00:00:00Z') + 3_500;
  const state = newState(start); state.plants = [];
  const queen = releaseBug(state, 'ant', 0, 0); queen.role = 'queen';
  const worker = releaseBug(state, 'ant', 4, 4); worker.role = 'worker';
  const beetle = releaseBug(state, 'beetle', 2, 2);
  const polled = structuredClone(state);
  const end = start + 2 * 3_600_000;
  const changes = advance(state, end, 'UTC');
  const polledChanges = [];
  for (let now = start + TERRARIUM_ANT_ACTION_INTERVAL_MS; now < end; now += TERRARIUM_ANT_ACTION_INTERVAL_MS) polledChanges.push(...advance(polled, now, 'UTC'));
  polledChanges.push(...advance(polled, end, 'UTC'));
  expect(polledChanges).toEqual(changes);
  expect(polled.nests).toEqual(state.nests);
  expect(polled.bugs.map(({ energy: _energy, ageHours: _age, hunger: _hunger, ...bug }) => bug)).toEqual(state.bugs.map(({ energy: _energy, ageHours: _age, hunger: _hunger, ...bug }) => bug));
  for (const bug of state.bugs) {
    const other = polled.bugs.find(other => other.id === bug.id)!;
    expect(other.ageHours).toBeCloseTo(bug.ageHours, 9);
    expect(other.energy).toBeCloseTo(bug.energy, 9);
    expect(other.hunger).toBeCloseTo(bug.hunger!, 9);
    expect(bug.ageHours).toBeCloseTo(2, 9);
    expect(bug.energy).toBeCloseTo(56, 9);
  }
  expect(beetle.ageHours).toBeCloseTo(2, 9);
  expect(state.history.map(sample => sample.recordedAtMs)).toEqual(polled.history.map(sample => sample.recordedAtMs));
});

it('waters an inclusive rectangle once per cell and plant, including seeds and empty cells', () => {
  const state = newState(0);
  sow(state, 'basil', 1, 1);
  state.soil.forEach(cell => { cell.moisture = 90; });
  state.plants[0].health = 50;
  const untouched = structuredClone(state.soil[4]);
  const cells = waterArea(state, 0, 0, 1, 1);
  expect(cells.map(({ x, y, moisture }) => ({ x, y, moisture }))).toEqual([
    { x: 0, y: 0, moisture: 100 }, { x: 1, y: 0, moisture: 100 },
    { x: 0, y: 1, moisture: 100 }, { x: 1, y: 1, moisture: 100 },
  ]);
  expect(state.plants[0]).toMatchObject({ moisture: 100, health: 55 });
  expect(state.soil[4]).toEqual(untouched);
  expect(state.seeds).toHaveLength(1);
  expect(waterArea(state, 0, 0, 4, 4)).toHaveLength(state.soil.length);
  expect(state.soil.every(cell => cell.moisture === 100)).toBe(true);
});

it('rejects invalid rectangles without partially watering any cell', () => {
  const state = newState(0), initial = structuredClone(state);
  for (const args of [[-1, 0, 2, 2], [0, 0, 5, 2], [2, 0, 1, 2], [0, 2, 2, 1], [0, 0, 1.5, 2], [NaN, 0, 1, 1]]) {
    expect(() => waterArea(state, ...args as [number, number, number, number])).toThrow('corners');
    expect(state).toEqual(initial);
  }
});

it('warns once on low health from drought and rearms only after sufficient recovery', () => {
  const start = Date.parse('2026-06-01T06:00:00Z'), state = newState(start);
  state.soil.forEach(cell => { cell.moisture = 0; });
  const plant = state.plants[0]; plant.health = TERRARIUM_PLANT_LOW_HEALTH + .1;
  const changes = advance(state, start + 60 * 60_000, 'UTC');
  expect(changes.filter(c => c.kind === 'health')).toHaveLength(1);
  expect(changes.find(c => c.kind === 'health')?.text).toContain(plant.id);
  expect(changes.find(c => c.kind === 'health')?.text).toContain('(0,0)');
  expect(plant.healthWarning).toBe(true);
  expect(advance(state, state.updatedAtMs + 60_000, 'UTC').filter(c => c.kind === 'health')).toEqual([]);
  water(state, plant.id);
  expect(plant.healthWarning).toBe(true);
  for (let i = 0; i < 20 && plant.health < TERRARIUM_PLANT_RECOVERED_HEALTH; i++) { state.soil[plant.y * 5 + plant.x].moisture = 30; water(state, plant.id); }
  expect(plant.health).toBeGreaterThanOrEqual(TERRARIUM_PLANT_RECOVERED_HEALTH);
  expect(plant.healthWarning).toBeUndefined();
  plant.health = TERRARIUM_PLANT_LOW_HEALTH;
  expect(advance(state, state.updatedAtMs + 60_000, 'UTC').filter(c => c.kind === 'health')).toHaveLength(1);
});

it('warns for pest damage after bug actions and emits death instead of a critical warning for dead plants', () => {
  const start = Date.parse('2026-06-01T06:00:00Z'), state = newState(start);
  const plant = state.plants[0]; plant.health = TERRARIUM_PLANT_LOW_HEALTH + 1;
  releaseBug(state, 'aphid', plant.x, plant.y);
  expect(advance(state, start + TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').filter(c => c.kind === 'health')).toHaveLength(1);
  expect(plant.health).toBeLessThan(TERRARIUM_PLANT_LOW_HEALTH);
  delete plant.healthWarning; plant.health = 1; state.bugs[0].hunger = 30;
  const changes = advance(state, state.updatedAtMs + TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC');
  expect(changes.filter(c => c.kind === 'health')).toHaveLength(0);
  expect(changes.some(c => c.kind === 'death' && c.text.includes(plant.id))).toBe(true);
  expect(state.plants.some(p => p.id === plant.id)).toBe(false);
});

it('loads older critical plants and persists warning deduplication across saves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-health-')); dirs.push(dir);
  const file = join(dir, 'state.json'), state = newState(0);
  state.plants[0].health = TERRARIUM_PLANT_LOW_HEALTH;
  await saveState(file, state);
  const old = await loadState(file, 0);
  expect(advance(old, TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').filter(c => c.kind === 'health')).toHaveLength(1);
  await saveState(file, old);
  const restored = await loadState(file, old.updatedAtMs);
  expect(restored.plants[0].healthWarning).toBe(true);
  expect(advance(restored, restored.updatedAtMs + TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').filter(c => c.kind === 'health')).toHaveLength(0);
  const invalid = JSON.parse(await readFile(file, 'utf8'));
  invalid.plants[0].healthWarning = 'true'; await writeFile(file, JSON.stringify(invalid));
  await expect(loadState(file, 0)).rejects.toThrow('Invalid terrarium state');
});


it.each([{ moisture: 0, cause: '水分过低' }, { moisture: 100, cause: '水分过高' }])('identifies moisture damage at a health threshold: $cause', ({ moisture, cause }) => {
  const state = newState(0), plant = state.plants[0];
  state.soil.forEach(cell => { cell.moisture = moisture; });
  plant.health = 75.001;
  const warnings = advance(state, TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').filter(change => change.kind === 'health');
  expect(warnings).toHaveLength(1);
  expect(warnings[0].text).toContain(cause);
  expect(warnings[0].text).toContain(plant.id);
  expect(warnings[0].text).not.toContain('蚜虫');
  expect(advance(state, 2 * TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').filter(change => change.kind === 'health')).toEqual([]);
});

it('reports pest losses without blaming suitable soil and merges crossed health thresholds', () => {
  const state = newState(0), plant = state.plants[0];
  plant.health = 77;
  releaseBug(state, 'aphid', plant.x, plant.y);
  const warnings = advance(state, 17 * TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').filter(change => change.kind === 'health');
  expect(warnings).toHaveLength(1);
  expect(warnings[0].text).toContain('77.0 → 74.0');
  expect(warnings[0].text).toContain('蚜虫取食 -3.00');
  expect(warnings[0].text).not.toContain('水分过');
});

it('includes all actual loss causes in critical and death events', () => {
  const state = newState(0), plant = state.plants[0];
  state.soil.forEach(cell => { cell.moisture = 100; });
  plant.health = 21;
  releaseBug(state, 'aphid', plant.x, plant.y);
  const critical = advance(state, TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').find(change => change.kind === 'health');
  expect(critical?.text).toContain('濒危');
  expect(critical?.text).toContain('水分过高');
  expect(critical?.text).toContain('蚜虫取食');
  plant.health = 1; state.bugs[0].hunger = 30;
  const death = advance(state, 2 * TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').find(change => change.kind === 'death');
  expect(death?.text).toContain('蚜虫取食');
});

it('attributes plant harvesting to worker ants', () => {
  const state = newState(0), plant = state.plants[0];
  plant.health = 75.5;
  releaseBug(state, 'ant', 1, 1).role = 'queen';
  const worker = releaseBug(state, 'ant', plant.x, plant.y);
  worker.role = 'worker';
  state.nests = [{ id: 'nest-test', x: 1, y: 1, depth: 5, food: 0 }];
  const warnings = advance(state, TERRARIUM_ANT_ACTION_INTERVAL_MS, 'UTC').filter(change => change.kind === 'health');
  expect(warnings).toHaveLength(1);
  expect(warnings[0].text).toContain('蚂蚁采集 -1.00');
});

it('keeps hatched workers safe at the entrance and moves a camping spider away during catch-up and polling', () => {
  const start = Date.parse('2026-06-01T00:00:00Z');
  const state = newState(start); state.plants = [];
  state.nests = [{ id: 'nest-refuge', x: 0, y: 0, depth: 5, food: 0 }];
  const queen = releaseBug(state, 'ant', 0, 0);
  queen.role = 'queen'; queen.inside = { nestId: 'nest-refuge', x: 2, y: 2 };
  const spider = releaseBug(state, 'spider', 0, 0);
  spider.energy = TERRARIUM_PREDATOR_SATIATED_ENERGY + 1;
  state.eggs = [{ id: 'egg-refuge', species: 'ant', x: 0, y: 0, laidAtMs: start - 6 * 3600000, hatchesAtMs: start + TERRARIUM_ANT_ACTION_INTERVAL_MS, inside: { nestId: 'nest-refuge', x: 2, y: 2 } }];
  const polled = structuredClone(state);
  const end = start + 5 * TERRARIUM_BUG_ACTION_INTERVAL_MS;
  const changes = advance(state, end, 'UTC');
  for (let now = start + TERRARIUM_ANT_ACTION_INTERVAL_MS; now <= end; now += TERRARIUM_ANT_ACTION_INTERVAL_MS) advance(polled, now, 'UTC');
  expect(changes.some(change => change.kind === 'birth')).toBe(true);
  expect(changes.some(change => change.kind === 'hunt')).toBe(false);
  const worker = state.bugs.find(bug => bug.role === 'worker')!;
  expect(worker).toMatchObject({ species: 'ant', x: 0, y: 0 });
  expect(worker.inside).toBeUndefined();
  expect({ x: spider.x, y: spider.y }).not.toEqual({ x: 0, y: 0 });
  expect(polled.bugs).toEqual(state.bugs);
  expect(validState(state)).toBe(true);
});

it('still lets a hungry spider hunt a worker away from the entrance and records the replay', () => {
  const state = newState(0); state.plants = [];
  state.nests = [{ id: 'nest-refuge', x: 0, y: 0, depth: 5, food: 0 }];
  const spider = releaseBug(state, 'spider', 1, 0);
  const queen = releaseBug(state, 'ant', 0, 0);
  queen.role = 'queen'; queen.inside = { nestId: 'nest-refuge', x: 2, y: 2 };
  const worker = releaseBug(state, 'ant', 2, 0); worker.role = 'worker';
  const changes = advance(state, TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC');
  expect(changes.filter(change => change.kind === 'hunt')).toHaveLength(1);
  expect(state.bugs.some(bug => bug.id === worker.id)).toBe(false);
  expect(state.replays?.[0]).toMatchObject({ hunterId: spider.id, preyId: worker.id });
  expect(validState(state)).toBe(true);
});

it.each(['beetle', 'spider'] as const)('lets a satiated %s rest and resume hunting after energy drains', species => {
  const state = newState(0);
  const hunter = releaseBug(state, species, 4, 0);
  hunter.energy = TERRARIUM_PREDATOR_SATIATED_ENERGY + 1;
  const prey = releaseBug(state, 'aphid', 4, 0);
  expect(advance(state, TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').some(change => change.kind === 'hunt')).toBe(false);
  expect(state.bugs.some(bug => bug.id === prey.id)).toBe(true);
  expect(advance(state, 3600000, 'UTC').some(change => change.kind === 'hunt')).toBe(true);
  expect(state.bugs.some(bug => bug.id === prey.id)).toBe(false);
});

it('does not kill another nearby bug immediately after feeding', () => {
  const state = newState(0);
  releaseBug(state, 'spider', 4, 0);
  releaseBug(state, 'aphid', 4, 0); releaseBug(state, 'aphid', 4, 0);
  const changes = advance(state, 2 * TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC');
  expect(changes.filter(change => change.kind === 'hunt')).toHaveLength(1);
  expect(state.bugs.filter(bug => bug.species === 'aphid')).toHaveLength(1);
});

it('patrols without chasing distant prey and hunts when prey enters sensing range', () => {
  const state = newState(0);
  const hunter = releaseBug(state, 'spider', 0, 0);
  const prey = releaseBug(state, 'aphid', 4, 0);
  expect(Math.abs(hunter.x - prey.x) + Math.abs(hunter.y - prey.y)).toBeGreaterThan(TERRARIUM_PREDATOR_SENSE_RADIUS);
  advance(state, TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC');
  expect(hunter).toMatchObject({ x: 0, y: 1 });
  expect(state.bugs.some(bug => bug.id === prey.id)).toBe(true);
  relocateBug(state, prey.id, hunter.x, hunter.y);
  const changes = advance(state, 2 * TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC');
  expect(changes.some(change => change.kind === 'hunt')).toBe(true);
});

it.each(['beetle', 'spider'] as const)('prevents a %s from stepping into a nest entrance', species => {
  const state = newState(0); state.plants = [];
  const hunter = releaseBug(state, species, 0, 1);
  releaseBug(state, 'aphid', 2, 1);
  state.nests = [{ id: 'nest-refuge', x: 1, y: 1, depth: 1, food: 0 }];
  advance(state, TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC');
  expect(hunter).toMatchObject({ x: 0, y: 1 });
  expect(state.replays ?? []).toHaveLength(0);
});

const hour = 3_600_000;

it('manual boosts cannot postpone starvation at 24 hours', () => {
  const state = newState(0); state.plants = [];
  const bug = releaseBug(state, 'beetle', 4, 4);
  for (let h = 1; h < TERRARIUM_BUG_STARVATION_HOURS; h++) {
    feedBug(state, bug.id);
    advance(state, h * hour, 'UTC');
  }
  expect(state.bugs).toContain(bug);
  expect(bug.energy).toBeGreaterThan(90);
  const hunger = bug.hunger;
  feedBug(state, bug.id);
  expect(bug.hunger).toBe(hunger);
  expect(advance(state, TERRARIUM_BUG_STARVATION_HOURS * hour, 'UTC')).toContainEqual(expect.objectContaining({ kind: 'death', text: expect.stringContaining('饥饿死亡') }));
  expect(state.bugs).toEqual([]);
});

it('zero energy alone does not kill a bug and hunger warnings are emitted on crossing', () => {
  const state = newState(0); state.plants = [];
  const bug = releaseBug(state, 'beetle', 4, 4); bug.energy = 0; bug.hunger = TERRARIUM_BUG_HUNGER_WARNING - .01;
  expect(advance(state, 60_000, 'UTC').filter(c => c.kind === 'hungry')).toHaveLength(1);
  expect(state.bugs).toContain(bug);
  expect(advance(state, 120_000, 'UTC').filter(c => c.kind === 'hungry')).toEqual([]);
});

it('hungry predators hunt at high energy and actual prey satisfies hunger', () => {
  const state = newState(0); state.plants = [];
  const predator = releaseBug(state, 'beetle', 1, 1); predator.energy = 100; predator.hunger = 85;
  const prey = releaseBug(state, 'aphid', 1, 1);
  expect(advance(state, 60_000, 'UTC').some(c => c.kind === 'hunt')).toBe(true);
  expect(state.bugs).not.toContain(prey);
  expect(predator.hunger).toBeCloseTo(25 + 100 / TERRARIUM_BUG_STARVATION_HOURS / 60);
  expect(validState(state)).toBe(true);
});

it('aphids satisfy hunger by eating plants', () => {
  const state = newState(0);
  const aphid = releaseBug(state, 'aphid', 0, 0); aphid.hunger = 60;
  advance(state, 60_000, 'UTC');
  expect(aphid.hunger).toBeLessThan(60);
  expect(state.plants[0].health).toBe(97);
});

it('high-energy queens and workers eat stored food when hungry', () => {
  const state = newState(0); state.plants = [];
  state.nests = [{ id: 'nest-a', x: 0, y: 0, depth: 5, food: 5 }];
  for (const role of ['queen', 'worker'] as const) {
    const ant = releaseBug(state, 'ant', 0, 0);
    ant.role = role; ant.energy = 100; ant.hunger = 85; ant.inside = { nestId: 'nest-a', x: 3, y: 0 };
  }
  advance(state, 10_000, 'UTC');
  expect(state.nests[0].food).toBe(3);
  for (const ant of state.bugs) expect(ant.hunger).toBeLessThan(46);
});

it('old reports retain their checksum and incremental hunger changes survive validation', () => {
  const old = newState(0); const bug = releaseBug(old, 'beetle', 4, 4); delete bug.hunger;
  const hash = reportStateHash(old);
  expect(reportStateHash(migrateState(structuredClone(old)))).toBe(hash);
  const next = structuredClone(old); advance(next, hour, 'UTC');
  const received = migrateState(applyReportChanges(old, reportChanges(old, next)));
  expect(received).toEqual(next);
  expect(reportStateHash(received)).toBe(reportStateHash(next));
  for (const hunger of [-1, 101, NaN, Infinity]) {
    const invalid = structuredClone(next); invalid.bugs[0].hunger = hunger;
    expect(() => migrateState(invalid)).toThrow('Invalid terrarium state file');
  }
});

it('hunger survives save and reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-hunger-'));
  try {
    const state = newState(0); releaseBug(state, 'beetle', 4, 4); advance(state, hour, 'UTC');
    await saveState(join(dir, 'state.json'), state);
    expect(await loadState(join(dir, 'state.json'), hour)).toEqual(state);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('flowering species form buds then bloom under suitable growth conditions', () => {
  for (const species of ['clover', 'basil', 'bean'] as const) {
    const state = newState(6 * hour); state.plants = [{ id: 'flower', species, x: 4, y: 0, moisture: 50, growthHours: TERRARIUM_FLOWER_BUD_HOURS, stage: 3, health: 100, dry: false }];
    expect(flowerStage(state.plants[0])).toBe('bud');
    state.plants[0].growthHours = TERRARIUM_FLOWER_BLOOM_HOURS - .001;
    const changes = advance(state, state.updatedAtMs + 60_000, 'UTC');
    expect(flowerStage(state.plants[0])).toBe('bloom');
    expect(changes.filter(c => c.text.includes('开花'))).toHaveLength(1);
    expect(advance(state, state.updatedAtMs + 60_000, 'UTC').filter(c => c.text.includes('开花'))).toEqual([]);
    const restored = migrateState(structuredClone(state));
    expect(flowerStage(restored.plants[0])).toBe('bloom');
  }
});

it('ferns and moss never flower; flowers require suitable moisture and health', () => {
  const plant = { species: 'bean', growthHours: TERRARIUM_FLOWER_BLOOM_HOURS, health: 100, moisture: 50, dry: false };
  for (const species of ['fern', 'moss']) expect(flowerStage({ ...plant, species })).toBeUndefined();
  expect(flowerStage({ ...plant, health: 34 })).toBeUndefined();
  expect(flowerStage({ ...plant, moisture: 0, dry: true })).toBeUndefined();
  expect(flowerStage({ ...plant, moisture: 100 })).toBeUndefined();
  expect(flowerStage({ ...plant, growthHours: 0 })).toBeUndefined();
});

it('night and unsuitable daylight do not advance flower development', () => {
  const state = newState(0); const clover = state.plants[1]; clover.growthHours = TERRARIUM_FLOWER_BLOOM_HOURS - .01; clover.stage = 3;
  advance(state, hour, 'UTC');
  expect(flowerStage(clover)).toBe('bud');
  const shaded = newState(6 * hour); shaded.plants = [{ ...clover, x: 2, y: 0 }];
  advance(shaded, 7 * hour, 'UTC');
  expect(flowerStage(shaded.plants[0])).toBe('bud');
});

it('old saves begin hunger after catch-up without retroactive starvation', () => {
  const state = newState(0); state.plants = [];
  const bug = releaseBug(state, 'beetle', 4, 4); delete bug.hunger;
  const events = advance(state, TERRARIUM_BUG_STARVATION_HOURS * hour, 'UTC');
  expect(state.bugs).toContain(bug);
  expect(bug.hunger).toBe(0);
  expect(events.some(c => c.kind === 'death')).toBe(false);
  advance(state, (TERRARIUM_BUG_STARVATION_HOURS + 1) * hour, 'UTC');
  expect(bug.hunger).toBeCloseTo(100 / TERRARIUM_BUG_STARVATION_HOURS);
});

it('eating rearms hunger warnings after hunger drops below the warning threshold', () => {
  const state = newState(0); state.plants = [];
  const bug = releaseBug(state, 'beetle', 2, 2); bug.hunger = TERRARIUM_BUG_HUNGER_WARNING - .01;
  expect(advance(state, 60_000, 'UTC').filter(c => c.kind === 'hungry')).toHaveLength(1);
  releaseBug(state, 'aphid', bug.x, bug.y);
  advance(state, 120_000, 'UTC');
  expect(bug.hunger).toBeLessThan(TERRARIUM_BUG_HUNGER_WARNING);
  const waitHours = (TERRARIUM_BUG_HUNGER_WARNING - bug.hunger!) * TERRARIUM_BUG_STARVATION_HOURS / 100;
  const events = advance(state, state.updatedAtMs + waitHours * hour + 60_000, 'UTC');
  expect(events.filter(c => c.kind === 'hungry' && c.text.includes('饥饿值'))).toHaveLength(1);
});
