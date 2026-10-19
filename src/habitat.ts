export type PlantSpecies = 'fern' | 'clover' | 'moss' | 'basil' | 'bean';
export interface PlantRequirements { minMoisture: number; maxMoisture: number; minLight: number; maxLight: number }
export interface SoilCell { x: number; y: number; moisture: number }
export const TERRARIUM_PLANT_LOW_HEALTH = 20;
export const TERRARIUM_PLANT_RECOVERED_HEALTH = 35;
export interface Habitat { items: ReadonlyArray<{ id: string; x: number; y: number }> }

/** Simulation conditions, expressed as soil moisture (0–100) and daylight (0–1). */
export const TERRARIUM_PLANT_REQUIREMENTS: Record<PlantSpecies, PlantRequirements> = {
  fern: { minMoisture: 30, maxMoisture: 85, minLight: .15, maxLight: .7 },
  clover: { minMoisture: 20, maxMoisture: 80, minLight: .45, maxLight: 1 },
  moss: { minMoisture: 45, maxMoisture: 90, minLight: .15, maxLight: .4 },
  basil: { minMoisture: 30, maxMoisture: 75, minLight: .65, maxLight: 1 },
  bean: { minMoisture: 25, maxMoisture: 70, minLight: .7, maxLight: 1 },
};

export interface WateredPlant {
  id: string; species: PlantSpecies; x: number; y: number; moisture: number; health: number;
}

export function wateringReport(plants: ReadonlyArray<WateredPlant>, cells: ReadonlyArray<SoilCell>) {
  const watered = plants.filter(plant => cells.some(cell => cell.x === plant.x && cell.y === plant.y)).map(plant => {
    const { minMoisture, maxMoisture } = TERRARIUM_PLANT_REQUIREMENTS[plant.species];
    const moisture = cells.find(cell => cell.x === plant.x && cell.y === plant.y)!.moisture;
    return { ...plant, moisture, minMoisture, maxMoisture, moistureStatus: moisture > maxMoisture ? 'high' as const : moisture < minMoisture ? 'low' as const : 'suitable' as const };
  });
  const warnings = watered.filter(plant => plant.moistureStatus !== 'suitable').map(plant =>
    `${plant.id}（${plant.species}）(${plant.x},${plant.y}) 水分${plant.moistureStatus === 'high' ? '过高' : '过低'}：${plant.moisture.toFixed(1)}，适宜 ${plant.minMoisture}–${plant.maxMoisture}；持续超限每小时损失 0.5 健康。`);
  return { plants: watered, warnings };
}

export function daylight(habitat: Habitat, x: number, y: number): number {
  const shaded = habitat.items.some(item => item.id === 'pebble' && Math.abs(item.x - x) + Math.abs(item.y - y) <= 1);
  return (.6 + x * .1) * (shaded ? .35 : 1);
}

export interface HistorySample {
  recordedAtMs: number;
  soilMoisture: number[];
  plants: Array<{ id: string; species: PlantSpecies; moisture: number; health: number; stage: number; growthHours: number }>;
}
export const TERRARIUM_MAX_HISTORY = 168;

export const TERRARIUM_FLOWER_BUD_HOURS = 12;
export const TERRARIUM_FLOWER_BLOOM_HOURS = 18;

/** Flowers follow accumulated suitable daylight growth; fern and moss do not flower. */
export function flowerStage(plant: { species: string; growthHours?: number; health: number; moisture: number; dry: boolean }): 'bud' | 'bloom' | undefined {
  if (plant.species !== 'clover' && plant.species !== 'basil' && plant.species !== 'bean') return;
  const needs = TERRARIUM_PLANT_REQUIREMENTS[plant.species];
  if (plant.health < TERRARIUM_PLANT_RECOVERED_HEALTH || plant.dry || plant.moisture < needs.minMoisture || plant.moisture > needs.maxMoisture) return;
  if ((plant.growthHours ?? 0) >= TERRARIUM_FLOWER_BLOOM_HOURS) return 'bloom';
  if ((plant.growthHours ?? 0) >= TERRARIUM_FLOWER_BUD_HOURS) return 'bud';
}
