import { capacity } from '../src/progression.ts';
import type { AquariumFrame } from '../src/aquarium.ts';
import { createPlaybackControls } from './playback.ts';

export function createWaterScene(canvas: HTMLCanvasElement) {
  let state: AquariumFrame | undefined;
  let old = new Map<string, { x: number; y: number }>();
  let movedAt = 0;
  let request = 0;
  let disposed = false;
  const position = (x: number, y: number) => ({ x: 110 + x * 580 / (capacity(state ?? {}).size - 1), y: 120 + y * 280 / (capacity(state ?? {}).size - 1) });
  const locations = (now: number) => new Map((state?.fish ?? []).map(fish => {
    const previous = old.get(fish.id) ?? fish;
    const t = Math.min(1, (now - movedAt) / 900);
    return [fish.id, { x: previous.x + (fish.x - previous.x) * t, y: previous.y + (fish.y - previous.y) * t }];
  }));
  const render = (now: number): void => {
    if (disposed || !state) return;
    const g = canvas.getContext('2d');
    if (g) {
      const night = state.phase === 'night';
      g.fillStyle = night ? '#102e4b' : '#cbe9f1'; g.fillRect(0, 0, 800, 500);
      const water = g.createLinearGradient(0, 70, 0, 470); water.addColorStop(0, night ? '#174762' : '#71c6db'); water.addColorStop(1, night ? '#153540' : '#4193ac');
      g.fillStyle = water; g.beginPath(); g.roundRect(60, 70, 680, 400, 20); g.fill();
      g.strokeStyle = '#d6f3ed'; g.lineWidth = 7; g.stroke();
      g.fillStyle = '#b8a789'; g.fillRect(66, 435, 668, 27);
      g.font = '16px system-ui'; g.fillStyle = night ? '#def5fa' : '#164257';
      g.fillText(`O₂ ${state.oxygen.toFixed(1)} · ${state.cleanliness.toFixed(1)} / 100`, 72, 42);
      g.lineWidth = 1; g.strokeStyle = '#ffffff25';
      for (let x = 0; x < capacity(state).size; x++) for (let y = 0; y < capacity(state).size; y++) { const p = position(x, y); g.strokeRect(p.x - 290 / capacity(state).size, p.y - 140 / capacity(state).size, 580 / capacity(state).size, 280 / capacity(state).size); }
      for (const plant of state.plants) {
        const p = position(plant.x, plant.y), h = 22 + plant.stage * 9;
        g.strokeStyle = plant.species === 'algae' ? '#506f37' : '#236e46'; g.lineWidth = 5;
        for (let strand = -1; strand <= 1; strand++) { g.beginPath(); g.moveTo(p.x + strand * 10, p.y + 22); g.quadraticCurveTo(p.x + strand * 18 + Math.sin(now / 1000) * 2, p.y, p.x + strand * 12, p.y + 22 - h); g.stroke(); }
        if (plant.species === 'waterlily') { g.fillStyle = '#e7b8cf'; g.beginPath(); g.ellipse(p.x, p.y - h + 22, 13, 6, 0, 0, Math.PI * 2); g.fill(); }
      }
      for (const food of state.food) { const p = position(food.x, food.y); g.fillStyle = '#f4ca77'; for (let i = 0; i < food.portions; i++) { g.beginPath(); g.arc(p.x + (i % 4) * 5 - 8, p.y + Math.floor(i / 4) * 5, 2, 0, Math.PI * 2); g.fill(); } }
      for (const facility of state.facilities ?? []) {
        const p = position(facility.x, facility.y); g.save(); g.globalAlpha = facility.enabled ? 1 : .35;
        if (facility.kind === 'air_stone') {
          g.fillStyle = '#769cad'; g.beginPath(); g.ellipse(p.x, p.y + 12, 15, 7, 0, 0, Math.PI * 2); g.fill();
          if (facility.enabled) for (let i = 0; i < 5; i++) { const rise = (now / 35 + i * 18) % 90; g.strokeStyle = '#d4f8ff99'; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x + Math.sin(i + now / 1200) * 9, p.y - rise, 2 + i % 3, 0, Math.PI * 2); g.stroke(); }
        } else if (facility.kind === 'filter') {
          g.fillStyle = '#547e82'; g.beginPath(); g.roundRect(p.x - 12, p.y - 35, 24, 46, 6); g.fill();
          g.strokeStyle = '#b4e9db'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(p.x - 7, p.y - 24 + i * 8); g.lineTo(p.x + 7, p.y - 24 + i * 8); g.stroke(); }
        } else if (facility.kind === 'water_light') {
          g.fillStyle = night ? '#7d8580' : '#f9e6a4'; g.beginPath(); g.roundRect(p.x - 23, p.y - 45, 46, 8, 4); g.fill();
          if (!night && facility.enabled) { g.fillStyle = '#ffffba25'; g.beginPath(); g.moveTo(p.x - 18, p.y - 37); g.lineTo(p.x + 30, p.y + 20); g.lineTo(p.x - 30, p.y + 20); g.closePath(); g.fill(); }
        }
        g.restore();
      }
      const points = locations(now);
      for (const fish of state.fish) {
        const p = position(points.get(fish.id)!.x, points.get(fish.id)!.y);
        const companions = state.fish.filter(other => other.x === fish.x && other.y === fish.y).map(other => other.id).sort();
        p.y += (companions.indexOf(fish.id) - (companions.length - 1) / 2) * 15;
        g.fillStyle = fish.species === 'goldfish' ? '#f3a545' : fish.species === 'perch' ? '#718f78' : '#b9b3e5';
        g.beginPath(); g.moveTo(p.x - 15, p.y); g.lineTo(p.x - 30, p.y - 12); g.lineTo(p.x - 30, p.y + 12); g.closePath(); g.fill();
        g.beginPath(); g.ellipse(p.x, p.y, fish.species === 'perch' ? 24 : 18, 11, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#172e38'; g.beginPath(); g.arc(p.x + 10, p.y - 3, 2, 0, Math.PI * 2); g.fill();
      }
    }
    request = requestAnimationFrame(render);
  };
  return {
    setState(next: AquariumFrame) {
      if (disposed) return;
      const now = performance.now();
      const current = locations(now);
      if (next.fish.some(fish => { const previous = state?.fish.find(other => other.id === fish.id); return previous && (previous.x !== fish.x || previous.y !== fish.y); })) { old = current; movedAt = now; }
      state = next;
      if (!request) request = requestAnimationFrame(render);
    },
    dispose() { disposed = true; cancelAnimationFrame(request); },
  };
}
export function createWaterReplayControls(container: HTMLElement, language: 'zh' | 'en' = 'zh') {
  return createPlaybackControls<AquariumFrame>(container, createWaterScene, language);
}
