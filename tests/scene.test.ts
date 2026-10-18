import { afterEach, expect, it, vi } from 'vitest';
import { bugPositions, createLandRenderer as createScene, plotPosition, type SceneState } from '../webui/scene.ts';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('places distinct bugs on the soil surface, including bugs sharing a cell', () => {
  const bugs = [
    { id: 'aphid-2', species: 'aphid', x: 2, y: 3 },
    { id: 'beetle-1', species: 'beetle', x: 2, y: 3 },
  ];
  const positions = bugPositions(bugs);
  expect(positions.get('aphid-2')).toEqual({ x: plotPosition(2, 3).x - 14, y: plotPosition(2, 3).y - 6 });
  expect(positions.get('beetle-1')).toEqual({ x: plotPosition(2, 3).x + 14, y: plotPosition(2, 3).y - 6 });
  expect(bugPositions([...bugs].reverse())).toEqual(positions);
});

it('finishes a bug move when an unchanged report arrives during animation', () => {
  let now = 0;
  let render: FrameRequestCallback | undefined;
  const beetleCenters: number[] = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { render = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const gradient = { addColorStop() {} };
  const context = {
    createLinearGradient: () => gradient, fillRect() {}, beginPath() {}, arc() {}, fill() {},
    roundRect() {}, moveTo() {}, lineTo() {}, stroke() {}, quadraticCurveTo() {},
    ellipse(x: number, _y: number, radiusX: number, radiusY: number) {
      if (radiusX === 13 && radiusY === 9) beetleCenters.push(x);
    },
  };
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const state = (x: number): SceneState => ({
    phase: 'day', plants: [], seeds: [], items: [], bugs: [{ id: 'bug-1', species: 'beetle', x, y: 2 }],
  });
  const scene = createScene(canvas);
  scene.setState(state(1));
  render!(0);
  now = 100; scene.setState(state(2));
  render!(550);
  now = 600; scene.setState(state(2));
  render!(1000);
  expect(beetleCenters).toEqual([plotPosition(1, 2).x, (plotPosition(1, 2).x + plotPosition(2, 2).x) / 2, plotPosition(2, 2).x]);
  scene.dispose();
});
