import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { newState, sow, waterSoil, advance, saveState, loadState, validState, releaseBug, move, feedBug, dropLandFood } from '../src/state.ts';
import { newAquarium, stockFish, plantAquatic, advanceAquarium, validAquarium, removeAquatic, changeWater, dropFishFood } from '../src/aquarium.ts';
import { capacity, development, observeProgress, upgradeHabitat, installFacility, guide, advanceGuide, recordAction, TERRARIUM_LEVELS, expansionLevels } from '../src/progression.ts';
import { collect, restoreCollected } from '../src/collection.ts';
import { daylight } from '../src/habitat.ts';
import { landHistory } from '../src/history-query.ts';
import { reportChanges, applyReportChanges } from '../src/report-protocol.ts';
import { compactNumbers, inspectState } from '../src/inspect.ts';
import { score, TERRARIUM_SCORE_VERSION } from '../src/scoring.ts';
import { captureFrame } from '../src/replay.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';

const now = Date.parse('2026-06-01T08:00:00Z');
function qualify<T extends ReturnType<typeof newState> | ReturnType<typeof newAquarium>>(state: T, level = 4) {
  observeProgress(state).peakScore = TERRARIUM_LEVELS[level - 1].requiredScore;
  while (capacity(state).level < level) upgradeHabitat(state);
  return state;
}
it('requires attained score, expands one level at a time without spending score, and preserves soil by coordinates', () => {
  const s = newState(now), original = structuredClone(s.soil);
  s.irrigation = [{ x: 4, y: 4, targetMoisture: 60, intervalMinutes: 60, lastWateredAtMs: now }];
  s.soil[24].moisture = 72; s.soil[24].allowAntForaging = false;
  expect(() => upgradeHabitat(s)).toThrow('120');
  for (const target of TERRARIUM_LEVELS.slice(1)) {
    observeProgress(s).peakScore = target.requiredScore;
    const beforeScore = score(s); upgradeHabitat(s);
    expect(capacity(s)).toEqual(target); expect(score(s)).toBe(beforeScore);
    expect(s.soil).toHaveLength(target.size ** 2);
    expect(s.soil[4 * target.size + 4]).toMatchObject({ x: 4, y: 4, moisture: 72, allowAntForaging: false });
    expect(s.soil[target.size ** 2 - 1].moisture).toBe(50);
    expect(s.irrigation[0]).toMatchObject({ x: 4, y: 4 }); expect(validState(s)).toBe(true);
  }
  s.plants = []; expect(capacity(s).level).toBe(4); expect(() => upgradeHabitat(s)).toThrow('maximum');
  expect(original[24].moisture).toBe(50);
});
it('inherits current-formula historical peak without expanding saves automatically and never retroactively completes guide tasks', () => {
  const s = newState(now); s.history[0].score = TERRARIUM_LEVELS[2].requiredScore;
  expect(development(s).next?.available).toBe(true);
  expect(s.progression).toBeUndefined(); expect(capacity(s)).toEqual(TERRARIUM_LEVELS[0]);
  expect(observeProgress(s).peakScore).toBe(TERRARIUM_LEVELS[2].requiredScore);
  expect(guide(s)).toMatchObject({ step: 0, ready: false });
  expect(() => advanceGuide(s)).toThrow('task'); recordAction(s, 'observe'); advanceGuide(s);
  expect(guide(s)).toMatchObject({ step: 1, ready: false });
  waterSoil(s, 2, 2, { amount: 1 }); advanceGuide(s); sow(s, 'bean', 3, 2); advanceGuide(s);
  const bug = releaseBug(s, 'ant', 2, 2); advanceGuide(s); collect(s, bug.id); advanceGuide(s);
  upgradeHabitat(s); advanceGuide(s); expect(guide(s)).toMatchObject({ completed: true });
  expect(validState(s)).toBe(true);
});
it.each(['land', 'water'] as const)('enforces expanded active and frozen capacities and roundtrips %s saves', async habitat => {
  const s = qualify(habitat === 'land' ? newState(now) : newAquarium(now));
  const max = capacity(s);
  s.plants = [];
  for (let i = 0; i < max.organisms; i++) {
    if ('fish' in s) { plantAquatic(s, 'waterweed', i % max.size, Math.floor(i / max.size)); stockFish(s, 'guppy', 7, 7); }
    else { sow(s, 'bean', i % max.size, Math.floor(i / max.size)); releaseBug(s, 'ant', 7, 7); }
  }
  expect(() => 'fish' in s ? stockFish(s, 'guppy', 7, 7) : releaseBug(s, 'ant', 7, 7)).toThrow('capacity');
  expect(() => 'fish' in s ? plantAquatic(s, 'algae', 7, 7) : sow(s, 'bean', 7, 7)).toThrow('capacity');
  expect(() => waterSoil(newState(now), 5, 5)).toThrow('grid');
  for (let i = 0; i < max.collection; i++) {
    const organism = 'fish' in s ? (s.fish.shift(), stockFish(s, 'guppy', 7, 7)) : (s.bugs.shift(), releaseBug(s, 'ant', 7, 7));
    collect(s, organism.id);
  }
  const extra = 'fish' in s ? stockFish(s, 'guppy', 7, 7) : releaseBug(s, 'ant', 7, 7);
  expect(() => collect(s, extra.id)).toThrow('capacity');
  const id = s.collection![0].specimen.id; restoreCollected(s, id, 7, 7);
  const valid = 'fish' in s ? validAquarium : validState; expect(valid(s)).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-expand-'));
  try {
    const path = join(dir, 'state.json'); await saveState(path, s);
    const saved = 'fish' in s ? JSON.parse(await readFile(path, 'utf8')) : await loadState(path, now);
    expect(saved).toEqual(s); expect(valid(saved)).toBe(true);
    const invalid = structuredClone(s); for (let i = 0; i < 2; i++) { const entry = structuredClone(invalid.collection![0]); entry.specimen.id = `excess-${i}`; invalid.collection!.push(entry); }
    expect(valid(invalid)).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('keeps old history addressed by coordinates after expansion, preserves replay dimensions and accepts delta expansion', () => {
  const s = newState(now); s.history[0].soilMoisture[24] = 83;
  const baseline = structuredClone(s), oldFrame = captureFrame(s, 'day'); qualify(s);
  expect(landHistory(s, { x: 4, y: 4 })).toMatchObject({ samples: [{ moisture: 83 }] });
  expect(landHistory(s, { x: 7, y: 7 })).toMatchObject({ samples: [{ moisture: null }] });
  waterSoil(s, 7, 7, { targetMoisture: 65 }); sow(s, 'bean', 7, 7);
  const frame = captureFrame(s, 'day'); expect(capacity(frame).size).toBe(8); expect(capacity(oldFrame).size).toBe(5);
  advance(s, now + 3_600_000, 'UTC'); expect(validState(s)).toBe(true);
  expect(s.history.at(-1)?.gridSize).toBe(8);
  const recovered = applyReportChanges(JSON.parse(JSON.stringify(baseline)), JSON.parse(JSON.stringify(reportChanges(baseline, s))));
  expect(recovered).toEqual(JSON.parse(JSON.stringify(s))); expect(validState(recovered)).toBe(true);
});
it('rejects locked, misplaced, duplicate or forged facilities and preserves disable/move behavior', () => {
  const s = newState(now); expect(() => installFacility(s, 'mulch', 0, 0)).toThrow('level 2'); qualify(s);
  expect(() => installFacility(s, 'filter', 0, 0)).toThrow('other habitat'); expect(() => installFacility(s, 'mulch', 8, 0)).toThrow('valid');
  installFacility(s, 'mulch', 7, 7); installFacility(s, 'mulch', 6, 6, false);
  expect(s.facilities).toEqual([{ kind: 'mulch', x: 6, y: 6, enabled: false }]);
  expect(validState(s)).toBe(true); s.facilities!.push({ ...s.facilities![0] }); expect(validState(s)).toBe(false);
  const w = qualify(newAquarium(now)); w.progression!.peakScore = -1; expect(validAquarium(w)).toBe(false);
});
it('applies mulch, local shade and daylight-only grow light with measurable simulation effects', () => {
  const base = qualify(newState(now)); const mulch = structuredClone(base);
  installFacility(mulch, 'mulch', 7, 7);
  advance(base, now + 3_600_000, 'UTC'); advance(mulch, now + 3_600_000, 'UTC');
  expect(mulch.soil[63].moisture).toBeGreaterThan(base.soil[63].moisture);
  const normal = daylight(base, 4, 4); installFacility(base, 'shade', 4, 4);
  expect(daylight(base, 4, 4)).toBeCloseTo(normal * .6); expect(daylight(base, 7, 7)).toBe(1);
  installFacility(base, 'grow_light', 4, 4); expect(daylight(base, 4, 4)).toBe(.75);
  const night = Date.parse('2026-06-01T20:00:00Z'); base.updatedAtMs = night;
  const growth = base.plants[0].growthHours; advance(base, night + 3_600_000, 'UTC'); expect(base.plants[0].growthHours).toBe(growth);
});
it('applies air stone, filtration and daylight-only aquatic growth boost, with disabled devices inactive', () => {
  const control = qualify(newAquarium(now)); control.oxygen = 50; control.cleanliness = 60;
  const devices = structuredClone(control);
  for (const kind of ['air_stone', 'filter', 'water_light']) installFacility(devices, kind, 7, 7);
  advanceAquarium(control, now + 3_600_000, 'UTC'); advanceAquarium(devices, now + 3_600_000, 'UTC');
  expect(devices.oxygen - control.oxygen).toBeCloseTo(2); expect(devices.cleanliness - control.cleanliness).toBeCloseTo(2);
  expect(devices.plants[0].growthHours).toBeCloseTo(control.plants[0].growthHours * 1.25); expect(validAquarium(devices)).toBe(true);
  const off = structuredClone(devices); for (const f of off.facilities!) f.enabled = false;
  const noDevices = structuredClone(off); delete noDevices.facilities;
  advanceAquarium(off, now + 7_200_000, 'UTC'); advanceAquarium(noDevices, now + 7_200_000, 'UTC');
  expect(off.oxygen).toBe(noDevices.oxygen); expect(off.cleanliness).toBe(noDevices.cleanliness); expect(off.plants).toEqual(noDevices.plants);
  const night = Date.parse('2026-06-01T20:00:00Z'); devices.updatedAtMs = night; const growth = devices.plants[0].growthHours;
  advanceAquarium(devices, night + 3_600_000, 'UTC'); expect(devices.plants[0].growthHours).toBe(growth);
});
it('bounds expanded model summaries while resident pages retain every organism', () => {
  const s = qualify(newState(now)); s.plants = [];
  for (let i = 0; i < capacity(s).organisms; i++) { sow(s, 'bean', i % 8, Math.floor(i / 8)); releaseBug(s, 'ant', i % 8, 7); }
  const summary = compactNumbers(inspectState(s, now, 'UTC', 'summary', 0, 5));
  expect(JSON.stringify(summary).length).toBeLessThan(8_000);
  expect(summary).toMatchObject({ residents: { animals: 32, seeds: 32 }, expansion: { size: 8 } });
  const last = inspectState(s, now, 'UTC', 'residents', 30, 5);
  expect(last).toMatchObject({ bugs: { total: 32, nextOffset: null, items: s.bugs.slice(30) } });
});
it('persists expansion, guide and facility actions through the World tool and panel paths without touching another habitat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-development-world-')), file = join(dir, 'land.json'), waterFile = join(dir, 'water.json');
  const state = newState(now); state.history[0].score = TERRARIUM_LEVELS[1].requiredScore; await saveState(file, state); await saveState(waterFile, newAquarium(now));
  const host = { log: { warn() {} }, async pushEvent(event: object) { return { ...event, cursor: 1 }; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, waterStateFile: waterFile, now: () => now });
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(String(await world.tools().find(t => t.name === name)!.handler(args, {} as ToolCallContext)));
  try {
    await world.start(host);
    expect(await call('terrarium_progress', {})).toMatchObject({ level: 1, next: { available: true } });
    await call('terrarium_inspect', { habitat: 'land' }); await call('terrarium_progress', { action: 'guide' });
    expect(await call('terrarium_progress', { action: 'upgrade' })).toMatchObject({ level: 2, size: 6 });
    await world.webUi().invoke!('garden', 'care', [{ tool: 'terrarium_progress', action: 'install', facility: 'mulch', x: 5, y: 5 }]);
    await call('terrarium_water_area', { x1: 5, y1: 5, x2: 5, y2: 5, amount: 1 });
    const saved = await loadState(file, now); expect(capacity(saved).size).toBe(6); expect(saved.progression?.guideStep).toBe(1);
    expect(saved.facilities?.[0]).toMatchObject({ kind: 'mulch', x: 5, y: 5 });
    expect(await call('terrarium_progress', { habitat: 'water' })).toMatchObject({ level: 1 });
    await call('terrarium_progress', { action: 'skip' }); expect(guide(await loadState(file, now))).toMatchObject({ skipped: true });
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});

it.each(['land', 'water'] as const)('preserves expanded %s hunt frames and validates saved replays at outer cells', habitat => {
  if (habitat === 'land') {
    const s = qualify(newState(now)); releaseBug(s, 'spider', 7, 7); releaseBug(s, 'aphid', 7, 7);
    advance(s, now + 60_000, 'UTC');
    expect(s.replays).toHaveLength(1); expect(s.replays![0].frames.every(f => capacity(f).size === 8)).toBe(true);
    expect(validState(s)).toBe(true);
  } else {
    const s = qualify(newAquarium(now)); stockFish(s, 'perch', 7, 7); stockFish(s, 'guppy', 7, 7);
    advanceAquarium(s, now + 600_000, 'UTC');
    expect(s.replays).toHaveLength(1); expect(s.replays[0].frames.every(f => capacity(f).size === 8)).toBe(true);
    expect(validAquarium(s)).toBe(true);
  }
});


it.each(['land', 'water'] as const)('ignores legacy score peaks for %s upgrades while retaining earned space and guide progress', habitat => {
  const state = qualify(habitat === 'land' ? newState(now) : newAquarium(now), 2);
  state.progression!.scoreVersion = 1; state.progression!.peakScore = 9999;
  state.history[0].score = 9999; delete state.history[0].scoreVersion;
  state.progression!.guideStep = 2;
  expect(development(state).next?.available).toBe(false);
  expect(observeProgress(state)).toMatchObject({ level: 2, scoreVersion: TERRARIUM_SCORE_VERSION, peakScore: score(state), guideStep: 2 });
  expect(() => upgradeHabitat(state)).toThrow(String(expansionLevels(state)[2].requiredScore));
  expect(capacity(state).size).toBe(6);
  state.history[0].scoreVersion = TERRARIUM_SCORE_VERSION;
  state.history[0].score = TERRARIUM_LEVELS[2].requiredScore;
  upgradeHabitat(state); expect(capacity(state).size).toBe(7);
});


it('reaches every land expansion gate through plant growth and non-predatory animal care', () => {
  const state = newState(now); move(state, 'pebble', 0, 2);
  for (const [species, x, y] of [['moss', 0, 1], ['moss', 1, 2], ['moss', 0, 3], ['fern', 0, 4], ['clover', 3, 0], ['clover', 3, 1], ['basil', 2, 0], ['basil', 2, 1], ['bean', 4, 1], ['bean', 4, 2]] as const) sow(state, species, x, y);
  const reached: number[] = [];
  let stocked = false, plantedMore = false;
  for (let end = now + 3_600_000; end <= now + 72 * 3_600_000; end += 3_600_000) {
    for (const p of [...state.plants, ...state.seeds]) waterSoil(state, p.x, p.y, { targetMoisture: 65 });
    for (const cell of state.soil) cell.allowAntForaging = false;
    if (state.bugs.some(b => b.species === 'ant') && (state.food?.length ?? 0) < 3) dropLandFood(state, 0, 4, 10);
    for (const bug of state.bugs) if (bug.energy < 70) feedBug(state, bug.id);
    advance(state, end, 'UTC');
    if (!stocked && end - now >= 36 * 3_600_000) {
      for (const species of ['ant', 'fruit_fly', 'mosquito', 'moth'] as const) for (let i = 0; i < 3; i++) releaseBug(state, species, 4, 2);
      stocked = true;
    }
    const p = observeProgress(state);
    while (capacity(state).level < 4 && p.peakScore >= expansionLevels(state)[capacity(state).level].requiredScore) {
      upgradeHabitat(state); reached.push(capacity(state).level);
    }
    if (!plantedMore && capacity(state).level >= 2) {
      for (const [species, x, y] of [['fern', 1, 0], ['basil', 2, 2], ['bean', 4, 3]] as const) sow(state, species, x, y);
      plantedMore = true;
    }
    expect(validState(state)).toBe(true);
    if (capacity(state).level === 4) break;
  }
  expect(reached).toEqual(TERRARIUM_LEVELS.slice(1).map(level => level.level));
});

it('reaches every water expansion gate without predators or edited health, energy, growth or age', () => {
  const state = newAquarium(now);
  for (const plant of [...state.plants]) removeAquatic(state, plant.id);
  const species = ['waterweed', 'waterlily', 'algae'] as const;
  for (let i = 0; i < 9; i++) plantAquatic(state, species[i % 3], i % 5, Math.floor(i / 5));
  for (const kind of ['guppy', 'goldfish'] as const) for (let i = 0; i < 3; i++) stockFish(state, kind, i, 4);
  const reached: number[] = [];
  for (let end = now + 600_000; end <= now + 72 * 3_600_000; end += 600_000) {
    advanceAquarium(state, end, 'UTC');
    if (state.cleanliness < 95 || state.oxygen < 50) changeWater(state, 100);
    for (const fish of state.fish.filter(f => f.energy < 95)) {
      if (state.food.length >= 20) removeAquatic(state, state.food[0].id);
      dropFishFood(state, fish.x, fish.y, 1);
    }
    const p = observeProgress(state);
    while (capacity(state).level < 4 && p.peakScore >= expansionLevels(state)[capacity(state).level].requiredScore) {
      upgradeHabitat(state); reached.push(capacity(state).level);
    }
    expect(validAquarium(state)).toBe(true);
    if (capacity(state).level === 4) break;
  }
  expect(reached).toEqual(expansionLevels(state).slice(1).map(level => level.level));
  expect(state.fish).toHaveLength(6);
  expect(state.fish.every(f => f.species !== 'perch')).toBe(true);
});
