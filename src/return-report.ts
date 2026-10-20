import { TERRARIUM_MAX_CATCHUP_MS, type TerrariumState } from './state.ts';
import type { AquariumState } from './aquarium.ts';
import { TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';
import { score } from './scoring.ts';

type State = TerrariumState | AquariumState;
export function captureConditions(state: State) {
  const metrics: Record<string, number> = { score: score(state), plants: state.plants.length };
  for (const p of state.plants) metrics[`${p.id} (${p.species}).health`] = p.health;
  const organisms = [...state.plants, ...('fish' in state ? state.fish : [...state.bugs, ...state.seeds])].map(p => ({ id: p.id, species: p.species, x: p.x, y: p.y }));
  if ('fish' in state) {
    metrics.oxygen = state.oxygen; metrics.cleanliness = state.cleanliness; metrics.fish = state.fish.length;
    for (const f of state.fish) { metrics[`${f.id} (${f.species}).health`] = f.health; metrics[`${f.id} (${f.species}).energy`] = f.energy; }
  } else {
    metrics.meanMoisture = state.soil.reduce((n, c) => n + c.moisture, 0) / state.soil.length;
    metrics.bugs = state.bugs.length; metrics.seeds = state.seeds.length;
    for (const cell of state.soil) metrics[`soil(${cell.x},${cell.y}).moisture`] = cell.moisture;
    for (const b of state.bugs) { metrics[`${b.id} (${b.species}).energy`] = b.energy; metrics[`${b.id} (${b.species}).hunger`] = b.hunger ?? 0; }
  }
  return { atMs: state.updatedAtMs, metrics, organisms };
}

export function createReturnReport(before: ReturnType<typeof captureConditions>, state: State) {
  const after = captureConditions(state);
  const elapsedMs = Math.max(0, after.atMs - before.atMs);
  const warnings: string[] = [];
  if ('fish' in state) {
    if (state.oxygen <= 40) warnings.push(`含氧 ${state.oxygen.toFixed(1)}，建议检查是否需要换水。`);
    if (state.cleanliness < 40) warnings.push(`水质 ${state.cleanliness.toFixed(1)}，水草暂停生长；建议换水并清理残饵。`);
    for (const f of state.fish) if (f.health <= 40 || f.energy <= 20) warnings.push(`${f.id}（${f.species}）(${f.x},${f.y})：健康 ${f.health.toFixed(1)}，能量 ${f.energy.toFixed(1)}。`);
  } else {
    for (const p of state.plants) {
      const needs = TERRARIUM_PLANT_REQUIREMENTS[p.species];
      if (p.health <= 40 || p.moisture < needs.minMoisture || p.moisture > needs.maxMoisture) warnings.push(`${p.id}（${p.species}）(${p.x},${p.y})：健康 ${p.health.toFixed(1)}，水分 ${p.moisture.toFixed(1)}，适宜 ${needs.minMoisture}–${needs.maxMoisture}。`);
    }
    for (const b of state.bugs) if (b.energy <= 20 || (b.hunger ?? 0) >= 80) warnings.push(`${b.id}（${b.species}）(${b.x},${b.y})：能量 ${b.energy.toFixed(1)}，饥饿 ${(b.hunger ?? 0).toFixed(1)}。`);
  }
  return {
    fromAtMs: before.atMs, toAtMs: after.atMs, elapsedHours: elapsedMs / 3_600_000,
    simulatedHours: Math.min(elapsedMs, TERRARIUM_MAX_CATCHUP_MS) / 3_600_000,
    changes: Object.entries(after.metrics).flatMap(([metric, value]) => before.metrics[metric] !== undefined && value !== before.metrics[metric] ? [{ metric, before: before.metrics[metric], after: value, delta: value - before.metrics[metric] }] : []),
    removed: before.organisms.filter(p => !after.organisms.some(other => other.id === p.id)),
    added: after.organisms.filter(p => !before.organisms.some(other => other.id === p.id)), warnings,
    moistureExplanation: '土壤水分在相邻格间渗透，低水分格可以上涨；蒸发减少整箱水分。启用的定时灌溉会按规则补水，没有露水或默认夜间补水机制。',
  };
}
export type ReturnReport = ReturnType<typeof createReturnReport>;

export function recentScores(state: State, nowMs: number) {
  const samples = state.history.filter(h => h.recordedAtMs >= nowMs - 24 * 3_600_000 && h.recordedAtMs <= nowMs).map(h => ({ recordedAtMs: h.recordedAtMs, score: h.score ?? null }));
  const latest = { recordedAtMs: state.updatedAtMs, score: score(state) };
  if (samples.at(-1)?.recordedAtMs === latest.recordedAtMs) samples[samples.length - 1] = latest;
  else samples.push(latest);
  return samples;
}
