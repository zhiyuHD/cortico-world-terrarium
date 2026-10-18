export type PlantSpecies = 'fern' | 'clover' | 'moss' | 'basil' | 'bean';
export interface PlantRequirements { minMoisture: number; maxMoisture: number; minLight: number; maxLight: number }
export interface SoilCell { x: number; y: number; moisture: number }
export interface Habitat { items: ReadonlyArray<{ id: string; x: number; y: number }> }

/** Simulation conditions, expressed as soil moisture (0–100) and daylight (0–1). */
export const TERRARIUM_PLANT_REQUIREMENTS: Record<PlantSpecies, PlantRequirements> = {
  fern: { minMoisture: 30, maxMoisture: 85, minLight: .15, maxLight: .7 },
  clover: { minMoisture: 20, maxMoisture: 80, minLight: .45, maxLight: 1 },
  moss: { minMoisture: 45, maxMoisture: 90, minLight: .15, maxLight: .4 },
  basil: { minMoisture: 30, maxMoisture: 75, minLight: .65, maxLight: 1 },
  bean: { minMoisture: 25, maxMoisture: 70, minLight: .7, maxLight: 1 },
};

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
