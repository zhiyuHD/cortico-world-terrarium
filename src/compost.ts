import { potAt } from './merchant.ts';
import { capacity, hasFacility, inHabitat, recordAction } from './progression.ts';
import { flowerStage, TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';
import { settlePlantGrowth, type TerrariumState, type Change } from './state.ts';

export const TERRARIUM_FERTILIZER_GROWTH_HOURS = 2;
export function compostStatus(state: TerrariumState) {
  return { unlocked: capacity(state).level >= 2, installed: hasFacility(state, 'compost_bin'), fertilizer: state.fertilizer ?? 0, growthHoursPerPortion: TERRARIUM_FERTILIZER_GROWTH_HOURS };
}
function requireCompost(state: TerrariumState): void {
  if (capacity(state).level < 2) throw new Error('Composting unlocks at level 2');
  if (!hasFacility(state, 'compost_bin')) throw new Error('Install and enable compost_bin with terrarium_progress first');
}
export function compostPlant(state: TerrariumState, id: unknown) {
  requireCompost(state);
  const index = state.plants.findIndex(p => p.id === id);
  if (index < 0) throw new Error('Supply the id of a living land plant; seeds and collected specimens cannot be composted');
  const fertilizer = (state.fertilizer ?? 0) + 1;
  if (!Number.isSafeInteger(fertilizer)) throw new Error('Fertilizer inventory is full');
  state.plants.splice(index, 1);
  state.fertilizer = fertilizer;
  recordAction(state, 'care');
  return { composted: id, received: 1, ...compostStatus(state) };
}
export function fertilizePlot(state: TerrariumState, x: number, y: number, portions: unknown = 1) {
  requireCompost(state);
  if (!inHabitat(state, x, y)) throw new Error('Position must be in the current habitat grid');
  if (typeof portions !== 'number' || !Number.isSafeInteger(portions) || portions < 1) throw new Error('Supply a positive safe integer of fertilizer portions');
  if (portions > (state.fertilizer ?? 0)) throw new Error('Not enough fertilizer');
  if (potAt(state, x, y)?.growth === 0) throw new Error('Remove the still pot before fertilizing');
  let plant = state.plants.find(p => p.x === x && p.y === y);
  const seed = state.seeds.find(p => p.x === x && p.y === y);
  if (!plant && !seed) throw new Error('That plot has no plant or seed');
  let hours = portions * TERRARIUM_FERTILIZER_GROWTH_HOURS;
  if (!Number.isSafeInteger(hours) || !Number.isFinite((plant?.growthHours ?? 0) + hours)) throw new Error('Growth amount is too large');
  const changes: Change[] = [];
  if (seed) {
    hours -= Math.max(0, 2 - seed.ageHours);
    const moisture = state.soil[y * capacity(state).size + x].moisture;
    plant = { id: seed.id, species: seed.species, x, y, moisture, growthHours: 0, naturalGrowthHours: 0, stage: 0, health: 100, dry: moisture < TERRARIUM_PLANT_REQUIREMENTS[seed.species].minMoisture };
    state.seeds.splice(state.seeds.indexOf(seed), 1);
    state.plants.push(plant);
    changes.push({ kind: 'sprout', text: `${plant.id}（${plant.species}），位置 (${x},${y}) 施肥后发芽了。` });
  }
  const previousFlower = flowerStage(plant!);
  plant!.naturalGrowthHours ??= Math.min(48, plant!.growthHours);
  plant!.growthHours += hours;
  changes.push(...settlePlantGrowth(state, plant!, previousFlower, state.updatedAtMs, true, true));
  state.fertilizer = (state.fertilizer ?? 0) - portions;
  recordAction(state, 'care');
  return { plant: plant!, used: portions, addedGrowthHours: portions * TERRARIUM_FERTILIZER_GROWTH_HOURS, ...compostStatus(state), changes };
}
