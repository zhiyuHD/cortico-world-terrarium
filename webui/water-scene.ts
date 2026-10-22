import { aquaticFlower } from '../src/aquatic-habitat.ts';
import { capacity } from '../src/progression.ts';
import type { AquariumFrame } from '../src/aquarium.ts';
import { createWaterScene as createRenderer } from 'terrarium-renderer';
import { createPlaybackControls } from './playback.ts';
export function createWaterScene(canvas: HTMLCanvasElement) {
  const renderer = createRenderer(canvas);
  return { setState(state: AquariumFrame) { renderer.setState({ phase: state.phase, gridSize: capacity(state).size, facilities: state.facilities, oxygen: state.oxygen, cleanliness: state.cleanliness, plants: state.plants.map(p => ({ ...p, flower: aquaticFlower(p) })), fish: state.fish, food: state.food }); }, dispose() { renderer.dispose(); } };
}
export function createWaterReplayControls(container: HTMLElement, language: 'zh' | 'en' = 'zh') { return createPlaybackControls<AquariumFrame>(container, createWaterScene, language); }
