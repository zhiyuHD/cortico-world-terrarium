import { expect, it } from 'vitest';
import { advance, newState, sow, validState, saveState, loadState } from '../src/state.ts';
import { TERRARIUM_POTS, balance, coinRanking, merchantStatus, plantQuote, trade } from '../src/merchant.ts';
import { daylight } from '../src/habitat.ts';
import { collect, restoreCollected } from '../src/collection.ts';
import { fertilizePlot } from '../src/compost.ts';
import { installFacility, observeProgress, upgradeHabitat, TERRARIUM_LEVELS } from '../src/progression.ts';
import { applyReportChanges, reportChanges, reportStateHash } from '../src/report-protocol.ts';
import { emptyEntrancePlot } from '../src/colony.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const now = Date.parse('2026-06-01T08:00:00Z'), hour = 3_600_000;
function garden() {
  const s = newState(now); s.items[1] = { id: 'pebble', x: 4, y: 4 };
  s.plants = [{ id: 'crop', species: 'clover', x: 1, y: 2, moisture: 50, health: 100, dry: false, growthHours: 0, naturalGrowthHours: 0, stage: 0 }];
  return s;
}
function funded() { const s = garden(); s.economy = { earned: 2000, spent: 0, inventory: {}, pots: [] }; return s; }
function pot(kind: keyof typeof TERRARIUM_POTS) { const s = funded(); trade(s, { action: 'buy', pot: kind }); trade(s, { action: 'place', pot: kind, x: 1, y: 2 }); return s; }
it('quotes legacy plants, rejects fresh or unhealthy sales, and pays once for naturally cultivated plants', () => {
  const s = garden(), original = structuredClone(s);
  expect(() => trade(s, { action: 'sell', id: 'crop' })).toThrow('6'); expect(s).toEqual(original);
  s.plants[0].growthHours = 48; s.plants[0].naturalGrowthHours = 6;
  expect(plantQuote(s.plants[0]).coins).toBe(20);
  s.plants[0].health = 39; expect(plantQuote(s.plants[0]).eligible).toBe(false);
  s.plants[0].health = 100; delete s.plants[0].naturalGrowthHours;
  expect(plantQuote(s.plants[0]).coins).toBe(40);
  trade(s, { action: 'sell', id: 'crop' }); expect(balance(s)).toBe(40); expect(s.plants).toHaveLength(0);
  expect(() => trade(s, { action: 'sell', id: 'crop' })).toThrow('living'); expect(balance(s)).toBe(40); expect(validState(s)).toBe(true);
});
it('keeps failed transactions unchanged and conserves purchased pots through replacement and removal', () => {
  const s = garden(), before = structuredClone(s);
  expect(() => trade(s, { action: 'buy', pot: 'spring' })).toThrow('coins'); expect(s).toEqual(before);
  s.economy = { earned: 1000, spent: 0, inventory: {}, pots: [] };
  for (const kind of ['clay', 'healing']) trade(s, { action: 'buy', pot: kind });
  trade(s, { action: 'place', pot: 'clay', x: 0, y: 3 });
  trade(s, { action: 'place', pot: 'healing', x: 0, y: 3 });
  expect(s.economy.inventory.clay).toBe(1); expect(s.economy.pots).toHaveLength(1);
  const snapshot = structuredClone(s);
  expect(() => trade(s, { action: 'place', pot: 'spring', x: 3, y: 3 })).toThrow('Buy'); expect(s).toEqual(snapshot);
  expect(() => trade(s, { action: 'place', pot: 'clay', x: .5, y: 3 })).toThrow('Position'); expect(s).toEqual(snapshot);
  trade(s, { action: 'remove', x: 0, y: 3 }); expect(s.economy.inventory.healing).toBe(1); expect(s.economy.pots).toHaveLength(0);
  expect(validState(s)).toBe(true);
});
it.each(['spring', 'slow', 'still'] as const)('%s changes only growth in its own plot and can be removed', kind => {
  const s = pot(kind); s.plants.push({ ...s.plants[0], id: 'neighbor', x: 2 });
  advance(s, now + hour, 'UTC');
  expect(s.plants[0].growthHours).toBeCloseTo(TERRARIUM_POTS[kind].growth);
  expect(s.plants[1].growthHours).toBeCloseTo(1);
  trade(s, { action: 'remove', x: 1, y: 2 }); advance(s, now + 2 * hour, 'UTC');
  expect(s.plants[0].growthHours).toBeCloseTo(TERRARIUM_POTS[kind].growth + 1);
});
it('allows an empty pot before sowing and freezes germination only in the still pot', () => {
  const s = pot('still'); s.plants = []; sow(s, 'clover', 1, 2); sow(s, 'clover', 2, 2);
  advance(s, now + 3 * hour, 'UTC'); expect(s.seeds[0]).toMatchObject({ x: 1, ageHours: 0 }); expect(s.plants[0].x).toBe(2);
  expect(emptyEntrancePlot(s, 1, 2)).toBe(false); expect(validState(s)).toBe(true);
});
it('applies light effects only in the pot plot and keeps night growth stopped', () => {
  const shaded = pot('shade'), sun = pot('sun'), normal = garden();
  expect(daylight(shaded, 1, 2)).toBeCloseTo(daylight(normal, 1, 2) * .55);
  expect(daylight(sun, 1, 2)).toBeCloseTo(daylight(normal, 1, 2) + .25);
  expect(daylight(shaded, 2, 2)).toBe(daylight(normal, 2, 2));
  const night = pot('sun'); night.updatedAtMs = now + 20 * hour; advance(night, now + 21 * hour, 'UTC'); expect(night.plants[0].growthHours).toBe(0);
});
it('retains moisture, drains wet plots and restores health with the corresponding pots', () => {
  const wet = pot('reservoir'), plain = garden(), drain = pot('drainage'), healing = pot('healing');
  for (const s of [wet, plain]) advance(s, now + hour, 'UTC'); expect(wet.soil[11].moisture).toBeGreaterThan(plain.soil[11].moisture);
  const damp = garden(); for (const s of [drain, damp]) { for (const c of s.soil) c.moisture = 90; advance(s, now + hour, 'UTC'); }
  expect(drain.soil[11].moisture).toBeLessThan(damp.soil[11].moisture);
  healing.plants[0].health = 50; healing.plants[0].leafDamage = 20; advance(healing, now + hour, 'UTC');
  expect(healing.plants[0].health).toBeCloseTo(51); expect(healing.plants[0].leafDamage).toBeLessThan(20);
});
it('keeps pots on the ground through collection and sale without duplicating ownership', () => {
  const s = pot('spring'); s.plants[0].growthHours = s.plants[0].naturalGrowthHours = 6;
  collect(s, 'crop'); expect(s.economy!.pots).toHaveLength(1);
  restoreCollected(s, 'crop', 3, 2); expect(s.plants[0].naturalGrowthHours).toBe(6);
  trade(s, { action: 'sell', id: 'crop' }); expect(s.economy!.pots[0]).toMatchObject({ x: 1, y: 2 }); expect(validState(s)).toBe(true);
});
it('excludes fertilizer from earned growth and refuses fertilizer in a still pot without spending', () => {
  const s = pot('still'); observeProgress(s).peakScore = TERRARIUM_LEVELS[1].requiredScore; upgradeHabitat(s); installFacility(s, 'compost_bin', 4, 3); s.fertilizer = 40;
  expect(() => fertilizePlot(s, 1, 2, 20)).toThrow('still'); expect(s.fertilizer).toBe(40);
  trade(s, { action: 'remove', x: 1, y: 2 }); fertilizePlot(s, 1, 2, 20);
  expect(s.plants[0].growthHours).toBe(40); expect(plantQuote(s.plants[0]).eligible).toBe(false);
});
it('persists the wallet and accepts full/delta round trips without changing checksums', async () => {
  const old = garden(), s = structuredClone(old); s.plants[0].growthHours = s.plants[0].naturalGrowthHours = 48;
  trade(s, { action: 'sell', id: 'crop' }); trade(s, { action: 'buy', pot: 'clay' }); trade(s, { action: 'place', pot: 'clay', x: 1, y: 2 });
  const patch = reportChanges(old, s); const result = applyReportChanges(old, patch!);
  expect(reportStateHash(result)).toBe(reportStateHash(s)); expect(validState(result)).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-coins-'));
  try { const file = join(dir, 'state.json'); await saveState(file, s); expect(await loadState(file, now)).toEqual(s); } finally { await rm(dir, { recursive: true, force: true }); }
});
it('rejects invalid ledgers, duplicated pots, unknown kinds and excess inventory', () => {
  const s = pot('clay'); expect(validState(s)).toBe(true);
  for (const mutate of [(s: ReturnType<typeof funded>) => s.economy!.spent++, (s: ReturnType<typeof funded>) => s.economy!.pots.push(s.economy!.pots[0]), (s: ReturnType<typeof funded>) => { s.economy!.inventory.clay = 65; }, (s: ReturnType<typeof funded>) => { s.economy!.earned = -1; }]) { const copy = structuredClone(s); mutate(copy); expect(validState(copy)).toBe(false); }
});
it('ranks wallet balances separately from lifetime earnings, includes own rank and excludes untouched saves', () => {
  const a = funded(), b = funded(), c = garden(); trade(a, { action: 'buy', pot: 'healing' });
  const result = coinRanking([{ id: 'a', state: a, reportedAt: new Date(now).toISOString() }, { id: 'b', state: b, reportedAt: new Date(now).toISOString() }, { id: 'c', state: c, reportedAt: new Date(now).toISOString() }], 1, 'a');
  expect(result.entries[0].id).toBe('b'); expect(result.total).toBe(2); expect(result.own).toMatchObject({ rank: 2, coins: 1840, earned: 2000 }); expect(merchantStatus(c).coins).toBe(0);
});
