import { expect, it } from 'vitest';
import { advance, migrateState, newState, releaseBug, validState, waterSoil } from '../src/state.ts';
import { captureFrame } from '../src/replay.ts';
import { collect, restoreCollected } from '../src/collection.ts';
import { landScene } from '../webui/scene.ts';
import { landCare } from '../src/care.ts';
import { TERRARIUM_LEAF_DAMAGE } from '../src/habitat.ts';

const hour = 3_600_000, dawn = Date.parse('2026-06-01T06:00:00Z');
function harvested() {
  const s = newState(dawn), plant = s.plants[0];
  const queen = releaseBug(s, 'ant', 1, 4); queen.role = 'queen';
  s.nests = [{ id: 'nest-condition', x: 1, y: 4, depth: 5, food: 0 }];
  queen.inside = { nestId: 'nest-condition', x: 2, y: 2 };
  const worker = releaseBug(s, 'ant', plant.x, plant.y); worker.role = 'worker';
  advance(s, dawn + 10_000, 'UTC');
  return { s, plant };
}
it('records actual leaf harvesting, preserves scars in saves and freezes recorded replay frames', () => {
  const { s, plant } = harvested();
  expect(plant.leafDamage).toBe(TERRARIUM_LEAF_DAMAGE.perHarvestHealth);
  const frame = captureFrame(s, 'day');
  expect(migrateState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  expect(landScene(frame).plants[0].leafDamage).toBe(plant.leafDamage);
  plant.leafDamage = 0; expect(frame.plants[0].leafDamage).toBe(TERRARIUM_LEAF_DAMAGE.perHarvestHealth);
});
it('does not invent bite holes from drought, overwatering or sap-feeding aphids', () => {
  for (const moisture of [0, 100]) {
    const s = newState(dawn); s.soil.forEach(c => { c.moisture = moisture; });
    advance(s, dawn + hour, 'UTC'); expect(s.plants[0].health).toBeLessThan(100); expect(s.plants[0].leafDamage).toBeUndefined();
  }
  const s = newState(dawn); releaseBug(s, 'aphid', 0, 0);
  advance(s, dawn + 60_000, 'UTC'); expect(s.plants[0].health).toBeLessThan(100); expect(s.plants[0].leafDamage).toBeUndefined();
});
it('regrows damaged foliage only in suitable daylight and keeps watering from instantly repairing holes', () => {
  const s = newState(dawn), p = s.plants[0]; p.leafDamage = 40;
  waterSoil(s, 0, 0, { targetMoisture: 60 }); expect(p.leafDamage).toBe(40);
  advance(s, dawn + hour, 'UTC'); expect(p.leafDamage).toBeCloseTo(40 - TERRARIUM_LEAF_DAMAGE.recoveryPerGrowthHour);
  const damage = p.leafDamage; s.updatedAtMs = dawn + 13 * hour;
  advance(s, s.updatedAtMs + hour, 'UTC'); expect(p.leafDamage).toBe(damage);
  s.updatedAtMs = dawn + 24 * hour; s.soil.forEach(c => { c.moisture = 0; });
  advance(s, s.updatedAtMs + hour, 'UTC'); expect(p.leafDamage).toBe(damage);
});
it('retains damaged leaves while collected and restores them without duplicating or clearing injury', () => {
  const s = newState(dawn), p = s.plants[0]; p.leafDamage = 40;
  collect(s, p.id); advance(s, dawn + hour, 'UTC'); expect(s.collection![0].specimen).toMatchObject({ leafDamage: 40 });
  restoreCollected(s, p.id, 0, 0); expect(s.plants.find(p => p.id === 'fern')!.leafDamage).toBe(40); expect(validState(s)).toBe(true);
});
it('accepts old plants without scars and rejects corrupt damage in plants and collections', () => {
  expect(migrateState(newState(dawn)).plants[0].leafDamage).toBeUndefined();
  for (const value of [-1, 101, NaN, '20']) {
    const s = newState(dawn); Object.assign(s.plants[0], { leafDamage: value }); expect(validState(s)).toBe(false);
    collect(s, 'fern'); expect(validState(s)).toBe(false);
  }
});
it('keeps leaf damage unchanged under read-only scene and care queries', () => {
  const { s, plant } = harvested(), before = structuredClone(s);
  expect(landCare(s, s.updatedAtMs, 'UTC').plants[0].advice).toContain('采食损伤');
  expect(landScene({ ...s, phase: 'day' }).plants[0].leafDamage).toBe(plant.leafDamage);
  expect(s).toEqual(before);
});
