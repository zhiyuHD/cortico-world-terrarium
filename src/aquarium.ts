import { validCollection, type CollectionItem } from './collection.ts';
import { TERRARIUM_MAX_NAME_LENGTH } from './state.ts';
import { phase } from './state.ts';
import { TERRARIUM_MAX_REPLAYS, TERRARIUM_REPLAY_RETENTION_MS } from './replay.ts';

export type FishSpecies = 'guppy' | 'goldfish' | 'perch';
export type AquaticPlantSpecies = 'waterweed' | 'waterlily' | 'algae';
export interface FishState { id: string; species: FishSpecies; x: number; y: number; energy: number; health: number; ageHours: number; lastMeal?: { atMs: number; kind: 'fish' | 'food' | 'algae'; id: string } }
export interface AquaticPlantState { id: string; species: AquaticPlantSpecies; x: number; y: number; health: number; growthHours: number; stage: number }
export interface FishFood { id: string; x: number; y: number; portions: number; droppedAtMs: number }
export interface AquariumFrame { kind: 'water'; phase: 'day' | 'night'; oxygen: number; cleanliness: number; fish: FishState[]; plants: AquaticPlantState[]; food: FishFood[] }
export interface AquariumReplay { id: string; recordedAtMs: number; hunterId: string; preyId: string; frames: [AquariumFrame, AquariumFrame, AquariumFrame] }
export interface AquariumHistory { recordedAtMs: number; oxygen: number; cleanliness: number; fish: FishState[] }
export interface AquariumState { collection?: CollectionItem[]; oxygenWarning?: boolean; version: 1; kind: 'water'; name?: string; updatedAtMs: number; nextId: number; oxygen: number; cleanliness: number; fish: FishState[]; plants: AquaticPlantState[]; food: FishFood[]; history: AquariumHistory[]; replays: AquariumReplay[] }
export interface AquariumChange { kind: 'hunt' | 'hungry' | 'ecosystem' | 'oxygen'; text: string }
const HOUR_MS = 3_600_000;
export const TERRARIUM_FISH_ACTION_INTERVAL_MS = 10 * 60_000;
const clamp = (value: number): number => Math.max(0, Math.min(100, value));
const grid = (x: number, y: number): boolean => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 5 && y >= 0 && y < 5;
const percent = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 100;

export function newAquarium(nowMs: number): AquariumState {
  const state: AquariumState = { version: 1, kind: 'water', updatedAtMs: nowMs, nextId: 1, oxygen: 80, cleanliness: 100, fish: [], plants: [], food: [], history: [], replays: [] };
  plantAquatic(state, 'waterweed', 0, 0); plantAquatic(state, 'algae', 4, 0);
  recordHistory(state, nowMs);
  return state;
}
export function stockFish(state: AquariumState, species: unknown, x: number, y: number): FishState {
  if (!['guppy', 'goldfish', 'perch'].includes(String(species))) throw new Error('Unknown fish species');
  if (!grid(x, y)) throw new Error('Position must be in the 5×5 grid');
  if (state.fish.length >= 12) throw new Error('Fish capacity reached');
  const fish: FishState = { id: `fish-${state.nextId++}`, species: species as FishSpecies, x, y, health: 100, energy: 60, ageHours: 0 };
  state.fish.push(fish); return fish;
}
export function plantAquatic(state: AquariumState, species: unknown, x: number, y: number): AquaticPlantState {
  if (!['waterweed', 'waterlily', 'algae'].includes(String(species))) throw new Error('Unknown aquatic plant species');
  if (!grid(x, y)) throw new Error('Position must be in the 5×5 grid');
  if (state.plants.length >= 12) throw new Error('Aquatic plant capacity reached');
  if (state.plants.some(plant => plant.x === x && plant.y === y)) throw new Error('That plot already has an aquatic plant');
  const plant: AquaticPlantState = { id: `aquatic-${state.nextId++}`, species: species as AquaticPlantSpecies, x, y, health: 100, growthHours: 0, stage: 0 };
  state.plants.push(plant); return plant;
}
export function dropFishFood(state: AquariumState, x: number, y: number, portions: number): FishFood {
  if (!grid(x, y)) throw new Error('Position must be in the 5×5 grid');
  if (!Number.isInteger(portions) || portions < 1 || portions > 10) throw new Error('Food portions must be 1..10');
  if (state.food.length >= 20) throw new Error('Food capacity reached');
  const food = { id: `food-${state.nextId++}`, x, y, portions, droppedAtMs: state.updatedAtMs };
  state.food.push(food); return food;
}
export function changeWater(state: AquariumState, percent: number): void {
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) throw new Error('Water change must be 1..100 percent');
  state.cleanliness += (100 - state.cleanliness) * percent / 100;
  state.oxygen += (90 - state.oxygen) * percent / 100;
  state.food = state.food.filter(food => { food.portions = Math.floor(food.portions * (1 - percent / 100)); return food.portions > 0; });
}
export function removeAquatic(state: AquariumState, id: string): void {
  for (const values of [state.fish, state.plants, state.food]) {
    const index = values.findIndex(value => value.id === id);
    if (index >= 0) { values.splice(index, 1); return; }
  }
  throw new Error('Unknown aquatic organism or food');
}
export function relocateFish(state: AquariumState, id: string, x: number, y: number): FishState {
  if (!grid(x, y)) throw new Error('Position must be in the 5×5 grid');
  const fish = state.fish.find(fish => fish.id === id);
  if (!fish) throw new Error('Unknown fish');
  fish.x = x; fish.y = y; return fish;
}
function frame(state: AquariumState, atMs: number, timezone: string): AquariumFrame {
  return structuredClone({ kind: 'water', phase: phase(atMs, timezone), oxygen: state.oxygen, cleanliness: state.cleanliness, fish: state.fish, plants: state.plants, food: state.food });
}
function recordHistory(state: AquariumState, recordedAtMs: number): void {
  state.history.push({ recordedAtMs, oxygen: state.oxygen, cleanliness: state.cleanliness, fish: structuredClone(state.fish) });
  state.history = state.history.filter(sample => sample.recordedAtMs >= recordedAtMs - 168 * HOUR_MS).slice(-168);
}
function actFish(state: AquariumState, fish: FishState, atMs: number, timezone: string, changes: AquariumChange[]): void {
  const prey = fish.species === 'perch' ? state.fish.filter(other => other.species === 'guppy') : [];
  const targets = prey.length ? prey : state.food.length ? state.food : fish.species === 'goldfish' && fish.energy < 70 ? state.plants.filter(plant => plant.species === 'algae' && plant.health > 30) : [];
  const target = [...targets].sort((a, b) => Math.abs(a.x - fish.x) + Math.abs(a.y - fish.y) - Math.abs(b.x - fish.x) - Math.abs(b.y - fish.y) || a.id.localeCompare(b.id))[0];
  if (!target) {
    const direction = (Math.floor(atMs / TERRARIUM_FISH_ACTION_INTERVAL_MS) + Number(fish.id.split('-')[1])) % 4;
    fish.x = Math.max(0, Math.min(4, fish.x + [1, 0, -1, 0][direction]));
    fish.y = Math.max(0, Math.min(4, fish.y + [0, 1, 0, -1][direction])); return;
  }
  const before = prey.includes(target as FishState) && Math.abs(target.x - fish.x) + Math.abs(target.y - fish.y) <= 1 ? frame(state, atMs, timezone) : undefined;
  if (fish.x !== target.x) fish.x += Math.sign(target.x - fish.x);
  else if (fish.y !== target.y) fish.y += Math.sign(target.y - fish.y);
  if (fish.x !== target.x || fish.y !== target.y) return;
  if (prey.includes(target as FishState)) {
    const contact = frame(state, atMs, timezone);
    fish.lastMeal = { atMs, kind: 'fish', id: target.id };
    state.fish.splice(state.fish.indexOf(target as FishState), 1); fish.energy = clamp(fish.energy + 30);
    const replay: AquariumReplay = { id: `hunt-${atMs}-${fish.id}-${target.id}`, recordedAtMs: atMs, hunterId: fish.id, preyId: target.id, frames: [before!, contact, frame(state, atMs, timezone)] };
    state.replays.push(replay); state.replays = state.replays.slice(-TERRARIUM_MAX_REPLAYS);
    changes.push({ kind: 'hunt', text: `${fish.id} 捕食了 ${target.id}。回放 ID：${replay.id}` });
  } else if (state.food.includes(target as FishFood)) {
    fish.lastMeal = { atMs, kind: 'food', id: target.id };
    const food = target as FishFood; food.portions--; fish.energy = clamp(fish.energy + 20);
    if (!food.portions) state.food.splice(state.food.indexOf(food), 1);
  } else { fish.lastMeal = { atMs, kind: 'algae', id: target.id }; const plant = target as AquaticPlantState; plant.health = clamp(plant.health - 2); fish.energy = clamp(fish.energy + 5); }
}
export function advanceAquarium(state: AquariumState, nowMs: number, timezone: string): AquariumChange[] {
  const changes: AquariumChange[] = [];
  for (let start = Math.max(state.updatedAtMs, nowMs - 30 * 24 * HOUR_MS); start < nowMs;) {
    const end = Math.min(nowMs, (Math.floor(start / TERRARIUM_FISH_ACTION_INTERVAL_MS) + 1) * TERRARIUM_FISH_ACTION_INTERVAL_MS);
    const hours = (end - start) / HOUR_MS;
    const day = phase(start, timezone) === 'day';
    state.oxygen = clamp(state.oxygen + (1 + state.plants.reduce((n, p) => n + (day ? p.species === 'algae' ? 1.1 : p.species === 'waterlily' ? .5 : .8 : p.species === 'waterlily' ? -.1 : p.species === 'algae' ? -.3 : -.2), 0) + (state.plants.some(p => p.species === 'waterweed' && p.health >= 60) && state.plants.some(p => p.species === 'waterlily' && p.health >= 60) ? .2 : 0) - state.fish.length * .3) * hours);
    state.cleanliness = clamp(state.cleanliness - (state.fish.length * .15 + state.food.reduce((n, food) => n + food.portions, 0) * .05) * hours);
    state.food = state.food.filter(food => food.droppedAtMs + 6 * HOUR_MS > end);
    for (const plant of state.plants) {
      if (day && state.cleanliness >= 40) plant.growthHours += hours;
      if (day && state.cleanliness >= 60 && state.oxygen >= 40) plant.health = clamp(plant.health + hours * .5);
      if (state.cleanliness < 30) plant.health = clamp(plant.health - hours * .5);
      plant.stage = [0, 2, 6, 12].reduce((stage, threshold, index) => plant.growthHours >= threshold ? index : stage, 0);
    }
    for (const fish of [...state.fish]) {
      if (!state.fish.includes(fish)) continue;
      const energy = fish.energy; fish.energy = clamp(fish.energy - (state.oxygen >= 70 && state.cleanliness >= 70 && fish.energy < 70 ? 1 : 2) * hours); fish.ageHours += hours;
      if (state.oxygen < 25 || state.cleanliness < 30) fish.health = clamp(fish.health - 2 * hours);
      if (Math.floor(start / TERRARIUM_FISH_ACTION_INTERVAL_MS) !== Math.floor(end / TERRARIUM_FISH_ACTION_INTERVAL_MS)) actFish(state, fish, end, timezone, changes);
      if (fish.health <= 0 || fish.energy <= 0) { state.fish.splice(state.fish.indexOf(fish), 1); changes.push({ kind: 'ecosystem', text: `${fish.id} 死亡了。` }); }
      else if (energy > 20 && fish.energy <= 20) changes.push({ kind: 'hungry', text: `${fish.id} 体力低于 20。` });
    }
    if (state.oxygen <= 40 && !state.oxygenWarning) { state.oxygenWarning = true; changes.push({ kind: 'oxygen', text: `含氧量降至 ${state.oxygen.toFixed(1)}/100，低于 25 会损害鱼类健康。可以换水并检查鱼草数量；本提醒恢复到 50 后才会再次触发。` }); }
    else if (state.oxygen >= 50) delete state.oxygenWarning;
    for (const plant of [...state.plants]) if (plant.health <= 0) { state.plants.splice(state.plants.indexOf(plant), 1); changes.push({ kind: 'ecosystem', text: `${plant.id} 枯死了。` }); }
    if (Math.floor(start / HOUR_MS) !== Math.floor(end / HOUR_MS)) recordHistory(state, end);
    start = end;
  }
  state.updatedAtMs = Math.max(state.updatedAtMs, nowMs);
  state.replays = state.replays.filter(replay => replay.recordedAtMs >= nowMs - TERRARIUM_REPLAY_RETENTION_MS);
  return changes;
}
function validFrame(value: unknown, atMs: number): value is AquariumFrame {
  if (!value || typeof value !== 'object') return false;
  const s = value as AquariumFrame;
  const id = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 32;
  return s.kind === 'water' && ['day', 'night'].includes(s.phase) && percent(s.oxygen) && percent(s.cleanliness) &&
    Array.isArray(s.fish) && s.fish.length <= 12 && s.fish.every(f => f && id(f.id) && ['guppy', 'goldfish', 'perch'].includes(f.species) && grid(f.x, f.y) && percent(f.energy) && percent(f.health) && Number.isFinite(f.ageHours) && f.ageHours >= 0 && (f.lastMeal === undefined || (f.lastMeal && Number.isFinite(f.lastMeal.atMs) && f.lastMeal.atMs <= atMs && ['fish', 'food', 'algae'].includes(f.lastMeal.kind) && id(f.lastMeal.id)))) &&
    Array.isArray(s.plants) && s.plants.length <= 12 && s.plants.every(p => p && id(p.id) && ['waterweed', 'waterlily', 'algae'].includes(p.species) && grid(p.x, p.y) && percent(p.health) && Number.isFinite(p.growthHours) && p.growthHours >= 0 && Number.isInteger(p.stage) && p.stage >= 0 && p.stage <= 3) &&
    Array.isArray(s.food) && s.food.length <= 20 && s.food.every(f => f && id(f.id) && grid(f.x, f.y) && Number.isInteger(f.portions) && f.portions >= 1 && f.portions <= 10 && Number.isFinite(f.droppedAtMs) && f.droppedAtMs <= atMs) &&
    new Set([...s.fish, ...s.plants, ...s.food].map(v => v.id)).size === s.fish.length + s.plants.length + s.food.length && new Set(s.plants.map(p => `${p.x},${p.y}`)).size === s.plants.length;
}
export function validAquarium(value: unknown): value is AquariumState {
  if (!value || typeof value !== 'object') return false;
  const s = value as AquariumState;
  return validCollection(s.collection, 'water') && (s.oxygenWarning === undefined || typeof s.oxygenWarning === 'boolean') && s.version === 1 && Number.isFinite(s.updatedAtMs) && Number.isSafeInteger(s.nextId) && s.nextId >= 1 && (s.name === undefined || (typeof s.name === 'string' && s.name === s.name.trim() && Array.from(s.name).length >= 1 && Array.from(s.name).length <= TERRARIUM_MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f-\u009f]/.test(s.name))) && validFrame({ ...s, phase: 'day' }, s.updatedAtMs) && new Set([...s.fish, ...s.plants, ...s.food, ...(s.collection ?? []).map(e => e.specimen)].map(e => e.id)).size === s.fish.length + s.plants.length + s.food.length + (s.collection?.length ?? 0) &&
    Array.isArray(s.history) && s.history.length <= 168 && s.history.every((h, i) => h && Number.isFinite(h.recordedAtMs) && h.recordedAtMs <= s.updatedAtMs && (i === 0 || h.recordedAtMs > s.history[i - 1].recordedAtMs) && percent(h.oxygen) && percent(h.cleanliness) && validFrame({ kind: 'water', phase: 'day', oxygen: h.oxygen, cleanliness: h.cleanliness, fish: h.fish, plants: [], food: [] }, h.recordedAtMs)) &&
    Array.isArray(s.replays) && s.replays.length <= TERRARIUM_MAX_REPLAYS && new Set(s.replays.map(r => r?.id)).size === s.replays.length && s.replays.every((r, i) => {
      if (!r || typeof r.id !== 'string' || r.id.length > 160 || !Number.isFinite(r.recordedAtMs) || r.recordedAtMs > s.updatedAtMs || (i > 0 && r.recordedAtMs < s.replays[i - 1].recordedAtMs) || !Array.isArray(r.frames) || r.frames.length !== 3 || !r.frames.every(f => validFrame(f, r.recordedAtMs))) return false;
      const [before, contact, after] = r.frames;
      const hunter = contact.fish.find(f => f.id === r.hunterId), prey = contact.fish.find(f => f.id === r.preyId);
      return !!hunter && !!prey && hunter.species === 'perch' && prey.species === 'guppy' && hunter.x === prey.x && hunter.y === prey.y && before.fish.some(f => f.id === hunter.id) && before.fish.some(f => f.id === prey.id) && after.fish.some(f => f.id === hunter.id) && !after.fish.some(f => f.id === prey.id);
    });
}
