import { isFlying, flightDraw, TERRARIUM_FLY_ACTION_INTERVAL_MS, TERRARIUM_FLY_MOVE_PROBABILITY, type FlyingSpecies } from './flight.ts';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ensureQueen, enterNest, walkInside, validColony, TERRARIUM_NEST_ENTRANCE, TERRARIUM_NEST_STORAGE, TERRARIUM_NEST_NURSERY, type NestPosition } from './colony.ts';
import { flowerStage, daylight, TERRARIUM_MAX_HISTORY, TERRARIUM_PLANT_LOW_HEALTH, TERRARIUM_PLANT_RECOVERED_HEALTH, TERRARIUM_PLANT_REQUIREMENTS, type HistorySample, type PlantSpecies, type SoilCell } from './habitat.ts';

import { captureFrame, TERRARIUM_MAX_REPLAYS, TERRARIUM_REPLAY_RETENTION_MS, type HuntReplay } from './replay.ts';

export type PlantId = string;
export type ItemId = 'coin' | 'pebble';
export type SeedSpecies = 'moss' | 'basil' | 'bean';
export type BugSpecies = 'aphid' | 'beetle' | 'spider' | 'ant' | FlyingSpecies;
export interface PlantState { id: PlantId; species: PlantSpecies; x: number; y: number; moisture: number; growthHours: number; stage: number; dry: boolean; health: number; healthWarning?: boolean }
export interface SeedState { id: string; species: SeedSpecies; x: number; y: number; ageHours: number }
export interface BugState { id: string; species: BugSpecies; x: number; y: number; ageHours: number; energy: number; hunger?: number; carrying?: number; role?: 'queen' | 'worker'; inside?: NestPosition }
export interface EggState { id: string; species: 'beetle' | 'spider' | 'ant' | FlyingSpecies; x: number; y: number; laidAtMs: number; hatchesAtMs: number; inside?: NestPosition }
export interface NestState { id: string; x: number; y: number; depth: number; food: number }
export interface SpiderWeb { id: string; spiderId: string; x: number; y: number; createdAtMs: number }
export interface LandFood { id: string; x: number; y: number; portions: number; droppedAtMs: number }
export interface ItemState { id: ItemId; x: number; y: number }
export interface TerrariumState { version: 3; name?: string; webs?: SpiderWeb[]; eggs?: EggState[]; nests?: NestState[]; food?: LandFood[]; replays?: HuntReplay[]; soil: SoilCell[]; history: HistorySample[]; updatedAtMs: number; nextId: number; plants: PlantState[]; seeds: SeedState[]; bugs: BugState[]; items: ItemState[] }
export interface Change { kind: 'stage' | 'dry' | 'health' | 'phase' | 'sprout' | 'hunt' | 'death' | 'birth' | 'hungry' | 'egg' | 'nest' | 'web'; text: string }

export const TERRARIUM_MAX_NAME_LENGTH = 64;

function validName(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && Array.from(value).length >= 1 && Array.from(value).length <= TERRARIUM_MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

export function renameBox(state: Pick<TerrariumState, 'name'>, name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : name;
  if (!validName(trimmed)) throw new Error('Name must contain 1..64 characters without control characters');
  state.name = trimmed;
  return trimmed;
}

const STAGES = [0, 2, 6, 12];
export const TERRARIUM_BUG_ACTION_INTERVAL_MS = 60_000;
export const TERRARIUM_ANT_ACTION_INTERVAL_MS = 10_000;
export const TERRARIUM_PREDATOR_SENSE_RADIUS = 2;
export const TERRARIUM_PREDATOR_SATIATED_ENERGY = 80;
export const TERRARIUM_BUG_STARVATION_HOURS = 24;
export const TERRARIUM_BUG_HUNGER_WARNING = 80;
export const TERRARIUM_BUG_FORAGE_HUNGER = 25;
export const TERRARIUM_WEB_LIFETIME_MS = 6 * 60 * 60_000;
export const TERRARIUM_WEBS_PER_SPIDER = 3;
const HOUR_MS = 60 * 60_000;
const MAX_CATCHUP_MS = 30 * 24 * HOUR_MS;

export function newState(nowMs: number): TerrariumState {
  const state: TerrariumState = { version: 3, soil: Array.from({ length: 25 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5), moisture: 50 })), history: [], updatedAtMs: nowMs, nextId: 1, plants: [
    { id: 'fern', species: 'fern', x: 0, y: 0, moisture: 45, growthHours: 0, stage: 0, dry: false, health: 100 },
    { id: 'clover', species: 'clover', x: 4, y: 0, moisture: 50, growthHours: 0, stage: 0, dry: false, health: 100 },
  ], seeds: [], bugs: [], items: [{ id: 'coin', x: 1, y: 1 }, { id: 'pebble', x: 2, y: 1 }] };
  for (const plant of state.plants) state.soil[plant.y * 5 + plant.x].moisture = plant.moisture;
  recordHistory(state, nowMs);
  return state;
}

const inGrid = (x: number, y: number): boolean => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 5 && y >= 0 && y < 5;

export function sow(state: TerrariumState, species: SeedSpecies, x: number, y: number): SeedState {
  if (!['moss', 'basil', 'bean'].includes(species)) throw new Error('Unknown seed species');
  if (!inGrid(x, y)) throw new Error('Position must be in the 5×5 grid');
  if (state.plants.length + state.seeds.length >= 12) throw new Error('Plant capacity reached');
  if ([...state.plants, ...state.seeds].some(p => p.x === x && p.y === y)) throw new Error('That plot is occupied');
  const seed = { id: `seed-${state.nextId++}`, species, x, y, ageHours: 0 };
  state.seeds.push(seed); return seed;
}

export function releaseBug(state: TerrariumState, species: BugSpecies, x: number, y: number): BugState {
  if (!['aphid', 'beetle', 'spider', 'ant'].includes(species) && !isFlying(species)) throw new Error('Unknown bug species');
  if (!inGrid(x, y)) throw new Error('Position must be in the 5×5 grid');
  if (state.bugs.length + (state.eggs?.length ?? 0) >= 12) throw new Error('Bug capacity reached');
  const bug = { id: `bug-${state.nextId++}`, species, x, y, ageHours: 0, energy: 60, hunger: 0 };
  state.bugs.push(bug); return bug;
}

export function feedBug(state: TerrariumState, id: string): BugState {
  const bug = state.bugs.find(value => value.id === id);
  if (!bug) throw new Error('Unknown bug');
  bug.energy = Math.min(100, bug.energy + 35);
  return bug;
}

export function relocateBug(state: TerrariumState, id: string, x: number, y: number): BugState {
  if (!inGrid(x, y)) throw new Error('Position must be in the 5×5 grid');
  const bug = state.bugs.find(value => value.id === id);
  if (!bug) throw new Error('Unknown bug');
  bug.x = x; bug.y = y;
  delete bug.inside;
  return bug;
}

export function removeOrganism(state: TerrariumState, id: string): { id: string; species: string } {
  const groups = [state.plants, state.seeds, state.bugs, state.eggs ?? [], state.food ?? [], state.nests ?? [], state.webs ?? []];
  for (const group of groups) {
    const index = group.findIndex(value => value.id === id);
    if (index !== -1) {
      const [removed] = group.splice(index, 1);
      if ('depth' in removed) for (const resident of [...state.bugs, ...(state.eggs ?? [])]) {
        if (resident.inside?.nestId === removed.id) delete resident.inside;
      }
      if ('species' in removed && removed.species === 'spider') state.webs = (state.webs ?? []).filter(web => web.spiderId !== removed.id);
      return { id: removed.id, species: 'species' in removed ? removed.species : 'spiderId' in removed ? 'web' : 'depth' in removed ? 'nest' : 'food' };
    }
  }
  throw new Error('Unknown organism');
}

export function dropLandFood(state: TerrariumState, x: number, y: number, portions: number): LandFood {
  if (!inGrid(x, y)) throw new Error('Position must be in the 5×5 grid');
  if (!Number.isInteger(portions) || portions < 1 || portions > 10) throw new Error('Food portions must be 1..10');
  if ((state.food?.length ?? 0) >= 20) throw new Error('Food capacity reached');
  const food = { id: `food-${state.nextId++}`, x, y, portions, droppedAtMs: state.updatedAtMs };
  (state.food ??= []).push(food);
  return food;
}

function approach(bug: BugState, target: { x: number; y: number }): boolean {
  if (bug.x !== target.x) bug.x += Math.sign(target.x - bug.x);
  else if (bug.y !== target.y) bug.y += Math.sign(target.y - bug.y);
  return bug.x === target.x && bug.y === target.y;
}
function nearest<T extends { id: string; x: number; y: number }>(bug: BugState, values: T[]): T | undefined {
  return [...values].sort((a, b) => Math.abs(a.x - bug.x) + Math.abs(a.y - bug.y) - Math.abs(b.x - bug.x) - Math.abs(b.y - bug.y) || a.id.localeCompare(b.id))[0];
}
type PlantDamage = (plant: PlantState, amount: number, cause: string) => void;

function actAnt(state: TerrariumState, bug: BugState, changes: Change[], damage: PlantDamage): void {
  const nests = state.nests ??= [];
  let nest = nearest(bug, nests);
  if (!nest) {
    nest = { id: `nest-${state.nextId++}`, x: bug.x, y: bug.y, depth: 1, food: 0 };
    nests.push(nest);
    changes.push({ kind: 'nest', text: `${bug.id} 在 (${nest.x},${nest.y}) 挖出蚁巢 ${nest.id}。` });
    enterNest(bug, nest);
    return;
  }
  if (bug.inside) {
    nest = nests.find(nest => nest.id === bug.inside!.nestId)!;
    if (bug.carrying) {
      if (walkInside(bug.inside, TERRARIUM_NEST_STORAGE)) { nest.food = Math.min(nest.depth * 20, nest.food + bug.carrying); bug.carrying = 0; }
      return;
    }
    if ((bug.energy < 70 || (bug.hunger ?? 0) >= TERRARIUM_BUG_FORAGE_HUNGER) && nest.food > 0) { nest.food--; bug.energy = Math.min(100, bug.energy + 20); bug.hunger = Math.max(0, (bug.hunger ?? 0) - 40); return; }
    if (bug.role === 'queen') { walkInside(bug.inside, TERRARIUM_NEST_NURSERY); return; }
    if (nest.depth < 5) {
      nest.depth++;
      if (nest.depth === 5) changes.push({ kind: 'nest', text: `${nest.id} 挖至 5 层，可储存 100 份食物。` });
      return;
    }
    if (walkInside(bug.inside, TERRARIUM_NEST_ENTRANCE)) delete bug.inside;
    return;
  }
  if (bug.role === 'queen') { if (approach(bug, nest)) enterNest(bug, nest); return; }
  if (bug.carrying) {
    if (approach(bug, nest)) enterNest(bug, nest);
    return;
  }
  if ((bug.energy < 70 || (bug.hunger ?? 0) >= TERRARIUM_BUG_FORAGE_HUNGER) && nest.food > 0) {
    if (approach(bug, nest)) enterNest(bug, nest);
    return;
  }
  if (bug.x === nest.x && bug.y === nest.y && nest.depth < 5) {
    enterNest(bug, nest);
    return;
  }
  if (nest.food >= nest.depth * 20) { if (approach(bug, nest)) enterNest(bug, nest); return; }
  const food = nearest(bug, state.food ?? []);
  if (food) {
    if (approach(bug, food)) { food.portions--; bug.carrying = 1; if (!food.portions) state.food!.splice(state.food!.indexOf(food), 1); }
    return;
  }
  const plant = nearest(bug, state.plants.filter(plant => plant.health > 10));
  if (plant && approach(bug, plant)) { damage(plant, 1, '蚂蚁采集'); bug.carrying = 1; }
}

function actBug(state: TerrariumState, bug: BugState, changes: Change[], recordedAtMs: number, currentPhase: 'day' | 'night', damage: PlantDamage): void {
  const predator = bug.species !== 'aphid';
  const atEntrance = (position: { x: number; y: number }): boolean => (state.nests ?? []).some(nest => nest.x === position.x && nest.y === position.y);
  const step = (dx: number, dy: number): boolean => {
    const next = { x: bug.x + dx, y: bug.y + dy };
    if ((!dx && !dy) || !inGrid(next.x, next.y) || (predator && atEntrance(next))) return false;
    bug.x = next.x; bug.y = next.y; return true;
  };
  if (predator && atEntrance(bug)) {
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (step(dx, dy)) break;
    return;
  }
  if (predator && bug.energy >= TERRARIUM_PREDATOR_SATIATED_ENERGY && (bug.hunger ?? 0) < TERRARIUM_BUG_FORAGE_HUNGER) return;
  const targets = bug.species === 'aphid' ? state.plants : state.bugs.filter(other =>
    other.id !== bug.id && !other.inside && !isFlying(other.species) && !atEntrance(other) &&
    Math.abs(other.x - bug.x) + Math.abs(other.y - bug.y) <= TERRARIUM_PREDATOR_SENSE_RADIUS &&
    (bug.species === 'spider' ? other.species !== 'spider' : other.species === 'aphid'));
  const target = [...targets].sort((a, b) =>
    Math.abs(a.x - bug.x) + Math.abs(a.y - bug.y) - Math.abs(b.x - bug.x) - Math.abs(b.y - bug.y) || a.id.localeCompare(b.id))[0];
  if (target) {
    const before = bug.species !== 'aphid' && Math.abs(bug.x - target.x) + Math.abs(bug.y - target.y) <= 1 ? captureFrame(state, currentPhase) : undefined;
    if (!step(Math.sign(target.x - bug.x), 0)) step(0, Math.sign(target.y - bug.y));
    if (bug.x === target.x && bug.y === target.y) {
      if (bug.species === 'aphid') { damage(target as PlantState, 3, '蚜虫取食'); bug.energy = Math.min(100, bug.energy + 5); bug.hunger = Math.max(0, (bug.hunger ?? 0) - 15); }
      else {
        const contact = captureFrame(state, currentPhase);
        state.bugs.splice(state.bugs.indexOf(target as BugState), 1);
        if (state.webs) state.webs = state.webs.filter(web => state.bugs.some(bug => bug.id === web.spiderId));
        bug.energy = Math.min(100, bug.energy + 30);
        bug.hunger = Math.max(0, (bug.hunger ?? 0) - 60);
        const replay: HuntReplay = { id: `hunt-${recordedAtMs}-${bug.id}-${target.id}`, recordedAtMs, hunterId: bug.id, preyId: target.id, frames: [before!, contact, captureFrame(state, currentPhase)] };
        state.replays = [...(state.replays ?? []), replay].slice(-TERRARIUM_MAX_REPLAYS);
        changes.push({ kind: 'hunt', text: `${bug.id} 捕食了 ${target.id}。回放 ID：${replay.id}` });
      }
    }
  } else {
    const direction = (Math.floor(bug.ageHours) + Number(bug.id.split('-')[1])) % 4;
    for (let offset = 0; offset < (predator ? 4 : 1); offset++) {
      const next = (direction + offset) % 4;
      if (step([1, 0, -1, 0][next], [0, 1, 0, -1][next])) break;
    }
  }
}

function weave(state: TerrariumState, spider: BugState, atMs: number, changes: Change[]): void {
  const owned = (state.webs ?? []).filter(web => web.spiderId === spider.id);
  if (owned.some(web => atMs - web.createdAtMs < HOUR_MS) || (state.webs ?? []).some(web => web.x === spider.x && web.y === spider.y) || (state.nests ?? []).some(nest => nest.x === spider.x && nest.y === spider.y)) return;
  const web: SpiderWeb = { id: `web-${state.nextId++}`, spiderId: spider.id, x: spider.x, y: spider.y, createdAtMs: atMs };
  if (owned.length >= TERRARIUM_WEBS_PER_SPIDER) state.webs = state.webs!.filter(value => value.id !== owned[0].id);
  (state.webs ??= []).push(web);
  changes.push({ kind: 'web', text: `${spider.id} 在 (${web.x},${web.y}) 织出蛛网 ${web.id}，飞虫触网会被捕食。` });
}

function trapFly(state: TerrariumState, fly: BugState, atMs: number, currentPhase: 'day' | 'night', changes: Change[], before = captureFrame(state, currentPhase)): boolean {
  const web = state.webs?.find(web => web.x === fly.x && web.y === fly.y);
  const spider = web && state.bugs.find(bug => bug.id === web.spiderId && bug.species === 'spider');
  if (!spider) return false;
  spider.x = fly.x; spider.y = fly.y;
  const contact = captureFrame(state, currentPhase);
  state.bugs.splice(state.bugs.indexOf(fly), 1);
  spider.energy = Math.min(100, spider.energy + 30);
  spider.hunger = Math.max(0, (spider.hunger ?? 0) - 60);
  const replay: HuntReplay = { id: `hunt-${atMs}-${spider.id}-${fly.id}`, recordedAtMs: atMs, hunterId: spider.id, preyId: fly.id, frames: [before, contact, captureFrame(state, currentPhase)] };
  state.replays = [...(state.replays ?? []), replay].slice(-TERRARIUM_MAX_REPLAYS);
  changes.push({ kind: 'hunt', text: `${fly.id} 飞入 ${web!.id}，被 ${spider.id} 捕食。回放 ID：${replay.id}` });
  return true;
}

function actFly(state: TerrariumState, fly: BugState, atMs: number, currentPhase: 'day' | 'night', changes: Change[]): void {
  if (state.webs?.some(web => web.x === fly.x && web.y === fly.y) && trapFly(state, fly, atMs, currentPhase, changes)) return;
  const draw = flightDraw(fly.id, atMs);
  if (draw < TERRARIUM_FLY_MOVE_PROBABILITY) {
    const options = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: fly.x + dx, y: fly.y + dy })).filter(p => inGrid(p.x, p.y));
    const target = options[Math.floor(draw / TERRARIUM_FLY_MOVE_PROBABILITY * options.length)];
    const before = state.webs?.some(web => web.x === target.x && web.y === target.y) ? captureFrame(state, currentPhase) : undefined;
    fly.x = target.x; fly.y = target.y;
    if (before && trapFly(state, fly, atMs, currentPhase, changes, before)) return;
  }
  if (fly.energy < 70 || (fly.hunger ?? 0) >= TERRARIUM_BUG_FORAGE_HUNGER) {
    const plant = state.plants.find(plant => plant.x === fly.x && plant.y === fly.y && flowerStage(plant) === 'bloom');
    if (plant) { fly.energy = Math.min(100, fly.energy + 5); fly.hunger = Math.max(0, (fly.hunger ?? 0) - 15); }
  }
}

const phaseFormatters = new Map<string, Intl.DateTimeFormat>();

export function phase(atMs: number, timezone: string): 'day' | 'night' {
  let formatter = phaseFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' });
    phaseFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(atMs);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  return hour >= 6 && hour < 18 ? 'day' : 'night';
}

function recordHistory(state: TerrariumState, recordedAtMs: number): void {
  state.history.push({ recordedAtMs, soilMoisture: state.soil.map(cell => cell.moisture), plants: state.plants.map(({ id, species, moisture, health, stage, growthHours }) => ({ id, species, moisture, health, stage, growthHours })) });
  state.history = state.history.filter(sample => sample.recordedAtMs >= recordedAtMs - TERRARIUM_MAX_HISTORY * HOUR_MS).slice(-TERRARIUM_MAX_HISTORY);
}

function advanceSoil(state: TerrariumState, hours: number, isDay: boolean): void {
  const moisture = state.soil.map(cell => cell.moisture);
  for (const cell of state.soil) {
    const index = cell.y * 5 + cell.x;
    let diffusion = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (inGrid(cell.x + dx, cell.y + dy)) diffusion += (moisture[(cell.y + dy) * 5 + cell.x + dx] - moisture[index]) * .08;
    }
    const light = daylight(state, cell.x, cell.y);
    const evaporation = isDay ? .8 + light * .4 : .6;
    cell.moisture = Math.max(0, Math.min(100, moisture[index] + (diffusion - evaporation) * hours));
  }
}

export function advance(state: TerrariumState, nowMs: number, timezone: string): Change[] {
  ensureQueen(state);
  for (const egg of state.eggs ?? []) if (egg.species === 'ant' && !egg.inside) {
    const nest = state.nests?.find(nest => nest.x === egg.x && nest.y === egg.y);
    if (nest) egg.inside = { nestId: nest.id, ...TERRARIUM_NEST_NURSERY };
  }
  if (nowMs <= state.updatedAtMs) return [];
  const changes: Change[] = [];
  // Old saves begin hunger at the end of their first catch-up, without retroactive starvation.
  const legacyBugs = new Set(state.bugs.filter(bug => bug.hunger === undefined));
  const initialHealth = new Map(state.plants.map(plant => [plant.id, plant.health]));
  const losses = new Map<string, Map<string, number>>();
  const damage: PlantDamage = (plant, amount, cause) => {
    const loss = Math.min(plant.health, amount);
    plant.health -= loss;
    if (loss <= 0) return;
    const causes = losses.get(plant.id) ?? new Map<string, number>();
    causes.set(cause, (causes.get(cause) ?? 0) + loss);
    losses.set(plant.id, causes);
  };
  const damageText = (plant: PlantState): string => {
    const causes = losses.get(plant.id);
    return causes ? ` 本次结算损伤：${[...causes].map(([cause, loss]) => `${cause} -${loss.toFixed(2)} 健康`).join('；')}。` : '';
  };
  // The simulation catches up after downtime while keeping a finite work bound.
  const stepMs = state.bugs.some(bug => bug.species === 'ant' || isFlying(bug.species)) || state.eggs?.length ? TERRARIUM_ANT_ACTION_INTERVAL_MS : TERRARIUM_BUG_ACTION_INTERVAL_MS;
  const from = Math.max(state.updatedAtMs, nowMs - MAX_CATCHUP_MS);
  for (let start = from; start < nowMs; start = Math.min(nowMs, (Math.floor(start / stepMs) + 1) * stepMs)) {
    ensureQueen(state);
    const end = Math.min(nowMs, (Math.floor(start / stepMs) + 1) * stepMs);
    if (state.webs) state.webs = state.webs.filter(web => end - web.createdAtMs < TERRARIUM_WEB_LIFETIME_MS && state.bugs.some(bug => bug.id === web.spiderId && bug.species === 'spider'));
    const hours = (end - start) / HOUR_MS;
    const before = phase(start, timezone);
    const after = phase(end, timezone);
    if (before !== after) changes.push({ kind: 'phase', text: after === 'day' ? '生态箱天亮了。' : '生态箱天黑了。' });
    advanceSoil(state, hours, before === 'day');
    for (const seed of [...state.seeds]) {
      const moisture = state.soil[seed.y * 5 + seed.x].moisture;
      if (before === 'day' && moisture >= TERRARIUM_PLANT_REQUIREMENTS[seed.species].minMoisture) seed.ageHours += hours;
      if (seed.ageHours >= 2) {
        state.seeds.splice(state.seeds.indexOf(seed), 1);
        state.plants.push({ id: seed.id, species: seed.species, x: seed.x, y: seed.y, moisture, growthHours: 0, stage: 0, dry: false, health: 100 });
        changes.push({ kind: 'sprout', text: `${seed.id} 发芽了。` });
      }
    }
    for (const plant of state.plants) {
      const previousFlower = flowerStage(plant);
      plant.moisture = state.soil[plant.y * 5 + plant.x].moisture;
      const needs = TERRARIUM_PLANT_REQUIREMENTS[plant.species];
      const light = daylight(state, plant.x, plant.y);
      const hydrated = plant.moisture >= needs.minMoisture && plant.moisture <= needs.maxMoisture;
      if (before === 'day' && hydrated && light >= needs.minLight && light <= needs.maxLight) plant.growthHours += hours;
      if (!hydrated) damage(plant, hours * .5, plant.moisture < needs.minMoisture ? '水分过低' : '水分过高');
      const stage = STAGES.reduce((n, threshold, index) => plant.growthHours >= threshold ? index : n, 0);
      if (stage !== plant.stage) {
        plant.stage = stage;
        changes.push({ kind: 'stage', text: `${plant.id === 'fern' ? '蕨草' : plant.id === 'clover' ? '三叶草' : plant.id}长到了第 ${stage} 阶段。` });
      }
      if (!plant.dry && plant.moisture < needs.minMoisture) {
        plant.dry = true;
        changes.push({ kind: 'dry', text: `${plant.id === 'fern' ? '蕨草' : plant.id === 'clover' ? '三叶草' : plant.id}的土壤变干了（水分 ${plant.moisture.toFixed(1)}，生长下限 ${needs.minMoisture}）。` });
      }
      plant.dry = plant.moisture < needs.minMoisture;
      if (flowerStage(plant) === 'bloom' && previousFlower !== 'bloom') changes.push({ kind: 'stage', text: `${plant.id}（${plant.species}）开花了。` });
    }
    if (state.food) state.food = state.food.filter(food => food.droppedAtMs + 48 * HOUR_MS > end);
    const hourlyStep = Math.floor(start / HOUR_MS) !== Math.floor(end / HOUR_MS);
    const currentBugs = [...state.bugs];
    if (hourlyStep && state.bugs.length + (state.eggs?.length ?? 0) < 12) {
      const paired = new Set<string>();
      for (const bug of currentBugs) {
        if (state.bugs.length + (state.eggs?.length ?? 0) >= 12) break;
        if (!state.bugs.includes(bug)) continue;
        if (bug.species === 'ant') continue;
        if (paired.has(bug.id) || Math.floor(bug.ageHours + hours + 1e-9) < 24 || Math.floor(bug.ageHours + hours + 1e-9) % 24 !== 0 || bug.energy - hours * 2 < 70) continue;
        const mate = currentBugs.find(other => other.id !== bug.id && state.bugs.includes(other) && !paired.has(other.id) && other.species === bug.species && other.x === bug.x && other.y === bug.y && other.ageHours + hours + 1e-9 >= 24 && other.energy - hours * 2 >= 70);
        if (!mate) continue;
        bug.energy -= 25; mate.energy -= 25;
        paired.add(bug.id); paired.add(mate.id);
        if (bug.species === 'aphid') {
          const child = { id: `bug-${state.nextId++}`, species: bug.species, x: bug.x, y: bug.y, ageHours: 0, energy: 45, hunger: 0 };
          state.bugs.push(child);
          changes.push({ kind: 'birth', text: `${bug.id} 和 ${mate.id} 产下幼虫 ${child.id}（aphid），位置 (${child.x},${child.y})。` });
        } else {
          const eggs = state.eggs ??= [];
          const count = Math.min(2, 12 - state.bugs.length - eggs.length);
          for (let i = 0; i < count; i++) eggs.push({ id: `egg-${state.nextId++}`, species: bug.species, x: bug.x, y: bug.y, laidAtMs: end, hatchesAtMs: end + 4 * HOUR_MS });
          changes.push({ kind: 'egg', text: `${bug.id} 和 ${mate.id} 产下 ${count} 枚 ${bug.species} 卵，位置 (${bug.x},${bug.y})，4 小时后孵化。` });
        }
        if (state.bugs.length + (state.eggs?.length ?? 0) >= 12) break;
      }
    }
    for (const bug of currentBugs) {
      if (!state.bugs.includes(bug)) continue;
      const previousEnergy = bug.energy;
      const previousHunger = bug.hunger ?? 0;
      bug.hunger = legacyBugs.has(bug) ? 0 : Math.min(100, previousHunger + hours * 100 / TERRARIUM_BUG_STARVATION_HOURS);
      if (bug.hunger >= 100 - 1e-9) {
        state.bugs.splice(state.bugs.indexOf(bug), 1);
        if (state.webs) state.webs = state.webs.filter(web => web.spiderId !== bug.id);
        changes.push({ kind: 'death', text: `${bug.id}（${bug.species}）因饥饿死亡：饥饿值达到 100。` });
        continue;
      }
      bug.ageHours += hours; bug.energy = Math.max(0, bug.energy - hours * 2);
      const interval = isFlying(bug.species) ? TERRARIUM_FLY_ACTION_INTERVAL_MS : bug.species === 'ant' ? TERRARIUM_ANT_ACTION_INTERVAL_MS : TERRARIUM_BUG_ACTION_INTERVAL_MS;
      if (Math.floor(start / interval) !== Math.floor(end / interval)) {
        if (bug.species === 'spider') weave(state, bug, end, changes);
        if (isFlying(bug.species)) actFly(state, bug, end, after, changes);
        else if (bug.species === 'ant') actAnt(state, bug, changes, damage);
        else actBug(state, bug, changes, end, after, damage);
      }
      if (!state.bugs.includes(bug)) continue;
      if (bug.role === 'queen' && bug.inside && bug.ageHours >= 24 - 1e-9 && bug.ageHours < 120 && bug.energy >= 70 && Math.floor((bug.ageHours - hours + 1e-9) / 6) !== Math.floor((bug.ageHours + 1e-9) / 6)) {
        const eggs = state.eggs ??= [];
        const count = Math.min(2, 12 - state.bugs.length - eggs.length);
        if (count > 0) {
          for (let i = 0; i < count; i++) eggs.push({ id: `egg-${state.nextId++}`, species: 'ant', x: bug.x, y: bug.y, inside: { ...bug.inside }, laidAtMs: end, hatchesAtMs: end + 6 * HOUR_MS });
          bug.energy -= 25;
          changes.push({ kind: 'egg', text: `蚁后 ${bug.id} 在蚁巢 ${bug.inside.nestId} 产下 ${count} 枚卵，6 小时后孵化。` });
        }
      }
      if (bug.ageHours >= 120) { state.bugs.splice(state.bugs.indexOf(bug), 1); if (state.webs) state.webs = state.webs.filter(web => web.spiderId !== bug.id); changes.push({ kind: 'death', text: `${bug.id} 死亡了。` }); }
      else if (previousHunger < TERRARIUM_BUG_HUNGER_WARNING && bug.hunger >= TERRARIUM_BUG_HUNGER_WARNING) changes.push({ kind: 'hungry', text: `${bug.id}（${bug.species}）饥饿值 ${bug.hunger.toFixed(1)}/100，达到 100 会饿死。需要实际取食；terrarium_feed_bug 只补能量，不能降低饥饿值。` });
      else if (previousEnergy > 20 && bug.energy <= 20) changes.push({ kind: 'hungry', text: `${bug.id}（${bug.species}）体力低于 20，位置 (${bug.x},${bug.y})。` });
    }
    for (const egg of [...(state.eggs ?? [])]) if (egg.hatchesAtMs <= end && state.bugs.length < 12) {
      state.eggs!.splice(state.eggs!.indexOf(egg), 1);
      const child: BugState = { id: `bug-${state.nextId++}`, species: egg.species, x: egg.x, y: egg.y, ageHours: 0, energy: 45, hunger: 0 };
      if (egg.species === 'ant') { child.role = 'worker'; if (egg.inside) child.inside = { ...egg.inside }; }
      state.bugs.push(child);
      changes.push({ kind: 'birth', text: `${egg.id} 孵化为幼虫 ${child.id}（${child.species}），位置 (${child.x},${child.y})。` });
    }
    for (const plant of [...state.plants]) {
      if (plant.health <= 0) { state.plants.splice(state.plants.indexOf(plant), 1); changes.push({ kind: 'death', text: `${plant.id} 枯死了。${damageText(plant)}` }); }
      else if (plant.health <= TERRARIUM_PLANT_LOW_HEALTH && !plant.healthWarning) {
        plant.healthWarning = true;
        const needs = TERRARIUM_PLANT_REQUIREMENTS[plant.species];
        changes.push({ kind: 'health', text: `${plant.id}（${plant.species}）濒危：健康 ${plant.health.toFixed(1)}/100，位置 (${plant.x},${plant.y})，土壤水分 ${plant.moisture.toFixed(1)}（适宜 ${needs.minMoisture}–${needs.maxMoisture}）。${damageText(plant)}浇水恢复 5 健康，先检查水分是否已超出适宜范围。` });
      } else if (plant.health >= TERRARIUM_PLANT_RECOVERED_HEALTH) delete plant.healthWarning;
    }
    if (state.webs) state.webs = state.webs.filter(web => end - web.createdAtMs < TERRARIUM_WEB_LIFETIME_MS && state.bugs.some(bug => bug.id === web.spiderId && bug.species === 'spider'));
    if (hourlyStep) recordHistory(state, end);
  }
  for (const plant of state.plants) {
    const previous = initialHealth.get(plant.id);
    if (previous !== undefined && plant.health > TERRARIUM_PLANT_LOW_HEALTH && [75, 50].some(threshold => previous > threshold && plant.health <= threshold)) {
      changes.push({ kind: 'health', text: `${plant.id}（${plant.species}）健康下降：${previous.toFixed(1)} → ${plant.health.toFixed(1)}/100，位置 (${plant.x},${plant.y})。${damageText(plant)}` });
    }
  }
  if (state.replays) state.replays = state.replays.filter(replay => replay.recordedAtMs >= nowMs - TERRARIUM_REPLAY_RETENTION_MS);
  state.updatedAtMs = nowMs;
  return changes;
}

export function water(state: TerrariumState, id: PlantId): PlantState {
  const plant = state.plants.find(item => item.id === id);
  if (!plant) throw new Error('Unknown plant');
  waterSoil(state, plant.x, plant.y);
  return plant;
}

export function waterSoil(state: TerrariumState, x: number, y: number): SoilCell {
  if (!inGrid(x, y)) throw new Error('Position must be in the 5×5 grid');
  const cell = state.soil[y * 5 + x];
  cell.moisture = Math.min(100, cell.moisture + 35);
  const plant = state.plants.find(item => item.x === x && item.y === y);
  if (plant) {
    plant.moisture = cell.moisture;
    plant.dry = plant.moisture < TERRARIUM_PLANT_REQUIREMENTS[plant.species].minMoisture;
    plant.health = Math.min(100, plant.health + 5);
    if (plant.health >= TERRARIUM_PLANT_RECOVERED_HEALTH) delete plant.healthWarning;
  }
  return cell;
}

export function waterArea(state: TerrariumState, x1: number, y1: number, x2: number, y2: number): SoilCell[] {
  if (!inGrid(x1, y1) || !inGrid(x2, y2) || x1 > x2 || y1 > y2) throw new Error('Area must be ordered corners within the 5×5 grid');
  const cells: SoilCell[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells.push(waterSoil(state, x, y));
  return cells;
}

export function move(state: TerrariumState, id: ItemId, x: number, y: number): ItemState {
  if (!inGrid(x, y)) throw new Error('Position must be in the 5×5 grid');
  if (state.plants.some(p => p.x === x && p.y === y)) throw new Error('That position belongs to a plant');
  const item = state.items.find(value => value.id === id);
  if (!item) throw new Error('Unknown item');
  if (state.items.some(other => other.id !== id && other.x === x && other.y === y)) throw new Error('That position is occupied');
  item.x = x; item.y = y;
  return item;
}

export async function loadState(file: string, nowMs: number): Promise<TerrariumState> {
  let raw: string;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return newState(nowMs); throw error; }
  return migrateState(JSON.parse(raw));
}

/** Reads earlier saves and reports without advancing their simulation time. */
export function migrateState(value: unknown): TerrariumState {
  if ((value as { version?: number })?.version === 1) {
    const old = value as { updatedAtMs: number; plants: Array<{ id: string; moisture: number; growthHours: number; stage: number; dry: boolean }>; items: ItemState[] };
    if (!Number.isFinite(old.updatedAtMs) || !Array.isArray(old.plants) || old.plants.length !== 2 || !Array.isArray(old.items)) throw new Error('Invalid terrarium state file');
    const migrated = newState(old.updatedAtMs);
    migrated.plants = old.plants.map(p => ({ ...p, species: p.id as PlantSpecies, x: p.id === 'fern' ? 0 : 4, y: 0, health: 100 }));
    migrated.items = old.items;
    if (!validState(migrated)) throw new Error('Invalid terrarium state file');
    initializeHabitat(migrated);
    return migrated;
  }
  if ((value as { version?: number })?.version === 2) {
    const migrated = { ...(value as TerrariumState), version: 3, soil: newState(0).soil, history: [] } as TerrariumState;
    if (!validState(migrated)) throw new Error('Invalid terrarium state file');
    initializeHabitat(migrated);
    return migrated;
  }
  if ((value as { version?: number })?.version === 3 && Array.isArray((value as TerrariumState).history)) {
    value = { ...(value as TerrariumState), history: (value as TerrariumState).history.map(sample => {
      if (sample && typeof sample === 'object' && !Object.hasOwn(sample, 'recordedAtMs') && Object.hasOwn(sample, 'atMs')) {
        const { atMs, ...rest } = sample as unknown as Record<string, unknown>;
        return { ...rest, recordedAtMs: atMs };
      }
      return sample;
    }) };
  }
  if (!validState(value)) throw new Error('Invalid terrarium state file');
  return value;
}

function initializeHabitat(state: TerrariumState): void {
  for (const plant of state.plants) {
    state.soil[plant.y * 5 + plant.x].moisture = plant.moisture;
    plant.dry = plant.moisture < TERRARIUM_PLANT_REQUIREMENTS[plant.species].minMoisture;
  }
  state.history = [];
  recordHistory(state, state.updatedAtMs);
}

function validHabitat(state: Partial<TerrariumState>): boolean {
  const percent = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 100;
  return Array.isArray(state.soil) && state.soil.length === 25 && state.soil.every((cell, i) => cell && cell.x === i % 5 && cell.y === Math.floor(i / 5) && percent(cell.moisture)) &&
    Array.isArray(state.history) && state.history.length <= TERRARIUM_MAX_HISTORY && state.history.every((sample, i) => sample && Number.isFinite(sample.recordedAtMs) && sample.recordedAtMs <= state.updatedAtMs! && (i === 0 || sample.recordedAtMs > state.history![i - 1].recordedAtMs) &&
      Array.isArray(sample.soilMoisture) && sample.soilMoisture.length === 25 && sample.soilMoisture.every(percent) && Array.isArray(sample.plants) && sample.plants.length <= 12 &&
      sample.plants.every(p => p && typeof p.id === 'string' && p.id.length <= 32 && Object.hasOwn(TERRARIUM_PLANT_REQUIREMENTS, p.species) && percent(p.moisture) && percent(p.health) && Number.isInteger(p.stage) && p.stage >= 0 && p.stage <= 3 && Number.isFinite(p.growthHours) && p.growthHours >= 0));
}

function validReplays(state: Partial<TerrariumState>): boolean {
  return state.replays === undefined || (Array.isArray(state.replays) && state.replays.length <= TERRARIUM_MAX_REPLAYS && state.replays.every((replay, i) => {
    if (!replay || typeof replay.id !== 'string' || replay.id.length > 160 || typeof replay.hunterId !== 'string' || typeof replay.preyId !== 'string' || !Number.isFinite(replay.recordedAtMs) || replay.recordedAtMs > state.updatedAtMs! || (i > 0 && replay.recordedAtMs < state.replays![i - 1].recordedAtMs) || !Array.isArray(replay.frames) || replay.frames.length !== 3) return false;
    if (!replay.frames.every(frame => frame && (frame.phase === 'day' || frame.phase === 'night') && validState({ ...frame, version: 3, nextId: state.nextId, updatedAtMs: replay.recordedAtMs, history: [], replays: undefined }))) return false;
    const [before, contact, after] = replay.frames;
    const hunter = contact.bugs.find(bug => bug.id === replay.hunterId);
    const prey = contact.bugs.find(bug => bug.id === replay.preyId);
    return !!hunter && !!prey && hunter.x === prey.x && hunter.y === prey.y && (hunter.species === 'spider' ? prey.species !== 'spider' : hunter.species === 'beetle' && prey.species === 'aphid') && before.bugs.some(bug => bug.id === hunter.id) && before.bugs.some(bug => bug.id === prey.id) && after.bugs.some(bug => bug.id === hunter.id) && !after.bugs.some(bug => bug.id === prey.id);
  }) && new Set(state.replays.map(replay => replay.id)).size === state.replays.length);
}

export function validState(value: unknown): value is TerrariumState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<TerrariumState>;
  return state.version === 3 && (state.name === undefined || validName(state.name)) && validHabitat(state) && validReplays(state) && Number.isFinite(state.updatedAtMs) && Number.isSafeInteger(state.nextId) && state.nextId! >= 1 &&
    Array.isArray(state.plants) && state.plants.length <= 12 &&
    state.plants.every(p => p && typeof p.id === 'string' && p.id.length <= 32 && ['fern', 'clover', 'moss', 'basil', 'bean'].includes(p.species) && inGrid(p.x, p.y) && Number.isFinite(p.moisture) && p.moisture >= 0 && p.moisture <= 100 && Number.isFinite(p.growthHours) && p.growthHours >= 0 && Number.isInteger(p.stage) && p.stage >= 0 && p.stage <= 3 && typeof p.dry === 'boolean' && Number.isFinite(p.health) && p.health >= 0 && p.health <= 100 && (p.healthWarning === undefined || typeof p.healthWarning === 'boolean')) &&
    Array.isArray(state.seeds) && state.seeds.length <= 12 && state.plants.length + state.seeds.length <= 12 && state.seeds.every(s => s && typeof s.id === 'string' && ['moss', 'basil', 'bean'].includes(s.species) && inGrid(s.x, s.y) && Number.isFinite(s.ageHours) && s.ageHours >= 0) &&
    Array.isArray(state.bugs) && state.bugs.length <= 12 && state.bugs.every(b => b && typeof b.id === 'string' && (['aphid', 'beetle', 'spider', 'ant'].includes(b.species) || isFlying(b.species)) && inGrid(b.x, b.y) && Number.isFinite(b.energy) && b.energy >= 0 && b.energy <= 100 && (b.hunger === undefined || (Number.isFinite(b.hunger) && b.hunger >= 0 && b.hunger <= 100)) && (b.carrying === undefined || (b.species === 'ant' && Number.isInteger(b.carrying) && b.carrying >= 0 && b.carrying <= 5)) && Number.isFinite(b.ageHours) && b.ageHours >= 0) &&
    (state.eggs === undefined || (Array.isArray(state.eggs) && state.eggs.length <= 12 && state.eggs.every(egg => egg && typeof egg.id === 'string' && egg.id.length <= 32 && (['beetle', 'spider', 'ant'].includes(egg.species) || isFlying(egg.species)) && inGrid(egg.x, egg.y) && Number.isFinite(egg.laidAtMs) && egg.laidAtMs <= state.updatedAtMs! && Number.isFinite(egg.hatchesAtMs) && egg.hatchesAtMs > egg.laidAtMs && egg.hatchesAtMs <= egg.laidAtMs + 6 * HOUR_MS))) &&
    state.bugs.length + (state.eggs?.length ?? 0) <= 12 &&
    (state.nests === undefined || (Array.isArray(state.nests) && state.nests.length <= 5 && state.nests.every(nest => nest && typeof nest.id === 'string' && nest.id.length <= 32 && inGrid(nest.x, nest.y) && Number.isInteger(nest.depth) && nest.depth >= 1 && nest.depth <= 5 && Number.isInteger(nest.food) && nest.food >= 0 && nest.food <= nest.depth * 20) && new Set(state.nests.map(nest => `${nest.x},${nest.y}`)).size === state.nests.length)) &&
    (state.food === undefined || (Array.isArray(state.food) && state.food.length <= 20 && state.food.every(food => food && typeof food.id === 'string' && food.id.length <= 32 && inGrid(food.x, food.y) && Number.isInteger(food.portions) && food.portions >= 1 && food.portions <= 10 && Number.isFinite(food.droppedAtMs) && food.droppedAtMs <= state.updatedAtMs!))) &&
    (state.webs === undefined || (Array.isArray(state.webs) && state.webs.length <= 12 * TERRARIUM_WEBS_PER_SPIDER && state.webs.every(web => web && typeof web.id === 'string' && web.id.length <= 32 && typeof web.spiderId === 'string' && inGrid(web.x, web.y) && Number.isFinite(web.createdAtMs) && web.createdAtMs <= state.updatedAtMs! && state.bugs!.some(bug => bug.id === web.spiderId && bug.species === 'spider')) && new Set(state.webs.map(web => `${web.x},${web.y}`)).size === state.webs.length && state.bugs.every(bug => state.webs!.filter(web => web.spiderId === bug.id).length <= TERRARIUM_WEBS_PER_SPIDER))) &&
    Array.isArray(state.items) && state.items.length === 2 &&
    ['coin', 'pebble'].every(id => state.items!.filter(item => item.id === id && inGrid(item.x, item.y)).length === 1) &&
    !(state.items[0].x === state.items[1].x && state.items[0].y === state.items[1].y) &&
    new Set([...state.plants, ...state.seeds, ...state.bugs, ...(state.eggs ?? []), ...(state.nests ?? []), ...(state.food ?? []), ...(state.webs ?? [])].map(v => v.id)).size === state.plants.length + state.seeds.length + state.bugs.length + (state.eggs?.length ?? 0) + (state.nests?.length ?? 0) + (state.food?.length ?? 0) + (state.webs?.length ?? 0) &&
    new Set([...state.plants, ...state.seeds].map(v => `${v.x},${v.y}`)).size === state.plants.length + state.seeds.length && validColony(state as TerrariumState);
}

export async function saveState(file: string, state: TerrariumState | import('./aquarium.ts').AquariumState): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
  await rename(temporary, file);
}
