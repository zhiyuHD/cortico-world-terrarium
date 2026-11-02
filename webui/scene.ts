import { cropRounds } from '../src/garden.ts';
import { capacity, type DevelopmentState } from '../src/progression.ts';
import { daylight, flowerStage, hasSeedHead, type SoilCell } from '../src/habitat.ts';
import { isFlying } from '../src/flight.ts';
import type { EggState, NestState, LandFood } from '../src/state.ts';
import type { ReplayFrame } from '../src/replay.ts';
import { createScene as createRenderer, createLandRenderer as createLand, drawScene as drawLand, bugPositions, renderLandFrame } from 'terrarium-renderer';
import { createPlaybackControls } from './playback.ts';
export { plotPosition } from 'terrarium-renderer';
export { bugPositions };
export { createWaterScene, createWaterReplayControls } from './water-scene.ts';
export { createPublicSelect, createPublicReplayControls } from './public-controls.ts';

export interface SceneState extends DevelopmentState {
  decorations?: import('../src/garden.ts').GardenState['decorations'];
  litter?: import('../src/garden.ts').GardenState['litter'];
  economy?: import('../src/merchant.ts').Economy;
  phase: 'day' | 'night'; soil?: SoilCell[]; eggs?: EggState[]; nests?: NestState[]; food?: LandFood[];
  webs?: import('../src/state.ts').SpiderWeb[];
  plants: Array<{ id: string; species: string; x: number; y: number; moisture: number; growthHours?: number; stage: number; dry: boolean; health: number; leafDamage?: number; pollination?: number; fruitGrowthHours?: number; harvestRounds?: number }>;
  seeds: Array<{ id: string; species: string; x: number; y: number }>;
  bugs: Array<{ id: string; species: string; x: number; y: number; carrying?: number; role?: 'queen' | 'worker'; inside?: import('../src/colony.ts').NestPosition; energy?: number; hunger?: number }>;
  items: Array<{ id: 'coin' | 'pebble'; x: number; y: number }>;
}
export function landScene(state: SceneState) {
  return { decorations: state.decorations, litter: state.litter, economy: state.economy ? { pots: state.economy.pots } : undefined, phase: state.phase, gridSize: capacity(state).size, facilities: state.facilities, eggs: state.eggs, nests: state.nests?.map(n => ({ ...n, foodCapacity: n.depth * 20 })), food: state.food, webs: state.webs, seeds: state.seeds, items: state.items, soil: state.soil?.map(cell => ({ ...cell, daylight: daylight(state, cell.x, cell.y) })), plants: state.plants.map(p => ({ ...p, fruitReady: cropRounds(p as import('../src/state.ts').PlantState) > (p.harvestRounds ?? 0), flower: flowerStage(p), seedHead: hasSeedHead(p) })), bugs: state.bugs.map(b => ({ ...b, flying: isFlying(b.species) })) };
}
export function drawScene(canvas: HTMLCanvasElement, state: SceneState, positions?: ReadonlyMap<string, { x: number; y: number }>, hits?: ReadonlyArray<{ x: number; y: number; strength: number }>): void { drawLand(canvas, landScene(state), positions, hits); }
export interface SceneHandle {
  /** True once a frame reached the canvas, so a panel can tell a blank canvas from a slow one. */
  painted: boolean;
  /** Last drawing error; the panel shows it instead of leaving the canvas blank. */
  error?: string;
  setState(state: SceneState, recordedAtMs?: number): void;
  dispose(): void;
}

/** Reporting a canvas that was never given a 2D context separates a broken canvas from a drawing bug. */
export function canvasProblem(canvas: HTMLCanvasElement): string | undefined {
  if (!canvas.getContext('2d')) return 'Canvas has no 2D context';
  const box = canvas.getBoundingClientRect?.();
  if (box && (box.width === 0 || box.height === 0)) return `Canvas is ${box.width}×${box.height} CSS pixels`;
}

function paint(handle: SceneHandle, canvas: HTMLCanvasElement, draw: () => void, firstPaint?: () => void): void {
  try {
    draw();
    if (!handle.painted && firstPaint) firstPaint();
    handle.painted = true;
    handle.error = undefined;
  } catch (error) {
    handle.error = error instanceof Error ? error.message : String(error);
  }
}

export function createLandRenderer(canvas: HTMLCanvasElement): SceneHandle {
  const renderer = createLand(canvas), handle: SceneHandle = {
    painted: false,
    setState(state) {
      const scene = landScene(state);
      paint(handle, canvas, () => renderer.setState(scene), () => renderLandFrame(canvas, scene));
    },
    dispose() { renderer.dispose(); },
  };
  return handle;
}
export function createScene(canvas: HTMLCanvasElement, language: 'zh' | 'en' = 'zh'): SceneHandle {
  const renderer = createRenderer(canvas, language), handle: SceneHandle = {
    painted: false,
    setState(state, recordedAtMs) {
      const scene = landScene(state);
      paint(handle, canvas, () => renderer.setState(scene, recordedAtMs), () => renderLandFrame(canvas, scene));
    },
    dispose() { renderer.dispose(); },
  };
  return handle;
}
export function createReplayControls(container: HTMLElement, language: 'zh' | 'en' = 'zh') { return createPlaybackControls<ReplayFrame>(container, canvas => createScene(canvas, language), language); }
