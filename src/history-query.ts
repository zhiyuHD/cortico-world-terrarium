import { capacity } from './progression.ts';
import type { AquariumState } from './aquarium.ts';
import type { TerrariumState } from './state.ts';
import { compactNumbers } from './inspect.ts';

export const TERRARIUM_HISTORY_PAGE_SIZE = 6;
export const TERRARIUM_MAX_HISTORY_PAGE_SIZE = 24;
export const TERRARIUM_LAND_HISTORY_METRICS = ['moisture', 'health', 'growthHours', 'stage'] as const;
export const TERRARIUM_WATER_HISTORY_METRICS = ['oxygen', 'cleanliness', 'health', 'energy'] as const;

/** Offset counts backwards from the latest sample; each page remains chronological. */
export function historyPage<T>(samples: readonly T[], args: Record<string, unknown>) {
  const limit = args.limit ?? TERRARIUM_HISTORY_PAGE_SIZE, offset = args.offset ?? 0;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > TERRARIUM_MAX_HISTORY_PAGE_SIZE) throw new Error('History limit must be 1..24');
  if (!Number.isSafeInteger(offset) || Number(offset) < 0) throw new Error('History offset must be non-negative');
  const end = Math.max(0, samples.length - Number(offset));
  return { total: samples.length, offset, nextOffset: Number(offset) + Number(limit) < samples.length ? Number(offset) + Number(limit) : null, samples: samples.slice(Math.max(0, end - Number(limit)), end) };
}
export function landHistory(state: TerrariumState, args: Record<string, unknown>) {
  const { plant, x, y, metric } = args;
  if (metric !== undefined && !(TERRARIUM_LAND_HISTORY_METRICS as readonly unknown[]).includes(metric)) throw new Error('Unknown land history metric');
  if (plant !== undefined) {
    if (typeof plant !== 'string' || x !== undefined || y !== undefined) throw new Error('Supply plant OR x and y');
    if (!state.plants.some(p => p.id === plant) && !state.history.some(h => h.plants.some(p => p.id === plant))) throw new Error('Unknown plant');
  } else {
    if (![x, y].every(v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < capacity(state).size)) throw new Error('Position must be in the current habitat grid');
    if (metric !== undefined && metric !== 'moisture') throw new Error('Soil history supports moisture only');
  }
  const page = historyPage(state.history, args);
  return compactNumbers({ ...page, samples: page.samples.map(sample => {
    if (plant === undefined) return { recordedAtMs: sample.recordedAtMs, x, y, moisture: Number(x) < (sample.gridSize ?? 5) && Number(y) < (sample.gridSize ?? 5) ? sample.soilMoisture[Number(y) * (sample.gridSize ?? 5) + Number(x)] : null };
    const found = sample.plants.find(p => p.id === plant);
    return { recordedAtMs: sample.recordedAtMs, plant: !found ? null : metric === undefined ? found : { id: found.id, [String(metric)]: found[metric as typeof TERRARIUM_LAND_HISTORY_METRICS[number]] } };
  }) });
}
export function waterHistory(state: AquariumState, args: Record<string, unknown>) {
  const { fish, metric } = args;
  if (metric !== undefined && !(TERRARIUM_WATER_HISTORY_METRICS as readonly unknown[]).includes(metric)) throw new Error('Unknown water history metric');
  if (fish !== undefined && (typeof fish !== 'string' || !state.fish.some(f => f.id === fish) && !state.history.some(h => h.fish.some(f => f.id === fish)))) throw new Error('Unknown fish');
  if ((metric === 'health' || metric === 'energy') && fish === undefined) throw new Error('Fish metric requires fish id');
  const page = historyPage(state.history, args);
  return compactNumbers({ ...page, samples: page.samples.map(sample => {
    const found = fish === undefined ? undefined : sample.fish.find(f => f.id === fish);
    return { recordedAtMs: sample.recordedAtMs, ...(metric === undefined || metric === 'oxygen' ? { oxygen: sample.oxygen } : {}), ...(metric === undefined || metric === 'cleanliness' ? { cleanliness: sample.cleanliness } : {}), ...(fish === undefined ? {} : { fish: found ? { id: found.id, ...(metric === undefined || metric === 'health' ? { health: found.health } : {}), ...(metric === undefined || metric === 'energy' ? { energy: found.energy } : {}) } : null }) };
  }) });
}
