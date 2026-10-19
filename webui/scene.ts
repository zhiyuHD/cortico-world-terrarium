import { isFlying } from '../src/flight.ts';
import type { EggState, NestState, LandFood } from '../src/state.ts';
import type { ReplayFrame } from '../src/replay.ts';
import { drawPlantFlowers } from './flowers.ts';
import { createPlaybackControls } from './playback.ts';
import { createNestViewer } from './nest-viewer.ts';
import { drawAntNest } from './nest-scene.ts';
export { createWaterScene, createWaterReplayControls } from './water-scene.ts';
import { daylight, type SoilCell } from '../src/habitat.ts';

export interface SceneState {
  phase: 'day' | 'night';
  soil?: SoilCell[];
  eggs?: EggState[];
  nests?: NestState[];
  food?: LandFood[];
  webs?: import('../src/state.ts').SpiderWeb[];
  plants: Array<{ id: string; species: string; x: number; y: number; moisture: number; growthHours?: number; stage: number; dry: boolean; health: number }>;
  seeds: Array<{ id: string; species: string; x: number; y: number }>;
  bugs: Array<{ id: string; species: string; x: number; y: number; carrying?: number; role?: 'queen' | 'worker'; inside?: import('../src/colony.ts').NestPosition; energy?: number; hunger?: number }>;
  items: Array<{ id: 'coin' | 'pebble'; x: number; y: number }>;
}

export function plotPosition(x: number, y: number): { x: number; y: number } {
  return { x: 260 + x * 70, y: 290 + y * 9 };
}

export function bugPositions(bugs: SceneState['bugs'], positions: ReadonlyMap<string, { x: number; y: number }> = new Map()): Map<string, { x: number; y: number }> {
  const groups = new Map<string, string[]>();
  for (const bug of bugs) {
    const tile = `${bug.x},${bug.y}`;
    const group = groups.get(tile) ?? [];
    group.push(bug.id);
    groups.set(tile, group);
  }
  for (const group of groups.values()) group.sort();
  const result = new Map<string, { x: number; y: number }>();
  for (const bug of bugs) {
    const position = positions.get(bug.id) ?? bug;
    const group = groups.get(`${bug.x},${bug.y}`)!;
    const ordinal = group.indexOf(bug.id);
    const row = Math.floor(ordinal / 3);
    const rowSize = Math.min(3, group.length - row * 3);
    const plot = plotPosition(position.x, position.y);
    result.set(bug.id, { x: plot.x + (ordinal % 3 - (rowSize - 1) / 2) * 28, y: plot.y - 6 + row * 19 });
  }
  return result;
}

export function drawScene(canvas: HTMLCanvasElement, state: SceneState, positions: ReadonlyMap<string, { x: number; y: number }> = new Map(), hits: ReadonlyArray<{ x: number; y: number; strength: number }> = []): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const night = state.phase === 'night';
  const sky = g.createLinearGradient(0, 0, 0, 500);
  sky.addColorStop(0, night ? '#162c47' : '#9ccbcf');
  sky.addColorStop(1, night ? '#657b80' : '#e1e9bd');
  g.fillStyle = sky; g.fillRect(0, 0, 800, 500);
  g.fillStyle = night ? '#e8e7ce' : '#fff1a7';
  g.beginPath(); g.arc(680, 83, night ? 23 : 32, 0, Math.PI * 2); g.fill();
  if (night) {
    g.fillStyle = '#d4e0e5';
    for (const [x, y] of [[65, 67], [151, 111], [307, 68], [460, 89], [570, 49], [741, 151]]) {
      g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
    }
  }
  g.fillStyle = night ? '#415866' : '#91af91';
  g.beginPath(); g.ellipse(400, 453, 350, 32, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = night ? 'rgba(99,136,147,.2)' : 'rgba(236,255,241,.25)';
  g.beginPath(); g.roundRect(105, 125, 590, 285, 32); g.fill();
  g.fillStyle = night ? '#50493e' : '#715438';
  g.beginPath(); g.roundRect(122, 306, 556, 93, [8, 8, 25, 25]); g.fill();
  g.fillStyle = night ? '#756b53' : '#a7875b';
  g.beginPath(); g.ellipse(400, 310, 278, 29, 0, 0, Math.PI * 2); g.fill();

  for (const cell of state.soil ?? []) {
    const { x, y } = plotPosition(cell.x, cell.y);
    g.fillStyle = `rgba(36,91,107,${cell.moisture / 160})`;
    g.beginPath(); g.ellipse(x, y + 1, 30, 5, 0, 0, Math.PI * 2); g.fill();
    if (daylight(state, cell.x, cell.y) < .4) {
      g.fillStyle = 'rgba(20,30,40,.25)';
      g.beginPath(); g.ellipse(x, y, 31, 6, 0, 0, Math.PI * 2); g.fill();
    }
  }
  for (const nest of state.nests ?? []) {
    const { x, y } = plotPosition(nest.x, nest.y);
    drawAntNest(g, x, y, night);
  }
  for (const web of state.webs ?? []) {
    const { x, y } = plotPosition(web.x, web.y);
    g.save(); g.translate(x, y - 38); g.strokeStyle = night ? '#cfdfed9c' : '#fff8e5b8'; g.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(angle) * 28, Math.sin(angle) * 28); g.stroke();
    }
    for (const radius of [9, 18, 27]) {
      g.beginPath();
      for (let i = 0; i <= 8; i++) { const angle = i * Math.PI / 4; const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius; if (!i) g.moveTo(px, py); else g.lineTo(px, py); }
      g.stroke();
    }
    g.restore();
  }
  for (const food of state.food ?? []) {
    const { x, y } = plotPosition(food.x, food.y);
    g.fillStyle = '#e4b66c';
    for (let i = 0; i < Math.min(6, food.portions); i++) { g.beginPath(); g.arc(x - 8 + i % 3 * 6, y + Math.floor(i / 3) * 5, 2.5, 0, Math.PI * 2); g.fill(); }
  }
  for (const [index, egg] of (state.eggs ?? []).filter(egg => !egg.inside).entries()) {
    const { x, y } = plotPosition(egg.x, egg.y);
    g.fillStyle = egg.species === 'ant' ? '#eee2bd' : '#dbd9b0';
    g.beginPath(); g.ellipse(x - 12 + index % 4 * 7, y - 4, 3, 4, -.3, 0, Math.PI * 2); g.fill();
  }
  for (const plant of state.plants) {
    const { x, y: base } = plotPosition(plant.x, plant.y);
    const height = 13 + plant.stage * 20;
    const leaves = 1 + plant.stage * 2;
    g.strokeStyle = plant.dry ? '#87926a' : '#417e4c';
    g.lineWidth = 4 + plant.stage; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, base); g.quadraticCurveTo(x - 8, base - height * .6, x, base - height); g.stroke();
    for (let i = 0; i < leaves; i++) {
      const side = i % 2 ? -1 : 1;
      const y = base - height * (.35 + .6 * i / Math.max(1, leaves - 1));
      g.fillStyle = plant.dry ? '#a4ad77' : i % 2 ? '#64aa6d' : '#7abb77';
      g.beginPath();
      g.ellipse(x + side * (9 + plant.stage * 3), y - 7, 11 + plant.stage * 3, plant.species === 'fern' ? 7 : 11, -side * .45, 0, Math.PI * 2);
      g.fill();
    }
    if (plant.species === 'clover' && plant.stage > 1) {
      g.fillStyle = plant.dry ? '#a4ad77' : '#74b878';
      for (const dx of [-8, 0, 8]) { g.beginPath(); g.arc(x + dx, base - height, 9, 0, Math.PI * 2); g.fill(); }
    }
    drawPlantFlowers(g, plant, x, base - height, night);
  }
  for (const item of state.items) {
    const { x, y } = plotPosition(item.x, item.y);
    g.fillStyle = 'rgba(30,28,23,.25)';
    g.beginPath(); g.ellipse(x, y + 7, 21, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = item.id === 'coin' ? '#d0a34d' : '#919a94';
    g.beginPath(); g.ellipse(x, y, item.id === 'coin' ? 16 : 19, 10, -.1, 0, Math.PI * 2); g.fill();
    if (item.id === 'coin') { g.strokeStyle = '#f4d682'; g.lineWidth = 2; g.stroke(); }
  }
  for (const seed of state.seeds ?? []) {
    const { x, y } = plotPosition(seed.x, seed.y);
    g.fillStyle = '#d9bd75'; g.beginPath(); g.ellipse(x, y, 7, 4, -.3, 0, Math.PI * 2); g.fill();
  }
  const surfaceBugs = state.bugs.filter(bug => !bug.inside);
  const locations = bugPositions(surfaceBugs, positions);
  for (const bug of surfaceBugs) {
    const location = locations.get(bug.id)!;
    const x = location.x, y = location.y - (isFlying(bug.species) ? 30 : 0);
    g.fillStyle = 'rgba(33,28,20,.26)';
    g.beginPath(); g.ellipse(x, y + 9, 14, 4, 0, 0, Math.PI * 2); g.fill();
    if (isFlying(bug.species)) {
      g.fillStyle = bug.species === 'moth' ? '#d9bfa1' : 'rgba(228,246,247,.85)';
      const span = bug.species === 'moth' ? 12 : bug.species === 'mosquito' ? 8 : 7;
      for (const side of [-1, 1]) { g.beginPath(); g.ellipse(x + side * span * .6, y - 3, span, span * .55, side * -.55, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = bug.species === 'fruit_fly' ? '#be8056' : bug.species === 'moth' ? '#8a6851' : '#465357';
      g.beginPath(); g.ellipse(x, y, 3, bug.species === 'mosquito' ? 8 : 6, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#5d5149'; g.lineWidth = 1;
      for (const side of [-1, 1]) { g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + side * 4, y - 11); g.stroke(); }
      if (bug.species === 'moth') {
        g.fillStyle = '#97745c';
        for (const side of [-1, 1]) { g.beginPath(); g.arc(x + side * 9, y - 5, 2.4, 0, Math.PI * 2); g.fill(); }
      }
    } else if (bug.species === 'spider') {
      g.strokeStyle = '#282a36'; g.lineWidth = 2.4;
      for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) {
        g.beginPath(); g.moveTo(x + side * 5, y + i * 3);
        g.lineTo(x + side * 16, y + i * 8); g.stroke();
      }
      g.fillStyle = '#393848'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e3ca9d';
      for (const dx of [-3, 3]) { g.beginPath(); g.arc(x + dx, y - 3, 1.5, 0, Math.PI * 2); g.fill(); }
    } else if (bug.species === 'ant') {
      g.strokeStyle = '#3b2b24'; g.lineWidth = 1.8;
      for (const side of [-1, 1]) for (const dx of [-5, 0, 5]) {
        g.beginPath(); g.moveTo(x + dx, y); g.lineTo(x + dx - 2, y + side * 8); g.stroke();
      }
      g.fillStyle = '#493025';
      for (const [dx, radius] of [[-7, 5], [0, 3], [6, 4]]) { g.beginPath(); g.ellipse(x + dx, y, radius, radius * .75, 0, 0, Math.PI * 2); g.fill(); }
      for (const side of [-1, 1]) { g.beginPath(); g.moveTo(x + 8, y + side * 2); g.lineTo(x + 14, y + side * 6); g.stroke(); }
      if (bug.carrying) { g.fillStyle = '#edc06f'; g.beginPath(); g.arc(x + 13, y, 3, 0, Math.PI * 2); g.fill(); }
    } else if (bug.species === 'beetle') {
      g.fillStyle = '#684337'; g.beginPath(); g.ellipse(x, y, 13, 9, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b57242'; g.beginPath(); g.ellipse(x, y - 2, 11, 7, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#58372f'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x, y + 5); g.stroke();
      g.fillStyle = '#2c2a26'; g.beginPath(); g.arc(x + 10, y + 1, 2, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = '#9bc96c'; g.beginPath(); g.ellipse(x, y, 10, 7, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#608943'; g.lineWidth = 1.4;
      for (const side of [-1, 1]) for (const dx of [-4, 1, 5]) {
        g.beginPath(); g.moveTo(x + dx, y + side * 4); g.lineTo(x + dx + 3, y + side * 10); g.stroke();
      }
      g.fillStyle = '#24352b'; g.beginPath(); g.arc(x + 5, y - 2, 1.5, 0, Math.PI * 2); g.fill();
    }
  }
  for (const hit of hits) {
    const { x, y } = plotPosition(hit.x, hit.y);
    g.strokeStyle = `rgba(255,210,91,${hit.strength})`; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      g.beginPath(); g.moveTo(x + Math.cos(angle) * 8, y + Math.sin(angle) * 8);
      g.lineTo(x + Math.cos(angle) * (13 + 12 * (1 - hit.strength)), y + Math.sin(angle) * (13 + 12 * (1 - hit.strength))); g.stroke();
    }
  }
  g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 12; g.lineCap = 'round';
  g.beginPath(); g.moveTo(142, 160); g.lineTo(142, 280); g.moveTo(168, 151); g.lineTo(168, 222); g.stroke();
  g.strokeStyle = night ? '#a7c1c7' : '#eff8ea'; g.lineWidth = 9;
  g.beginPath(); g.roundRect(105, 125, 590, 285, 32); g.stroke();
  g.fillStyle = night ? '#40555a' : '#72906f';
  g.beginPath(); g.roundRect(160, 400, 480, 20, 10); g.fill();
}

export function createLandRenderer(canvas: HTMLCanvasElement): { setState(state: SceneState): void; dispose(): void } {
  let state: SceneState | null = null;
  let previous = new Map<string, { x: number; y: number }>();
  let movedAt = 0;
  let hitAt = 0;
  let hits: Array<{ x: number; y: number }> = [];
  let frame = 0;
  let disposed = false;
  const currentPositions = (now: number): Map<string, { x: number; y: number }> => {
    return new Map((state?.bugs ?? []).map(bug => {
      const old = previous.get(bug.id) ?? bug;
      const t = Math.min(1, (now - movedAt) / (bug.species === 'ant' ? 350 : 900));
      return [bug.id, { x: old.x + (bug.x - old.x) * t, y: old.y + (bug.y - old.y) * t }] as const;
    }));
  };
  const render = (now: number): void => {
    if (disposed || !state) return;
    drawScene(canvas, state, currentPositions(now), hits.map(hit => ({ ...hit, strength: Math.max(0, 1 - (now - hitAt) / 900) })));
    frame = requestAnimationFrame(render);
  };
  return {
    setState(next) {
      if (disposed) return;
      const now = performance.now();
      const removed = state ? state.bugs.filter(bug => !next.bugs.some(current => current.id === bug.id) && next.bugs.some(hunter =>
        hunter.x === bug.x && hunter.y === bug.y && (hunter.species === 'spider' ? bug.species !== 'spider' : hunter.species === 'beetle' && bug.species === 'aphid')))
        .map(bug => ({ x: bug.x, y: bug.y })) : [];
      if (removed.length) { hits = removed; hitAt = now; }
      const oldPositions = currentPositions(now);
      const moved = next.bugs.some(bug => {
        const old = state?.bugs.find(current => current.id === bug.id);
        return old && (old.x !== bug.x || old.y !== bug.y);
      });
      if (moved) { previous = oldPositions; movedAt = now; }
      state = next;
      if (!frame) frame = requestAnimationFrame(render);
    },
    dispose() { disposed = true; cancelAnimationFrame(frame); },
  };
}


export function createScene(canvas: HTMLCanvasElement, language: 'zh' | 'en' = 'zh') {
  const renderer = createLandRenderer(canvas);
  const viewer = createNestViewer(canvas, language);
  return {
    setState(state: SceneState, recordedAtMs?: number) { renderer.setState(state); viewer.setState(state, recordedAtMs); },
    dispose() { viewer.dispose(); renderer.dispose(); },
  };
}

export function createReplayControls(container: HTMLElement, language: 'zh' | 'en' = 'zh') {
  return createPlaybackControls<ReplayFrame>(container, canvas => createScene(canvas, language), language);
}

export { createPublicSelect, createPublicReplayControls } from './public-controls.ts';
