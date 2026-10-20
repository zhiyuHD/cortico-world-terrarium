import type { HistorySample } from '../src/habitat.ts';

export interface HistoryPoint { recordedAtMs: number; value: number | null }

export function drawScoreHistory(samples: { recordedAtMs: number; score: number | null }[], zh: boolean, language: string): HTMLElement {
  const el = document.createElement('div'), title = document.createElement('h3');
  title.textContent = zh ? '自己的分数 · 最近 24 小时（本地模拟）' : 'Your score · Last 24 hours (local simulation)';
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 800 205'); svg.classList.add('terrarium-history'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', title.textContent);
  const add = (tag: string, attrs: Record<string, string>, text?: string) => { const node = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); if (text !== undefined) node.textContent = text; svg.append(node); };
  const maximum = Math.max(10, ...samples.map(s => s.score ?? 0));
  for (const value of [0, maximum / 2, maximum]) {
    const y = String(164 - value / maximum * 140);
    add('line', { x1: '44', x2: '740', y1: y, y2: y, stroke: 'currentColor', opacity: '.15' });
    add('text', { x: '36', y, 'text-anchor': 'end', fill: 'currentColor', 'font-size': '12' }, value.toFixed(0));
  }
  for (const d of historyPaths(samples.map(s => ({ recordedAtMs: s.recordedAtMs, value: s.score })), maximum)) add('path', { d, fill: 'none', stroke: '#398db0', 'stroke-width': '2.5' });
  if (samples.filter(s => s.score !== null).length < 2) add('text', { x: '400', y: '90', 'text-anchor': 'middle', fill: 'currentColor' }, zh ? '等待新的小时样本；旧记录或旧公式分数留空。' : 'Waiting for hourly samples; older or previous-formula scores remain blank.');
  for (const [sample, x, anchor] of [[samples[0], '44', 'start'], [samples.at(-1), '740', 'end']] as const) if (sample) add('text', { x, y: '190', 'text-anchor': anchor, fill: 'currentColor', 'font-size': '12' }, new Date(sample.recordedAtMs).toLocaleString(language));
  el.append(title, svg); return el;
}

/** Missing organisms interrupt a line rather than connecting across their absence. */
export function historyPaths(points: HistoryPoint[], maxValue: number): string[] {
  const first = points[0]?.recordedAtMs ?? 0;
  const duration = Math.max(1, (points.at(-1)?.recordedAtMs ?? first) - first);
  const paths: string[] = [];
  let path = '';
  for (const point of points) {
    if (point.value === null) {
      if (path) paths.push(path);
      path = '';
    } else {
      const x = 44 + (point.recordedAtMs - first) / duration * 696;
      const y = 164 - point.value / maxValue * 140;
      path += `${path ? ' L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }
  }
  if (path) paths.push(path);
  return paths;
}

export function drawHistory(history: HistorySample[], selected: string, labels: { moisture: string; health: string; stage: string; empty: string }, language: string, gridSize = 5): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 800 232');
  svg.setAttribute('role', 'img');
  svg.classList.add('terrarium-history');
  const add = (tag: string, attrs: Record<string, string>, text?: string): SVGElement => {
    const node = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  add('title', {}, `${selected}: ${labels.moisture}, ${labels.health}, ${labels.stage}`);
  for (const value of [0, 50, 100]) {
    const y = String(164 - value * 1.4);
    add('line', { x1: '44', x2: '740', y1: y, y2: y, stroke: 'currentColor', opacity: '.15' });
    add('text', { x: '36', y, 'text-anchor': 'end', fill: 'currentColor', 'font-size': '12' }, String(value));
  }
  const soil = selected.startsWith('soil:');
  const series = soil ? [{ label: labels.moisture, color: '#398db0', field: 'moisture', max: 100 }] : [
    { label: labels.moisture, color: '#398db0', field: 'moisture', max: 100 },
    { label: labels.health, color: '#44894c', field: 'health', max: 100 },
    { label: `${labels.stage} (0–3)`, color: '#ac772c', field: 'stage', max: 3 },
  ];
  if (history.length < 2) add('text', { x: '400', y: '96', 'text-anchor': 'middle', fill: 'currentColor' }, labels.empty);
  for (const [i, line] of series.entries()) {
    const points = history.map(sample => {
      const plant = sample.plants.find(plant => plant.id === selected);
      const value = soil ? (Math.floor(Number(selected.slice(5)) / gridSize) < (sample.gridSize ?? 5) && Number(selected.slice(5)) % gridSize < (sample.gridSize ?? 5) ? sample.soilMoisture[Math.floor(Number(selected.slice(5)) / gridSize) * (sample.gridSize ?? 5) + Number(selected.slice(5)) % gridSize] : null) : plant?.[line.field as 'moisture' | 'health' | 'stage'];
      return { recordedAtMs: sample.recordedAtMs, value: value ?? null };
    });
    for (const d of historyPaths(points, line.max)) add('path', { d, fill: 'none', stroke: line.color, 'stroke-width': '2.5' });
    add('text', { x: String(44 + i * 220), y: '222', fill: line.color, 'font-size': '14' }, line.label);
  }
  for (const [sample, x, anchor] of [[history[0], '44', 'start'], [history.at(-1), '740', 'end']] as const) {
    if (sample) add('text', { x, y: '190', 'text-anchor': anchor, fill: 'currentColor', 'font-size': '12' }, new Date(sample.recordedAtMs).toLocaleString(language));
  }
  return svg;
}
