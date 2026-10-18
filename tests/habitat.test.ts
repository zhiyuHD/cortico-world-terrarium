import { expect, it } from 'vitest';
import { TERRARIUM_PLANT_REQUIREMENTS, wateringReport } from '../src/habitat.ts';
import { newState, waterArea, waterSoil } from '../src/state.ts';

it('warns immediately for the reported overwatering while health increases', () => {
  const state = newState(0);
  state.soil[0].moisture = 61.4;
  state.soil[4].moisture = 61.3;
  state.plants.forEach(plant => { plant.health = 87; });
  const cells = waterArea(state, 0, 0, 4, 4);
  const report = wateringReport(state.plants, cells);
  expect(report.warnings).toHaveLength(2);
  expect(report.warnings[0]).toContain('96.4');
  expect(report.warnings[1]).toContain('96.3');
  for (const plant of report.plants) {
    expect(plant.moistureStatus).toBe('high');
    expect(plant.health).toBe(92);
    expect(plant.maxMoisture).toBe(TERRARIUM_PLANT_REQUIREMENTS[plant.species].maxMoisture);
  }
});

it('only reports plants on watered cells and accepts exact moisture limits', () => {
  const state = newState(0), needs = TERRARIUM_PLANT_REQUIREMENTS.fern;
  state.soil[0].moisture = needs.maxMoisture - 35;
  const cell = waterSoil(state, 0, 0);
  const report = wateringReport(state.plants, [cell]);
  expect(report.plants.map(plant => plant.id)).toEqual(['fern']);
  expect(report.plants[0].moistureStatus).toBe('suitable');
  expect(report.warnings).toEqual([]);
  expect(wateringReport(state.plants, [waterSoil(state, 2, 2)])).toEqual({ plants: [], warnings: [] });
});
