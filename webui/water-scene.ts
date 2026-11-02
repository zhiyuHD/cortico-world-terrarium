import { aquaticFlower } from '../src/aquatic-habitat.ts';
import { capacity } from '../src/progression.ts';
import type { AquariumFrame } from '../src/aquarium.ts';
import { createWaterScene as createRenderer, renderWaterFrame } from 'terrarium-renderer';
import { createPlaybackControls } from './playback.ts';
export function createWaterScene(canvas: HTMLCanvasElement) {
  const renderer = createRenderer(canvas), handle: { painted: boolean; error?: string; setState(state: AquariumFrame): void; dispose(): void } = {
    painted: false,
    setState(state) {
      const frame = { phase: state.phase, gridSize: capacity(state).size, facilities: state.facilities, oxygen: state.oxygen, cleanliness: state.cleanliness, plants: state.plants.map(p => ({ ...p, flower: aquaticFlower(p) })), fish: state.fish, eggs: state.eggs, food: state.food };
      try { renderer.setState(frame); if (!handle.painted) renderWaterFrame(canvas, frame); handle.painted = true; handle.error = undefined; }
      catch (error) { handle.error = error instanceof Error ? error.message : String(error); }
    },
    dispose() { renderer.dispose(); },
  };
  return handle;
}
export function createWaterReplayControls(container: HTMLElement, language: 'zh' | 'en' = 'zh') { return createPlaybackControls<AquariumFrame>(container, createWaterScene, language); }
