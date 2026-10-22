import { compostStatus } from './compost.ts';
import { aquaticFlower } from './aquarium.ts';
import { capacity, development, guideHint } from './progression.ts';
import type { AquariumState } from './aquarium.ts';
import { landCare, waterCare } from './care.ts';
import { colonySnapshot } from './colony.ts';
import { daylight, flowerStage, hasSeedHead, TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';
import type { ReturnReport } from './return-report.ts';
import { score, scoreParts, TERRARIUM_SCORE_RULES } from './scoring.ts';
import { phase, type TerrariumState } from './state.ts';

export const TERRARIUM_INSPECT_SECTIONS = ['summary', 'soil', 'care', 'colonies', 'return', 'objects', 'residents'] as const;
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
    const size = capacity(state).size;
    const rows = (read: (x: number, y: number) => string) => Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => read(x, y)).join(''));
    const matrix = { size, axes: '每行 y 从 0 向下，行内 x 从 0 向右；光照为白天潜在值。', moistureLegend: 'D<30，M=30..60，W>60..85，S>85；分档不代表物种适宜范围。', moisture: rows((x, y) => { const m = state.soil[y * size + x].moisture; return m < 30 ? 'D' : m <= 60 ? 'M' : m <= 85 ? 'W' : 'S'; }), lightLegend: 'L<0.35，M=0.35..<0.65，H>=0.65', daylight: rows((x, y) => { const l = daylight(state, x, y); return l < 0.35 ? 'L' : l < 0.65 ? 'M' : 'H'; }) };
    return { matrix, shadeRule: '石子将所在格与上下左右的日光乘以 0.35；遮阴棚再乘以 0.6。夜间植物和种子不生长。', soil: state.soil.map(c => ({ ...c, daylight: daylight(state, c.x, c.y), light: currentPhase === 'day' ? daylight(state, c.x, c.y) : 0 })), requirements: TERRARIUM_PLANT_REQUIREMENTS };
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
  if (section === 'residents') return water ? { plants: page(state.plants, offset, limit), fish: page(state.fish, offset, limit) } : { plants: page(state.plants, offset, limit), seeds: page(state.seeds, offset, limit), bugs: page(state.bugs.map(b => ({ ...b, ...(b.species === 'aphid' ? { hostPlantId: state.plants.find(p => p.x === b.x && p.y === b.y)?.id ?? null } : {}) })), offset, limit) };
  if (section === 'objects') {
    return water ? { food: page(state.food, offset, limit) } : { compost: compostStatus(state), items: state.items, food: page(state.food ?? [], offset, limit), webs: page(state.webs ?? [], offset, limit), irrigation: page(state.irrigation ?? [], offset, limit), eggs: page(state.eggs ?? [], offset, limit) };
  }
  const common = {
    guide: guideHint(state), scoreParts: scoreParts(state), scoreRules: TERRARIUM_SCORE_RULES, timeBasis: '生长进度按适宜白天模拟小时累计，夜间不累计。',
    expansion: { ...capacity(state), peakScore: development(state).peakScore, next: development(state).next, tool: 'terrarium_progress' },
    facilities: state.facilities,
    residents: { plants: state.plants.length, animals: water ? state.fish.length : state.bugs.length, ...(water ? {} : { seeds: state.seeds.length }), shownPerGroup: 12, section: 'residents' },
    phase: currentPhase, updatedAtMs: state.updatedAtMs, score: score(state),
    collection: { count: state.collection?.length ?? 0, tool: 'terrarium_collection' },
    history: { samples: state.history.length, tool: water ? 'terrarium_water_history' : 'terrarium_history' },
    replays: { count: state.replays?.length ?? 0, latestId: state.replays?.at(-1)?.id, tool: 'terrarium_replay' },
    deaths: { count: state.deaths?.length ?? 0, tool: 'terrarium_deaths' },
    returnReport: report ? { elapsedHours: report.elapsedHours, simulatedHours: report.simulatedHours, changed: report.changes.length, warnings: report.warnings.length, section: 'return' } : undefined,
    sections: TERRARIUM_INSPECT_SECTIONS.slice(1),
  };
  if (water) return { ...common, oxygen: state.oxygen, cleanliness: state.cleanliness, plants: state.plants.slice(0, 12).map(p => ({ id: p.id, species: p.species, x: p.x, y: p.y, health: p.health, stage: p.stage, flower: aquaticFlower(p) })), fish: state.fish.slice(0, 12).map(({ id, species, x, y, health, energy, ageHours }) => ({ id, species, x, y, health, energy, ageHours })), food: { piles: state.food.length, portions: state.food.reduce((n, f) => n + f.portions, 0) } };
  return {
    ...common,
    compost: compostStatus(state),
    plants: state.plants.slice(0, 12).map(({ id, species, x, y, health, stage, moisture, dry, growthHours, leafDamage }) => ({ id, species, x, y, health, stage, moisture, dry, leafDamage, flower: flowerStage({ species, health, moisture, dry, growthHours }), ...(species === 'sunflower' ? { seedHead: hasSeedHead({ species, growthHours }) } : {}) })),
    bugs: state.bugs.slice(0, 12).map(({ id, species, x, y, energy, hunger, ageHours, role, inside, carrying }) => ({ id, species, x, y, energy, hunger, ageHours, role, inside, carrying })),
    seeds: state.seeds.slice(0, 12).map(({ id, species, x, y }) => ({ id, species, x, y })),
    nests: (state.nests ?? []).map(n => ({ ...n, ants: state.bugs.filter(b => b.inside?.nestId === n.id).length, eggs: (state.eggs ?? []).filter(e => e.inside?.nestId === n.id).length })),
    eggs: { count: state.eggs?.length ?? 0, nextHatchAtMs: state.eggs?.length ? Math.min(...state.eggs.map(e => e.hatchesAtMs)) : undefined },
    soil: { moistureRows: Array.from({ length: capacity(state).size }, (_, y) => state.soil.slice(y * capacity(state).size, (y + 1) * capacity(state).size).map(c => c.moisture)), protectedCells: state.soil.filter(c => c.allowAntForaging === false).map(({ x, y }) => [x, y]) },
    food: { piles: state.food?.length ?? 0, portions: (state.food ?? []).reduce((n, f) => n + f.portions, 0) },
    webs: { count: state.webs?.length ?? 0 }, irrigation: { schedules: state.irrigation?.length ?? 0 },
  };
}
