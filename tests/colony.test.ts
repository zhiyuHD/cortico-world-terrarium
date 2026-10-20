import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { colonySnapshot, ensureQueen, enterNest, nestContents, TERRARIUM_NEST_SIZE } from '../src/colony.ts';
import { advance, dropLandFood, loadState, migrateState, newState, releaseBug, relocateBug, removeOrganism, saveState, validState, TERRARIUM_ANT_ACTION_INTERVAL_MS, TERRARIUM_BUG_ACTION_INTERVAL_MS } from '../src/state.ts';

const start = Date.parse('2026-06-01T00:00:00Z'), hour = 3600000;
function colony() {
  const state = newState(start); state.plants = [];
  const queen = releaseBug(state, 'ant', 0, 0), worker = releaseBug(state, 'ant', 1, 0);
  queen.energy = worker.energy = 100; ensureQueen(state, () => 0);
  state.nests = [{ id: 'nest-fixture', x: 0, y: 0, depth: 5, food: 0 }];
  return { state, queen, worker, nest: state.nests[0] };
}

it('selects one existing ant at random, persists its role and elects a successor only after removal', async () => {
  const state = newState(start); for (let i = 0; i < 3; i++) releaseBug(state, 'ant', i, 0);
  ensureQueen(state, () => .5); const queen = state.bugs[1]; expect(queen.role).toBe('queen');
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-colony-'));
  try {
    await saveState(join(dir, 'state.json'), state);
    const loaded = await loadState(join(dir, 'state.json'), start);
    ensureQueen(loaded, () => .99); expect(loaded.bugs.filter(bug => bug.role === 'queen').map(bug => bug.id)).toEqual([queen.id]);
    removeOrganism(loaded, queen.id); ensureQueen(loaded, () => 0);
    expect(loaded.bugs.filter(bug => bug.role === 'queen')).toHaveLength(1); expect(validState(loaded)).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('walks workers into storage, deposits carried food and returns them to the surface', () => {
  const { state, worker, nest } = colony(); dropLandFood(state, 1, 0, 1);
  let entered = false, deposited = false, exited = false;
  for (let tick = 1; tick <= 40; tick++) {
    advance(state, start + tick * TERRARIUM_ANT_ACTION_INTERVAL_MS, 'UTC');
    entered ||= !!worker.inside;
    deposited ||= nest.food === 1;
    exited ||= deposited && !worker.inside;
    if (worker.inside) { expect(worker.inside.x).toBeLessThan(TERRARIUM_NEST_SIZE); expect(worker.inside.y).toBeLessThan(TERRARIUM_NEST_SIZE); }
    expect(validState(state)).toBe(true);
  }
  expect({ entered, deposited, exited }).toEqual({ entered: true, deposited: true, exited: true });
  expect(nestContents(state, nest).queens).toBe(1);
  const view = colonySnapshot(state, nest);
  expect(view.cells).toHaveLength(TERRARIUM_NEST_SIZE ** 2);
  expect(view.cells.flatMap(cell => cell.ants).sort()).toEqual(view.ants.map(ant => ant.id).sort());
  expect(view.cells.reduce((sum, cell) => sum + cell.food, 0)).toBe(nest.food);
});

it('lets a lone mature queen lay in the nest and hatches eggs there on a fractional age boundary', () => {
  const { state, queen, worker, nest } = colony(); removeOrganism(state, worker.id);
  queen.ageHours = 23.75; nest.food = 100; enterNest(queen, nest);
  const changes = advance(state, start + hour / 2, 'UTC');
  expect(changes.filter(change => change.kind === 'egg')).toHaveLength(1);
  expect(state.eggs).toHaveLength(3);
  expect(state.eggs!.every(egg => egg.inside?.nestId === nest.id)).toBe(true);
  expect(state.eggs!.every(egg => egg.laidAtMs === start + hour / 4 && egg.hatchesAtMs === start + 1.25 * hour)).toBe(true);
  const hatchAt = state.eggs![0].hatchesAtMs;
  expect(advance(state, hatchAt - 1, 'UTC').filter(change => change.kind === 'birth')).toHaveLength(0);
  expect(advance(state, hatchAt, 'UTC').filter(change => change.kind === 'birth')).toHaveLength(3);
  expect(state.bugs.filter(bug => bug.role === 'worker' && bug.inside?.nestId === nest.id)).toHaveLength(3);
  expect(validState(state)).toBe(true);
});

it('reserves the shared bug cap for queen eggs and prevents workers from breeding', () => {
  const { state, queen, worker, nest } = colony(); nest.food = 100;
  enterNest(queen, nest); enterNest(worker, nest); queen.ageHours = worker.ageHours = 23;
  for (let i = 0; i < 9; i++) releaseBug(state, 'beetle', 4, 4);
  advance(state, start + hour, 'UTC'); expect(state.eggs).toHaveLength(1);
  expect(state.bugs.length + state.eggs!.length).toBe(12);
  expect(validState(state)).toBe(true);
});

it('protects nest residents from surface predators and clears locations when moved or their nest is removed', () => {
  const { state, queen, worker, nest } = colony(); enterNest(queen, nest); enterNest(worker, nest);
  worker.carrying = 1; nest.depth = 1; nest.food = 20;
  releaseBug(state, 'spider', 0, 0);
  expect(advance(state, start + TERRARIUM_BUG_ACTION_INTERVAL_MS, 'UTC').some(change => change.kind === 'hunt')).toBe(false);
  expect(state.bugs).toContain(queen); expect(state.bugs).toContain(worker);
  relocateBug(state, worker.id, 3, 3); expect(worker.inside).toBeUndefined();
  state.eggs = [{ id: 'egg-fixture', species: 'ant', x: 0, y: 0, laidAtMs: start, hatchesAtMs: start + 6 * hour, inside: { nestId: nest.id, x: 2, y: 2 } }];
  removeOrganism(state, nest.id);
  expect(queen.inside).toBeUndefined(); expect(state.eggs[0].inside).toBeUndefined(); expect(validState(state)).toBe(true);
});

it('accepts older reports and rejects invalid colony locations and duplicate queens at the state boundary', () => {
  const old = newState(start); releaseBug(old, 'ant', 0, 0); expect(migrateState(structuredClone(old))).toEqual(old);
  const { state, queen, worker, nest } = colony(); enterNest(queen, nest);
  expect(migrateState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  const invalid = [
    { ...state, bugs: [{ ...queen, inside: { nestId: nest.id, x: 4, y: 0 } }, worker] },
    { ...state, bugs: [{ ...queen, inside: { nestId: 'missing', x: 0, y: 0 } }, worker] },
    { ...state, bugs: [queen, { ...worker, role: 'queen' }] },
    { ...state, bugs: [{ ...queen, species: 'beetle' }, worker] },
    { ...state, bugs: [{ ...queen, x: 1 }, worker] },
  ];
  for (const value of invalid) expect(validState(value)).toBe(false);
});

it('stops harvesting plants when the nest has reserves and resumes gathering when reserves run out', () => {
  const { state, worker, nest } = colony();
  const plant = newState(start).plants[0]; plant.x = worker.x = 1; plant.y = worker.y = 0; state.plants = [plant];
  nest.food = 10;
  advance(state, start + TERRARIUM_ANT_ACTION_INTERVAL_MS, 'UTC');
  expect(plant.health).toBe(100); expect(worker.carrying).toBeUndefined();
  relocateBug(state, worker.id, 1, 0); nest.food = 0;
  advance(state, start + 2 * TERRARIUM_ANT_ACTION_INTERVAL_MS, 'UTC');
  expect(plant.health).toBe(99); expect(worker.carrying).toBe(1);
  worker.carrying = 0; plant.health = 40;
  advance(state, start + 3 * TERRARIUM_ANT_ACTION_INTERVAL_MS, 'UTC');
  expect(plant.health).toBe(40); expect(worker.carrying).toBe(0);
});
