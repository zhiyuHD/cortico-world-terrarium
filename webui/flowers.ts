import { drawPlantFlowers as drawFlowers } from 'terrarium-renderer';
import { flowerStage, hasSeedHead } from '../src/habitat.ts';
export function drawPlantFlowers(g: CanvasRenderingContext2D, plant: Parameters<typeof flowerStage>[0], x: number, y: number, night: boolean): void { drawFlowers(g, { species: plant.species, flower: flowerStage(plant), seedHead: hasSeedHead(plant) }, x, y, night); }
