import { expect, it } from 'vitest';
import { TERRARIUM_CROP_SPECIES } from '../src/crops.ts';
import { TERRARIUM_CROPS, cropRounds, gardenStatus, harvest, sellProduce } from '../src/garden.ts';
import { TERRARIUM_PLANT_REQUIREMENTS } from '../src/habitat.ts';
import { advance, newState, sow } from '../src/state.ts';

const HOUR = 3_600_000;
const TZ = 'Asia/Shanghai';
const start = Date.parse('2026-06-01T04:00:00Z');

// Cell (3,0) gets full daylight, so a light-hungry crop actually grows there.
const SUNNY = { x: 3, y: 0 };

function cropBox(species: (typeof TERRARIUM_CROP_SPECIES)[number]) {
  const state = newState(start);
  state.plants.length = 0;
  state.seeds.length = 0;
  const needs = TERRARIUM_PLANT_REQUIREMENTS[species];
  const soil = state.soil[SUNNY.y * 5 + SUNNY.x];
  soil.moisture = (needs.minMoisture + needs.maxMoisture) / 2;
  const seed = sow(state, species, SUNNY.x, SUNNY.y);
  state.seeds.length = 0;
  state.plants.push({ id: `plant-${species}`, species, x: SUNNY.x, y: SUNNY.y, health: 100, moisture: soil.moisture, dry: false, growthHours: 40, stage: 3, ageHours: 40 } as never);
  return { state, seed };
}

it('defines every crop species with its own growth numbers', () => {
  expect(Object.keys(TERRARIUM_CROPS).sort()).toEqual([...TERRARIUM_CROP_SPECIES].sort());
  for (const species of TERRARIUM_CROP_SPECIES) {
    const crop = TERRARIUM_CROPS[species];
    expect(crop.firstHours).toBeGreaterThan(0);
    expect(crop.intervalHours).toBeGreaterThan(0);
    expect(crop.portions).toBeGreaterThan(0);
    expect(crop.price).toBeGreaterThan(0);
    expect(TERRARIUM_PLANT_REQUIREMENTS[species]).toBeDefined();
  }
  expect(TERRARIUM_CROPS.watermelon.price).toBeGreaterThan(TERRARIUM_CROPS.tomato.price);
  expect(TERRARIUM_CROPS.wheat.portions).toBe(TERRARIUM_CROPS.tomato.portions);
});

it('ripens melon and wheat fruit only after their own natural hours', () => {
  for (const species of ['watermelon', 'melon', 'wheat'] as const) {
    const { state } = cropBox(species);
    const crop = TERRARIUM_CROPS[species];
    const plant = state.plants[0];
    plant.fruitGrowthHours = crop.firstHours - 1;
    expect(cropRounds(plant)).toBe(0);
    expect(() => harvest(state, plant.id)).toThrow('No ripe healthy fruit');
    plant.fruitGrowthHours = crop.firstHours;
    expect(cropRounds(plant)).toBe(1);
    expect(harvest(state, plant.id)).toMatchObject({ rounds: 1, pollinated: 0, portions: crop.portions });
    plant.fruitGrowthHours = crop.firstHours + crop.intervalHours * 2;
    expect(cropRounds(plant)).toBe(3);
  }
});

it('reports the rounds it picked and the pollination bonus it spent', () => {
  const { state } = cropBox('melon');
  const crop = TERRARIUM_CROPS.melon;
  const plant = state.plants[0];
  plant.fruitGrowthHours = crop.firstHours + crop.intervalHours;
  plant.pollination = 1;
  expect(harvest(state, plant.id)).toMatchObject({ rounds: 2, pollinated: 1, portions: crop.portions * 2 + 1 });
  expect(plant.pollination).toBe(0);
  plant.fruitGrowthHours = crop.firstHours + crop.intervalHours * 2;
  plant.pollination = 5;
  expect(harvest(state, plant.id)).toMatchObject({ rounds: 1, pollinated: 1, portions: crop.portions + 1 });
  expect(plant.pollination).toBe(4);
});

it('sells the new crops at their own prices', () => {
  const { state } = cropBox('watermelon');
  state.produce = { watermelon: 4 };
  expect(sellProduce(state, 'watermelon', 3)).toMatchObject({ coins: TERRARIUM_CROPS.watermelon.price * 3, portions: 3, balance: TERRARIUM_CROPS.watermelon.price * 3 });
  expect(state.produce?.watermelon).toBe(1);
});

it('reports all crops in the garden status', () => {
  const { state } = cropBox('melon');
  state.plants[0].fruitGrowthHours = TERRARIUM_CROPS.melon.firstHours + TERRARIUM_CROPS.melon.intervalHours;
  const status = gardenStatus(state);
  expect(status.crops).toEqual([{ id: state.plants[0].id, species: 'melon', readyRounds: 2, naturalHours: state.plants[0].fruitGrowthHours }]);
});

it('grows the new crops through the simulation and ripens them in daylight', () => {
  const { state } = cropBox('wheat');
  state.plants[0].fruitGrowthHours = 0;
  state.plants[0].growthHours = 0;
  const needs = TERRARIUM_PLANT_REQUIREMENTS.wheat;
  for (const cell of state.soil) cell.moisture = (needs.minMoisture + needs.maxMoisture) / 2;
  advance(state, start + 5 * HOUR, TZ);
  expect(state.plants[0].fruitGrowthHours).toBeGreaterThan(0);
  expect(state.plants[0].fruitGrowthHours).toBeLessThanOrEqual(5);
});
