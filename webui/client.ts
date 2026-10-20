import { createDeathHistory } from './deaths.ts';
import { careText, returnReportText, createCareControls } from './care.ts';
import type { ReturnReport } from '../src/return-report.ts';
import type { landCare } from '../src/care.ts';
import type { TerrariumState } from '../src/state.ts';
import { createWateringControls } from './watering.ts';
import { createFeedbackControls } from './feedback.ts';
import { createSyncControls } from './sync.ts';
import type { TerrariumSyncStatus } from '../src/leaderboard.ts';
import { mountWater } from './water-client.ts';
import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { pick } from 'cortico/core/language.ts';
import { createScene, createReplayControls, type SceneState } from './scene.ts';
import { flowerStage, daylight, TERRARIUM_PLANT_LOW_HEALTH, TERRARIUM_PLANT_REQUIREMENTS, type PlantSpecies } from '../src/habitat.ts';
import { drawHistory, drawScoreHistory } from './history.ts';
import './style.css';

function mount(ctx: WebUiPanelContext): void {
  const copy = pick(ctx.language, {
    zh: { loading: '读取中', refresh: '刷新', day: '白天', night: '夜晚', fern: '蕨草', clover: '三叶草', stage: '阶段', moisture: '水分', dry: '土壤变干', scene: '的生态箱', seed: '种子', bug: '虫子', egg: '卵', nest: '蚁巢', food: '储粮', depth: '层', light: '当前光照', soil: '土壤水分', history: '小时历史 · 最近七天', health: '健康', empty: '等待第二个小时样本', needs: '生长条件（水分 / 白天光照）', plot: '格子', critical: '濒危', bud: '花苞', bloom: '开花', energy: '能量', hunger: '饥饿' },
    en: { loading: 'Loading', refresh: 'Refresh', day: 'Day', night: 'Night', fern: 'Fern', clover: 'Clover', stage: 'stage', moisture: 'moisture', dry: 'dry soil', scene: ' terrarium', seed: 'seeds', bug: 'bugs', egg: 'eggs', nest: 'ant nest', food: 'stored food', depth: 'levels', light: 'Current light', soil: 'Soil moisture', history: 'Hourly history · Last seven days', health: 'Health', empty: 'Waiting for a second hourly sample', needs: 'Growth conditions (moisture / daylight)', plot: 'Cell', critical: 'Critical', bud: 'Budding', bloom: 'Blooming', energy: 'Energy', hunger: 'Hunger' },
  });
  const card = ctx.ui.sheet({ title: '生态箱·地', en: 'Terrarium · Land' });
  const name = ctx.ui.h('h2', '');
  const status = ctx.ui.msgline(copy.loading);
  const canvas = document.createElement('canvas');
  canvas.className = 'terrarium-scene';
  canvas.width = 800; canvas.height = 500;
  canvas.setAttribute('role', 'img');
  const scene = createScene(canvas, ctx.language.startsWith('zh') ? 'zh' : 'en');
  const replayContainer = ctx.ui.h('div', 'terrarium-replays');
  const replay = createReplayControls(replayContainer, ctx.language === 'zh' ? 'zh' : 'en');
  ctx.signal.addEventListener('abort', () => replay.dispose(), { once: true });
  ctx.signal.addEventListener('abort', () => scene.dispose(), { once: true });
  const details = ctx.ui.h('div', 'terrarium-details');
  const deathHistory = createDeathHistory(ctx);
  const diagnosis = ctx.ui.h('div', 'terrarium-details');
  const careControls = createCareControls(ctx, 'land', () => load());
  const sync = createSyncControls(ctx, () => load());
  const refresh = ctx.ui.button(copy.refresh, { size: 'sm', onClick: () => { void load(); } });
  const habitat = ctx.ui.h('div', 'terrarium-habitat');
  const grid = ctx.ui.h('div', 'terrarium-grid');
  const cellStatus = ctx.ui.h('div', 'terrarium-cell-status');
  const requirements = ctx.ui.h('div', 'terrarium-requirements');
  const watering = createWateringControls(ctx, () => load());
  habitat.append(grid, cellStatus, watering.el, requirements);
  const historyTitle = ctx.ui.h('h3', '', copy.history);
  const select = document.createElement('select');
  select.className = 'terrarium-select';
  select.setAttribute('aria-label', copy.history);
  const chart = ctx.ui.h('div', '');
  const scoreChart = ctx.ui.h('div', '');
  let selected = 'soil:0';
  let current: (SceneState & TerrariumState) | undefined;
  const renderHistory = (): void => {
    if (!current) return;
    const plant = current.plants.find(plant => plant.id === selected);
    const index = selected.startsWith('soil:') ? Number(selected.slice(5)) : plant ? plant.y * 5 + plant.x : -1;
    const cell = current.soil[index];
    watering.update(true, cell, current);
    careControls.update(current, cell);
    cellStatus.textContent = cell ? `(${cell.x},${cell.y}) · ${copy.moisture} ${cell.moisture.toFixed(1)} · ${copy.light} ${(current.phase === 'day' ? daylight(current, cell.x, cell.y) : 0).toFixed(2)}` : '';
    grid.querySelectorAll('button').forEach((button, i) => { button.setAttribute('aria-pressed', String(i === index)); });
    chart.replaceChildren(drawHistory(current.history, selected, copy, ctx.language));
  };
  select.addEventListener('change', () => { selected = select.value; renderHistory(); });
  card.body.append(name, status, sync.el, canvas, replayContainer, details, diagnosis, deathHistory.el, habitat, careControls.el, historyTitle, select, chart, scoreChart, refresh, createFeedbackControls(ctx));
  ctx.root.appendChild(card.el);
  const load = async (): Promise<void> => {
    try {
      const response = await ctx.invoke<{ sync: TerrariumSyncStatus; claimed: boolean; id?: string; state?: SceneState & TerrariumState & { care: ReturnType<typeof landCare>; returnReport?: ReturnReport; scoreHistory: { recordedAtMs: number; score: number | null }[] } }>('state');
      if (ctx.signal.aborted) return;
      sync.update(response.sync, response.claimed);
      watering.update(response.claimed);
      const state = response.state;
      for (const el of [canvas, replayContainer, details, diagnosis, deathHistory.el, habitat, careControls.el, historyTitle, select, chart, scoreChart]) el.hidden = !response.claimed;
      if (!response.claimed || !state) { status.textContent = pick(ctx.language, { zh: '未认领 · 先通过 terrarium_claim 认领地箱，再检查每格水分和光照后播种。', en: 'Unclaimed · Use terrarium_claim, inspect moisture and light, then sow.' }); return; }
      if (ctx.signal.aborted) return;
      name.textContent = state.name ?? pick(ctx.language, { zh: '生态箱', en: 'Terrarium' });
      status.textContent = `${state.phase === 'day' ? copy.day : copy.night}${response.id ? ` · ID ${response.id}` : ''}`;
      canvas.setAttribute('aria-label', `${name.textContent} · ${status.textContent}${copy.scene}: ${state.plants.length} plants, ${state.seeds?.length ?? 0} ${copy.seed}, ${state.bugs?.length ?? 0} ${copy.bug}`);
      scene.setState(state);
      replay.setReplays(state.replays ?? []);
      current = state;
      deathHistory.update(state.deaths);
      scoreChart.replaceChildren(drawScoreHistory(state.scoreHistory, ctx.language.startsWith('zh'), ctx.language));
      diagnosis.replaceChildren(...[...returnReportText(state.returnReport, ctx.language.startsWith('zh')), ...careText(state.care, ctx.language.startsWith('zh'))].map(text => ctx.ui.h('div', '', text)));
      const cells = state.soil.map((cell, index) => {
        const light = state.phase === 'day' ? daylight(state, cell.x, cell.y) : 0;
        const label = `(${cell.x},${cell.y}) · ${copy.moisture} ${cell.moisture.toFixed(1)} · ${copy.light} ${light.toFixed(2)}`;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'terrarium-cell';
        button.style.setProperty('--terrarium-dark-moisture', `${28 - cell.moisture * .14}%`);
        button.style.backgroundColor = `hsl(195 35% ${85 - cell.moisture * .45}%)`;
        button.style.color = cell.moisture > 65 ? '#fff' : '#18313b';
        button.textContent = `${Math.round(cell.moisture)} · ${light.toFixed(2)}`;
        button.title = label; button.setAttribute('aria-label', label);
        button.addEventListener('click', () => {
          selected = `soil:${index}`; select.value = selected;
          renderHistory();
        });
        return button;
      });
      grid.setAttribute('aria-label', copy.soil);
      grid.replaceChildren(...cells);
      const names = new Map(state.history.flatMap(sample => sample.plants.map(plant => [plant.id, plant.species] as const)));
      for (const plant of state.plants) names.set(plant.id, plant.species as PlantSpecies);
      const options = [...state.soil.map((cell, i) => [`soil:${i}`, `${copy.plot} (${cell.x},${cell.y})`] as const), ...Array.from(names, ([id, species]) => [id, `${id} (${species})`] as const)];
      select.replaceChildren(...options.map(([value, label]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
      }));
      if (!options.some(([id]) => id === selected)) selected = 'soil:0';
      select.value = selected;
      requirements.replaceChildren(ctx.ui.h('div', '', copy.needs), ...Object.entries(TERRARIUM_PLANT_REQUIREMENTS).map(([species, needs]) => ctx.ui.h('div', '', `${species}: ${needs.minMoisture}–${needs.maxMoisture} / ${needs.minLight}–${needs.maxLight}`)));
      renderHistory();
      details.replaceChildren(...state.plants.map(plant => ctx.ui.h('div', plant.health <= TERRARIUM_PLANT_LOW_HEALTH ? 'terrarium-plant terrarium-plant-critical' : 'terrarium-plant',
        `${plant.id === 'fern' ? copy.fern : plant.id === 'clover' ? copy.clover : plant.species} · ${copy.stage} ${plant.stage} · ${copy.moisture} ${Math.round(plant.moisture)} · HP ${Math.round(plant.health)}${plant.health <= TERRARIUM_PLANT_LOW_HEALTH ? ` · ${copy.critical}` : ''}${plant.dry ? ` · ${copy.dry}` : ''}${flowerStage(plant) ? ` · ${copy[flowerStage(plant)!]}` : ''}`)), ...state.bugs.map(bug => ctx.ui.h('div', (bug.hunger ?? 0) >= 80 ? 'terrarium-plant terrarium-plant-critical' : 'terrarium-plant', `${bug.id} (${bug.species}) · ${copy.energy} ${bug.energy === undefined ? '—' : Math.round(bug.energy)}/100 · ${copy.hunger} ${bug.hunger === undefined ? '—' : Math.round(bug.hunger)}/100`)), ctx.ui.h('div', 'terrarium-plant', `${copy.seed} ${state.seeds?.length ?? 0} · ${copy.bug} ${state.bugs?.length ?? 0} · ${copy.egg} ${state.eggs?.length ?? 0} · ${ctx.language.startsWith('zh') ? '蛛网' : 'Webs'} ${state.webs?.length ?? 0}`), ...((state.nests ?? []).map(nest => ctx.ui.h('div', 'terrarium-plant', `${copy.nest} ${nest.id} (${nest.x},${nest.y}) · ${nest.depth} ${copy.depth} · ${copy.food} ${nest.food}/${nest.depth * 20}`))));
    } catch (error) { if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error); }
  };
  void load();
  ctx.interval(() => { void load(); }, 5_000);
}

export default { panels: { garden: { mount }, water: { mount: mountWater } } } satisfies WebUiClientBundle;
