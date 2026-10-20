import { expect, it } from 'vitest';
import { advance, migrateState, newState, releaseBug, sow, validState, type TerrariumState } from '../src/state.ts';
import { collect, restoreCollected } from '../src/collection.ts';
import { flowerStage, TERRARIUM_PLANT_REQUIREMENTS } from '../src/habitat.ts';
import { landCare } from '../src/care.ts';
import { inspectState } from '../src/inspect.ts';
import { landScene } from '../webui/scene.ts';
const hour = 3_600_000, dawn = Date.parse('2026-06-01T06:00:00Z');
function garden(): TerrariumState { const s = newState(dawn); s.plants = []; return s; }
function plant(s: TerrariumState, species: 'sunflower' | 'mint', x = 4, y = 4, growthHours = 18) {
  const seed = sow(s, species, x, y); s.seeds = [];
  const p = { id: seed.id, species, x, y, moisture: 50, health: 100, growthHours, stage: 3, dry: false };
  s.plants.push(p); return s.plants.at(-1)!;
}
it.each(['sunflower', 'mint'] as const)('sprouts and flowers %s with species-specific light and moisture requirements', species => {
  const s = garden(), x = species === 'sunflower' ? 4 : 0;
  sow(s, species, x, 4); advance(s, dawn + 2 * hour + 60_000, 'UTC');
  expect(s.seeds).toHaveLength(0); expect(s.plants[0].species).toBe(species);
  const p = s.plants[0]; p.growthHours = 12; expect(flowerStage(p)).toBe('bud');
  p.growthHours = 18; expect(flowerStage(p)).toBe('bloom');
  p.moisture = TERRARIUM_PLANT_REQUIREMENTS[species].maxMoisture + 1;
  expect(flowerStage(p)).toBeUndefined(); expect(validState(s)).toBe(true);
});
it('drops sunflower seed food once per growth round across collection and reload', () => {
  let s = garden(); const p = plant(s, 'sunflower', 4, 4, 30 - 1 / 120);
  const changes = advance(s, dawn + 60_000, 'UTC');
  expect(s.food).toHaveLength(1); expect(s.food![0].portions).toBe(3); expect(changes.some(c => c.text.includes('结籽'))).toBe(true);
  expect(flowerStage(p)).toBeUndefined(); expect(landScene({ ...s, phase: 'day' }).plants[0].seedHead).toBe(true);
  s = migrateState(JSON.parse(JSON.stringify(s)));
  collect(s, p.id); advance(s, s.updatedAtMs + 60_000, 'UTC'); restoreCollected(s, p.id, 4, 4);
  advance(s, s.updatedAtMs + 60_000, 'UTC'); expect(s.food).toHaveLength(1);
  s.plants[0].growthHours = 42 - 1 / 120; advance(s, s.updatedAtMs + 60_000, 'UTC');
  expect(s.food).toHaveLength(2); expect(s.plants[0].seedRounds).toBe(2); expect(validState(s)).toBe(true);
});
it('waits for daylight and health before dropping seeds and skips full-capacity drops without queuing', () => {
  const s = garden(), p = plant(s, 'sunflower', 4, 4, 30); p.health = 20;
  advance(s, dawn + 60_000, 'UTC'); expect(s.food ?? []).toHaveLength(0);
  p.health = 100; s.updatedAtMs = dawn + 13 * hour;
  advance(s, s.updatedAtMs + 60_000, 'UTC'); expect(s.food ?? []).toHaveLength(0);
  s.updatedAtMs = dawn + 24 * hour;
  s.food = Array.from({ length: 20 }, (_, i) => ({ id: `food-full-${i}`, x: 0, y: 0, portions: 1, droppedAtMs: s.updatedAtMs }));
  advance(s, s.updatedAtMs + 60_000, 'UTC'); expect(s.food).toHaveLength(20); expect(s.plants[0].seedRounds).toBe(1);
  s.food = []; advance(s, s.updatedAtMs + 60_000, 'UTC'); expect(s.food).toHaveLength(0); expect(validState(s)).toBe(true);
});
it('feeds aphids without destroying a healthy host in an hour and exposes infestation and host', () => {
  const s = garden(), p = plant(s, 'mint', 0, 4);
  const aphid = releaseBug(s, 'aphid', 0, 4); aphid.hunger = 40;
  advance(s, dawn + hour, 'UTC');
  expect(p.health).toBeGreaterThanOrEqual(90); expect(aphid.hunger).toBeLessThan(40);
  expect([aphid.x, aphid.y]).toEqual([p.x, p.y]);
  const care = landCare(s, s.updatedAtMs, 'UTC').plants[0]; expect(care.aphids).toBe(1); expect(care.needsAction).toBe(true); expect(care.advice).toContain('瓢虫');
  const residents = inspectState(s, s.updatedAtMs, 'UTC', 'residents', 0, 10) as { bugs: { items: { hostPlantId: string }[] } };
  expect(residents.bugs.items[0].hostPlantId).toBe(p.id); expect(validState(s)).toBe(true);
});
it('lets ladybugs find aphids three cells away and persists a valid three-frame hunt replay', () => {
  const s = garden(); plant(s, 'mint', 4, 4);
  const prey = releaseBug(s, 'aphid', 4, 4), hunter = releaseBug(s, 'ladybug', 1, 4);
  const changes = advance(s, dawn + 3 * 60_000, 'UTC');
  expect(s.bugs.some(b => b.id === prey.id)).toBe(false); expect(s.bugs).toContain(hunter);
  expect(changes.some(c => c.kind === 'hunt')).toBe(true); expect(s.replays![0].frames).toHaveLength(3); expect(validState(s)).toBe(true);
});
it('shelters aphids on healthy mature mint from distant spiders but permits contact predation', () => {
  const s = garden(); plant(s, 'mint', 4, 4); releaseBug(s, 'aphid', 4, 4);
  const spider = releaseBug(s, 'spider', 2, 4);
  advance(s, dawn + 60_000, 'UTC'); expect(s.replays ?? []).toHaveLength(0);
  spider.x = 4; spider.y = 4; advance(s, s.updatedAtMs + 60_000, 'UTC');
  expect(s.bugs.filter(b => b.species === 'aphid')).toHaveLength(0); expect(validState(s)).toBe(true);
});
it('lays and hatches ladybug eggs within capacity and collects the new species', () => {
  const s = garden();
  for (let i = 0; i < 2; i++) { const bug = releaseBug(s, 'ladybug', 4, 4); bug.ageHours = 24 - 1 / 60; bug.energy = 100; }
  s.updatedAtMs = dawn + hour - 60_000;
  advance(s, dawn + hour, 'UTC'); expect(s.eggs).toHaveLength(3); expect(validState(s)).toBe(true);
  for (const egg of s.eggs!) egg.hatchesAtMs = s.updatedAtMs + 60_000;
  advance(s, s.updatedAtMs + 60_000, 'UTC'); expect(s.eggs).toHaveLength(0); expect(s.bugs).toHaveLength(5);
  collect(s, s.bugs[2].id); expect(validState(s)).toBe(true);
  restoreCollected(s, s.collection![0].specimen.id, 0, 0); expect(validState(s)).toBe(true);
});
it('preserves old saves and rejects invalid sunflower harvest counters', () => {
  const old = newState(dawn); expect(migrateState(JSON.parse(JSON.stringify(old)))).toEqual(old);
  const s = garden(); plant(s, 'sunflower', 4, 4, 30); s.plants[0].seedRounds = 1;
  expect(validState(s)).toBe(true); s.plants[0].seedRounds = 2; expect(validState(s)).toBe(false);
  s.plants[0].seedRounds = -1; expect(validState(s)).toBe(false);
});

it('lets workers collect sunflower seeds without damaging their source plant', () => {
  const s = garden(), p = plant(s, 'sunflower', 4, 4, 30);
  const queen = releaseBug(s, 'ant', 0, 4); queen.role = 'queen';
  const worker = releaseBug(s, 'ant', 4, 4); worker.role = 'worker';
  s.nests = [{ id: 'nest-food-cycle', x: 0, y: 4, depth: 5, food: 0 }];
  queen.inside = { nestId: 'nest-food-cycle', x: 2, y: 2 };
  advance(s, dawn + 10_000, 'UTC');
  expect(worker.carrying).toBe(1); expect(s.food![0].kind).toBe('sunflower_seed'); expect(s.food![0].portions).toBe(2);
  expect(p.health).toBe(100); expect(validState(s)).toBe(true);
});

it('keeps sunflower drops and aphid meals identical across catch-up and minute polling', () => {
  const s = garden(); plant(s, 'sunflower', 4, 4, 30 - 1 / 120); plant(s, 'mint', 0, 4);
  releaseBug(s, 'aphid', 0, 4);
  const polled = structuredClone(s);
  advance(s, dawn + hour, 'UTC');
  for (let minute = 1; minute <= 60; minute++) advance(polled, dawn + minute * 60_000, 'UTC');
  expect(polled).toEqual(s); expect(validState(s)).toBe(true);
});
