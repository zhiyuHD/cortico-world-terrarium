import { capacity, type DevelopmentState } from '../src/progression.ts';
import { daylight, flowerStage, hasSeedHead, type SoilCell } from '../src/habitat.ts';
import { isFlying } from '../src/flight.ts';
import type { EggState, NestState, LandFood } from '../src/state.ts';
import type { ReplayFrame } from '../src/replay.ts';
import { createScene as createRenderer, createLandRenderer as createLand, drawScene as drawLand, bugPositions } from 'terrarium-renderer';
import { createPlaybackControls } from './playback.ts';
export { plotPosition } from 'terrarium-renderer';
export { bugPositions };
export { createWaterScene, createWaterReplayControls } from './water-scene.ts';
export { createPublicSelect, createPublicReplayControls } from './public-controls.ts';

export interface SceneState extends DevelopmentState {
  phase: 'day' | 'night'; soil?: SoilCell[]; eggs?: EggState[]; nests?: NestState[]; food?: LandFood[];
  webs?: import('../src/state.ts').SpiderWeb[];
  plants: Array<{ id: string; species: string; x: number; y: number; moisture: number; growthHours?: number; stage: number; dry: boolean; health: number; leafDamage?: number }>;
  seeds: Array<{ id: string; species: string; x: number; y: number }>;
  bugs: Array<{ id: string; species: string; x: number; y: number; carrying?: number; role?: 'queen' | 'worker'; inside?: import('../src/colony.ts').NestPosition; energy?: number; hunger?: number }>;
  items: Array<{ id: 'coin' | 'pebble'; x: number; y: number }>;
}
export function landScene(state: SceneState) {
  return { phase: state.phase, gridSize: capacity(state).size, facilities: state.facilities, eggs: state.eggs, nests: state.nests?.map(n => ({ ...n, foodCapacity: n.depth * 20 })), food: state.food, webs: state.webs, seeds: state.seeds, items: state.items, soil: state.soil?.map(cell => ({ ...cell, daylight: daylight(state, cell.x, cell.y) })), plants: state.plants.map(p => ({ ...p, flower: flowerStage(p), seedHead: hasSeedHead(p) })), bugs: state.bugs.map(b => ({ ...b, flying: isFlying(b.species) })) };
}
export function drawScene(canvas: HTMLCanvasElement, state: SceneState, positions?: ReadonlyMap<string, { x: number; y: number }>, hits?: ReadonlyArray<{ x: number; y: number; strength: number }>): void { drawLand(canvas, landScene(state), positions, hits); }
export function createLandRenderer(canvas: HTMLCanvasElement) {
  const renderer = createLand(canvas);
  return { setState(state: SceneState) { renderer.setState(landScene(state)); }, dispose() { renderer.dispose(); } };
}
export function createScene(canvas: HTMLCanvasElement, language: 'zh' | 'en' = 'zh') {
  const renderer = createRenderer(canvas, language);
  return { setState(state: SceneState, recordedAtMs?: number) { renderer.setState(landScene(state), recordedAtMs); }, dispose() { renderer.dispose(); } };
}
export function createReplayControls(container: HTMLElement, language: 'zh' | 'en' = 'zh') { return createPlaybackControls<ReplayFrame>(container, canvas => createScene(canvas, language), language); }
