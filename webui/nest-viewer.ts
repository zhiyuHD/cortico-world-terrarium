import { createNestViewer as createViewer } from 'terrarium-renderer';
import { landScene, type SceneState } from './scene.ts';
export function createNestViewer(canvas: HTMLCanvasElement, language: 'zh' | 'en' = 'zh') {
  const viewer = createViewer(canvas, language);
  return { setState(state: SceneState, atMs?: number) { viewer.setState(landScene(state), atMs); }, dispose() { viewer.dispose(); } };
}
