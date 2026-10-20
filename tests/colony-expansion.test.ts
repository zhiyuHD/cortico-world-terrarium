import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { colonySnapshot, digColony, emptyEntrancePlot, enterNest, fillAntEntrance, nestEntrances, spreadAnts, TERRARIUM_NEST_DIG_ACTIONS } from '../src/colony.ts';
import { advance, loadState, newState, releaseBug, relocateBug, saveState, sow, validState, TERRARIUM_BREEDING } from '../src/state.ts';
import { collect, restoreCollected } from '../src/collection.ts';
import { capacity } from '../src/progression.ts';
import { captureFrame } from '../src/replay.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
const hour = 3_600_000, start = Date.parse('2026-06-01T00:00:00Z');
function colony(count = 8) {
  const s = newState(start); s.plants = [];
  s.nests = [{ id: 'nest-test', x: 0, y: 0, depth: 5, food: 100 }];
  for (let i = 0; i < count; i++) {
    const b = releaseBug(s, 'ant', i % 5, Math.floor(i / 5)); b.energy = 100; b.role = i ? 'worker' : 'queen'; enterNest(b, s.nests[0]);
  }
  spreadAnts(s); return s;
}
function unique(s: ReturnType<typeof newState>) {
  const keys = s.bugs.filter(b => b.species === 'ant').map(b => b.inside ? `${b.inside.nestId}:${b.inside.x},${b.inside.y}` : `surface:${b.x},${b.y}`);
  expect(new Set(keys).size).toBe(keys.length);
}
it('expands a crowded colony through worker actions and adds only empty entrances', () => {
  const s = colony(), nest = s.nests![0];
  sow(s, 'bean', 1, 0); s.items = [{ id: 'pebble', x: 0, y: 1 }, { id: 'coin', x: 4, y: 4 }];
  for (let i = 0; i < TERRARIUM_NEST_DIG_ACTIONS - 1; i++) expect(digColony(s, nest).expanded).toBe(false);
  expect(digColony(s, nest).expanded).toBe(true); expect(nest.size).toBe(5); expect(nest.entrances ?? []).toEqual([]);
  s.items[0].x = 4; s.items[0].y = 3; const result = digColony(s, nest); expect(result.entrance).toEqual({ x: 0, y: 1 });
  expect(nestEntrances(nest)).toHaveLength(2); expect(colonySnapshot(s, nest).cells).toHaveLength(25);
  expect(() => sow(s, 'fern', 0, 1)).toThrow('occupied'); expect(validState(s)).toBe(true);
  const sim = colony();
  const events = advance(sim, start + 120_000, 'UTC');
  expect(events.some(e => e.kind === 'nest' && e.text.includes('扩建'))).toBe(true); expect(sim.nests![0].size).toBe(5); unique(sim);
});
it('fills one entrance while preserving the colony and evacuates everyone when the last closes', () => {
  const s = colony(), nest = s.nests![0]; nest.size = 5; nest.entrances = [{ x: 1, y: 0 }];
  s.eggs = [{ id: 'egg-test', species: 'ant', x: 0, y: 0, laidAtMs: start, hatchesAtMs: start + hour, inside: { nestId: nest.id, x: 2, y: 2 } }];
  const before = captureFrame(s, 'night');
  expect(fillAntEntrance(s, 0, 0)).toMatchObject({ remainingEntrances: 1, removedNest: false });
  expect(nest).toMatchObject({ x: 1, y: 0, food: 100 }); expect(validState(s)).toBe(true); sow(s, 'mint', 0, 0);
  const result = fillAntEntrance(s, 1, 0); expect(result).toMatchObject({ evacuatedAnts: 8, evacuatedEggs: 1, removedNest: true });
  expect(s.bugs.every(b => !b.inside)).toBe(true); expect(s.eggs[0].inside).toBeUndefined(); unique(s); expect(validState(s)).toBe(true);
  expect(emptyEntrancePlot(s, 1, 0)).toBe(false); sow(s, 'fern', 1, 0);
  expect(before.nests![0].entrances).toHaveLength(1); expect(before.bugs.every(b => b.inside)).toBe(true);
});
it('spreads legacy overlaps on load and pushes excess residents onto distinct surface cells without loss', async () => {
  const s = colony(1); s.progression = { level: 2, peakScore: 120, guideStep: 0, guideSkipped: false, actions: [] };
  s.soil = Array.from({ length: 36 }, (_, i) => ({ x: i % 6, y: Math.floor(i / 6), moisture: 50 })); s.history = [];
  for (let i = 1; i < 18; i++) s.bugs.push({ ...structuredClone(s.bugs[0]), id: `old-${i}`, role: 'worker' });
  const dir = await mkdtemp(join(tmpdir(), 'colony-spread-'));
  try {
    const file = join(dir, 'state.json'); await saveState(file, s); const loaded = await loadState(file, start);
    expect(loaded.bugs).toHaveLength(s.bugs.length); expect(loaded.bugs.filter(b => b.inside)).toHaveLength(16); expect(loaded.bugs.filter(b => !b.inside)).toHaveLength(2); unique(loaded); expect(validState(loaded)).toBe(true);
    const once = structuredClone(loaded); spreadAnts(loaded); expect(loaded).toEqual(once);
    await saveState(file, loaded); expect(await loadState(file, start)).toEqual(loaded);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('enforces one surface ant through release, relocation, restoration, movement and hatching', () => {
  const s = colony(2); fillAntEntrance(s, 0, 0); const [a, b] = s.bugs;
  expect(() => releaseBug(s, 'ant', a.x, a.y)).toThrow('already has an ant');
  expect(() => relocateBug(s, b.id, a.x, a.y)).toThrow('already has an ant');
  collect(s, b.id); expect(() => restoreCollected(s, b.id, a.x, a.y)).toThrow('remains in collection'); expect(s.collection).toHaveLength(1);
  restoreCollected(s, b.id, 4, 4);
  s.eggs = [{ id: 'egg-hatch', species: 'ant', x: a.x, y: a.y, laidAtMs: start, hatchesAtMs: start + hour }];
  for (let i = 1; i <= 360; i++) { advance(s, start + i * 10_000, 'UTC'); unique(s); }
  expect(s.bugs).toHaveLength(3); expect(validState(s)).toBe(true);
});
it('keeps old wire states unchanged while rejecting malformed chamber sizes and entrances', () => {
  const s = colony();
  for (const patch of [{ size: 9 }, { size: 3 }, { digProgress: 12 }, { entrances: 'invalid' }, { size: 5, entrances: [{ x: 0, y: 0 }] }, { size: 5, entrances: [{ x: 5, y: 0 }] }]) {
    const value = structuredClone(s); Object.assign(value.nests![0], patch); expect(validState(value)).toBe(false);
  }
  const max = structuredClone(s); max.nests![0].size = 8;
  for (let i = 0; i < 100; i++) digColony(max, max.nests![0]); expect(max.nests![0].size).toBe(8);
  expect(validState(s)).toBe(true);
});
it('lays three eggs at the new maturity boundary, respects energy and capacity, and accelerates existing eggs once', () => {
  const s = colony(1), queen = s.bugs[0]; queen.ageHours = TERRARIUM_BREEDING.queenMaturityHours - 1 / 360;
  advance(s, start + 10_000, 'UTC'); expect(s.eggs).toHaveLength(TERRARIUM_BREEDING.eggsPerClutch);
  advance(s, start + 10_000, 'UTC'); expect(s.eggs).toHaveLength(TERRARIUM_BREEDING.eggsPerClutch);
  const hatchAt = s.eggs![0].hatchesAtMs; expect(hatchAt).toBe(start + 10_000 + TERRARIUM_BREEDING.incubationHours * hour);
  advance(s, hatchAt - 1, 'UTC'); expect(s.bugs).toHaveLength(1); advance(s, hatchAt, 'UTC'); expect(s.bugs).toHaveLength(4); unique(s);
  const old = newState(start); old.eggs = [{ id: 'old-egg', species: 'beetle', x: 0, y: 0, laidAtMs: start, hatchesAtMs: start + 4 * hour }];
  advance(old, start + hour, 'UTC'); expect(old.bugs).toHaveLength(1); advance(old, start + hour, 'UTC'); expect(old.bugs).toHaveLength(1);
  const hungry = colony(1); hungry.nests![0].food = 0; hungry.bugs[0].energy = 60; hungry.bugs[0].ageHours = TERRARIUM_BREEDING.queenMaturityHours - 1 / 360;
  advance(hungry, start + 10_000, 'UTC'); expect(hungry.eggs ?? []).toHaveLength(0);
  const pair = newState(start); pair.plants = [];
  for (let i = 0; i < 2; i++) { const bug = releaseBug(pair, 'beetle', 4, 4); bug.ageHours = TERRARIUM_BREEDING.maturityHours - 1 / 60; bug.energy = 100; }
  pair.updatedAtMs = start + hour - 60_000; advance(pair, start + hour, 'UTC'); expect(pair.eggs).toHaveLength(TERRARIUM_BREEDING.eggsPerClutch);
  expect(pair.bugs.length + pair.eggs!.length).toBeLessThanOrEqual(capacity(pair).organisms);
});
it('persists the fill-hole tool result and allows planting through the public World tools', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'colony-tool-')), file = join(dir, 'state.json');
  const s = colony(2); await saveState(file, s);
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => start });
  try {
    await world.start({ log: { warn() {} }, async pushEvent(e: unknown) { return { ...(e as object), cursor: 1 }; } } as unknown as WorldHost);
    const tool = world.tools().find(t => t.name === 'terrarium_fill_ant_hole')!;
    const result = await tool.handler({ x: 0, y: 0 }, {} as ToolCallContext); expect(JSON.stringify(result)).toContain('removedNest');
    await world.tools().find(t => t.name === 'terrarium_sow')!.handler({ species: 'mint', x: 0, y: 0 }, {} as ToolCallContext);
    const loaded = await loadState(file, start); expect(loaded.nests).toEqual([]); expect(loaded.seeds[0]).toMatchObject({ x: 0, y: 0 }); unique(loaded);
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});
it('reaches the maximum interior through simulation while keeping every ant distinct', () => {
  const s = colony(1); s.progression = { level: 4, peakScore: 420, guideStep: 0, guideSkipped: false, actions: [] };
  s.soil = Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), moisture: 50 })); s.history = [];
  for (let i = 1; i < 32; i++) s.bugs.push({ ...structuredClone(s.bugs[0]), id: `worker-${i}`, role: 'worker' });
  spreadAnts(s);
  for (let tick = 1; tick <= 60; tick++) { advance(s, start + tick * 10_000, 'UTC'); unique(s); expect(validState(s)).toBe(true); }
  expect(s.nests![0].size).toBe(8); expect(s.bugs).toHaveLength(32);
  expect(colonySnapshot(s, s.nests![0]).cells).toHaveLength(64);
});
it('lets carrying workers use a nearby secondary entrance and protects it from predators', () => {
  const s = colony(2), nest = s.nests![0], worker = s.bugs[1]; nest.size = 5; nest.entrances = [{ x: 4, y: 4 }];
  delete worker.inside; worker.x = 4; worker.y = 3; worker.carrying = 1;
  advance(s, start + 10_000, 'UTC'); expect(s.bugs.find(b => b.id === worker.id)?.inside?.nestId).toBe(nest.id);
  const spider = releaseBug(s, 'spider', 4, 4); spider.energy = 50;
  const events = advance(s, start + 60_000, 'UTC'); expect(events.filter(e => e.kind === 'hunt')).toHaveLength(0);
  expect(s.webs?.some(w => w.x === 4 && w.y === 4) ?? false).toBe(false); expect(s.bugs).toContain(worker); unique(s); expect(validState(s)).toBe(true);
});
