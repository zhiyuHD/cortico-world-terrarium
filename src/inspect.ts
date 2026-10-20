import type { AquariumState } from './aquarium.ts';
import { landCare, waterCare } from './care.ts';
import { colonySnapshot } from './colony.ts';
import { daylight, TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';
import type { ReturnReport } from './return-report.ts';
import { score } from './scoring.ts';
import { phase, type TerrariumState } from './state.ts';

export const TERRARIUM_INSPECT_SECTIONS = ['summary', 'soil', 'care', 'colonies', 'return', 'objects'] as const;
export type InspectSection = typeof TERRARIUM_INSPECT_SECTIONS[number];
type State = TerrariumState | AquariumState;

/** Display precision does not change simulation, saved state or uploaded checksums. */
export function compactNumbers(value: unknown): unknown {
  if (typeof value === 'number') return Number.isInteger(value) ? value : Math.abs(value) < 1 ? Math.round(value * 1000) / 1000 : Math.round(value * 10) / 10;
  if (Array.isArray(value)) return value.map(compactNumbers);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, compactNumbers(v)]));
  return value;
}
const page = <T>(items: readonly T[], offset: number, limit: number) => ({ total: items.length, offset, items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null });

/** Model-facing inspection selects fields independently from the browser snapshot. */
export function inspectState(state: State, nowMs: number, timezone: string, section: InspectSection, offset: number, limit: number, report?: ReturnReport): Record<string, unknown> {
  const water = 'fish' in state;
  const currentPhase = phase(nowMs, timezone);
  if (section === 'soil') {
    if (water) throw new Error('Soil inspection requires land');
    return { soil: state.soil.map(c => ({ ...c, daylight: daylight(state, c.x, c.y), light: currentPhase === 'day' ? daylight(state, c.x, c.y) : 0 })), requirements: TERRARIUM_PLANT_REQUIREMENTS };
  }
  if (section === 'care') {
    const care = water ? waterCare(state, nowMs, timezone) : landCare(state, nowMs, timezone);
    const feeding = (water ? state.fish : state.bugs).map(b => ({ id: b.id, ageHours: b.ageHours, lastMeal: b.lastMeal ?? null }));
    return { care: { ...care, plants: page<(typeof care.plants)[number]>(care.plants, offset, limit), feeding: page(feeding, offset, limit) } };
  }
  if (section === 'colonies') {
    if (water) throw new Error('Colony inspection requires land');
    return { colonies: (state.nests ?? []).map(n => {
      const c = colonySnapshot(state, n);
      return { id: n.id, x: n.x, y: n.y, size: c.size, depth: n.depth, food: n.food, antCount: c.antCount, eggCount: c.eggCount, queens: c.queens, cells: c.cells.filter(cell => cell.ants.length || cell.eggs.length || cell.food) };
    }) };
  }
  if (section === 'return') {
    if (!report) return { returnReport: null };
    const { changes, warnings, removed, added, ...timing } = report;
    return { returnReport: { ...timing, changes: page(changes, offset, limit), warnings: page(warnings, offset, limit), removed: page(removed, offset, limit), added: page(added, offset, limit) } };
  }
  if (section === 'objects') {
    return water ? { food: page(state.food, offset, limit) } : { items: state.items, food: page(state.food ?? [], offset, limit), webs: page(state.webs ?? [], offset, limit), irrigation: page(state.irrigation ?? [], offset, limit), eggs: page(state.eggs ?? [], offset, limit) };
  }
  const common = {
    phase: currentPhase, updatedAtMs: state.updatedAtMs, score: score(state),
    collection: { count: state.collection?.length ?? 0, tool: 'terrarium_collection' },
    history: { samples: state.history.length, tool: water ? 'terrarium_water_history' : 'terrarium_history' },
    replays: { count: state.replays?.length ?? 0, latestId: state.replays?.at(-1)?.id, tool: 'terrarium_replay' },
    deaths: { count: state.deaths?.length ?? 0, tool: 'terrarium_deaths' },
    returnReport: report ? { elapsedHours: report.elapsedHours, simulatedHours: report.simulatedHours, changed: report.changes.length, warnings: report.warnings.length, section: 'return' } : undefined,
    sections: TERRARIUM_INSPECT_SECTIONS.slice(1),
  };
  if (water) return { ...common, oxygen: state.oxygen, cleanliness: state.cleanliness, plants: state.plants.map(({ id, species, x, y, health, stage }) => ({ id, species, x, y, health, stage })), fish: state.fish.map(({ id, species, x, y, health, energy, ageHours }) => ({ id, species, x, y, health, energy, ageHours })), food: { piles: state.food.length, portions: state.food.reduce((n, f) => n + f.portions, 0) } };
  return {
    ...common,
    plants: state.plants.map(({ id, species, x, y, health, stage, moisture, dry }) => ({ id, species, x, y, health, stage, moisture, dry })),
    bugs: state.bugs.map(({ id, species, x, y, energy, hunger, ageHours, role, inside, carrying }) => ({ id, species, x, y, energy, hunger, ageHours, role, inside, carrying })),
    seeds: state.seeds.map(({ id, species, x, y }) => ({ id, species, x, y })),
    nests: (state.nests ?? []).map(n => ({ ...n, ants: state.bugs.filter(b => b.inside?.nestId === n.id).length, eggs: (state.eggs ?? []).filter(e => e.inside?.nestId === n.id).length })),
    eggs: { count: state.eggs?.length ?? 0, nextHatchAtMs: state.eggs?.length ? Math.min(...state.eggs.map(e => e.hatchesAtMs)) : undefined },
    soil: { moistureRows: Array.from({ length: 5 }, (_, y) => state.soil.slice(y * 5, y * 5 + 5).map(c => c.moisture)), protectedCells: state.soil.filter(c => c.allowAntForaging === false).map(({ x, y }) => [x, y]) },
    food: { piles: state.food?.length ?? 0, portions: (state.food ?? []).reduce((n, f) => n + f.portions, 0) },
    webs: { count: state.webs?.length ?? 0 }, irrigation: { schedules: state.irrigation?.length ?? 0 },
  };
}
