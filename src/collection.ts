import { TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';
import { newState, validState, type TerrariumState, type PlantState, type SeedState, type BugState } from './state.ts';
import { newAquarium, validAquarium, type AquariumState, type FishState, type AquaticPlantState } from './aquarium.ts';

export type CollectionItem = { kind: 'plant'; specimen: PlantState } | { kind: 'seed'; specimen: SeedState } | { kind: 'bug'; specimen: BugState } | { kind: 'fish'; specimen: FishState } | { kind: 'aquatic'; specimen: AquaticPlantState };
/** Collected organisms are frozen, excluded from simulation and scoring, and restored into normal capacity limits. */
export function collect(state: TerrariumState | AquariumState, id: string): CollectionItem {
  if ((state.collection?.length ?? 0) >= 48) throw new Error('Collection capacity reached (48)');
  const groups = 'fish' in state ? [['fish', state.fish], ['aquatic', state.plants]] as const : [['plant', state.plants], ['seed', state.seeds], ['bug', state.bugs]] as const;
  for (const [kind, group] of groups) {
    const index = group.findIndex(p => p.id === id);
    if (index < 0) continue;
    const specimen = structuredClone(group[index]);
    if (kind === 'bug') { const bug = specimen as BugState; delete bug.inside; delete bug.role; delete bug.carrying; }
    const entry = { kind, specimen } as CollectionItem;
    group.splice(index, 1); (state.collection ??= []).push(entry);
    if (!('fish' in state) && kind === 'bug') state.webs = state.webs?.filter(web => web.spiderId !== id);
    return entry;
  }
  throw new Error('Unknown collectible organism');
}
export function restoreCollected(state: TerrariumState | AquariumState, id: string, x: number, y: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 4 || y > 4) throw new Error('Position must be in the 5×5 grid');
  const entry = state.collection?.find(p => p.specimen.id === id);
  if (!entry) throw new Error('Unknown collected organism');
  const specimen = { ...structuredClone(entry.specimen), x, y };
  if ('fish' in state) {
    if (entry.kind === 'fish') {
      if (state.fish.length >= 12) throw new Error('Fish capacity reached'); state.fish.push(specimen as FishState);
    } else if (entry.kind === 'aquatic') {
      if (state.plants.length >= 12 || state.plants.some(p => p.x === x && p.y === y)) throw new Error('Aquatic capacity or plot occupied'); state.plants.push(specimen as AquaticPlantState);
    } else throw new Error('Collection habitat mismatch');
  } else if (entry.kind === 'bug') {
    if (state.bugs.length + (state.eggs?.length ?? 0) >= 12) throw new Error('Bug capacity reached'); state.bugs.push(specimen as BugState);
  } else if (entry.kind === 'plant' || entry.kind === 'seed') {
    if (state.plants.length + state.seeds.length >= 12 || [...state.plants, ...state.seeds].some(p => p.x === x && p.y === y)) throw new Error('Plant capacity or plot occupied');
    if (entry.kind === 'plant') { const plant = specimen as PlantState; plant.moisture = state.soil[y * 5 + x].moisture; plant.dry = plant.moisture < TERRARIUM_PLANT_REQUIREMENTS[plant.species].minMoisture; state.plants.push(plant); }
    else state.seeds.push(specimen as SeedState);
  } else throw new Error('Collection habitat mismatch');
  state.collection!.splice(state.collection!.indexOf(entry), 1);
}
export function validCollection(value: unknown, habitat: 'land' | 'water'): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 48 || new Set(value.map(e => e?.specimen?.id)).size !== value.length) return false;
  return value.every(entry => {
    if (!entry || !entry.specimen) return false;
    if (habitat === 'water') {
      const base = newAquarium(0); base.plants = []; base.fish = [];
      if (entry.kind === 'fish') { base.fish = [entry.specimen]; base.updatedAtMs = entry.specimen.lastMeal?.atMs ?? 0; } else if (entry.kind === 'aquatic') base.plants = [entry.specimen]; else return false;
      return validAquarium(base);
    }
    const base = newState(0); base.plants = []; base.bugs = []; base.seeds = [];
    if (entry.kind === 'plant') base.plants = [entry.specimen]; else if (entry.kind === 'seed') base.seeds = [entry.specimen]; else if (entry.kind === 'bug') { base.bugs = [entry.specimen]; base.updatedAtMs = entry.specimen.lastMeal?.atMs ?? 0; } else return false;
    return validState(base);
  });
}
