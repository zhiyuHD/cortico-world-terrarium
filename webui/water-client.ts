import { createSyncControls } from './sync.ts';
import type { TerrariumSyncStatus } from '../src/leaderboard.ts';
import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { pick } from 'cortico/core/language.ts';
import type { AquariumState, AquariumFrame } from '../src/aquarium.ts';
import { createWaterReplayControls, createWaterScene } from './water-scene.ts';

export function mountWater(ctx: WebUiPanelContext): void {
  const zh = ctx.language === 'zh';
  const card = ctx.ui.sheet({ title: '生态箱·水', en: 'Terrarium · Water' });
  const title = ctx.ui.h('h2', '');
  const status = ctx.ui.msgline(zh ? '读取中' : 'Loading');
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500; canvas.className = 'terrarium-scene'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', zh ? '生态箱·水' : 'Water aquarium');
  const details = ctx.ui.h('div', 'terrarium-details');
  const replayContainer = ctx.ui.h('div', 'terrarium-replays');
  const history = ctx.ui.h('div', '');
  const scene = createWaterScene(canvas), replay = createWaterReplayControls(replayContainer, zh ? 'zh' : 'en');
  ctx.signal.addEventListener('abort', () => { scene.dispose(); replay.dispose(); }, { once: true });
  const sync = createSyncControls(ctx, () => load());
  const refresh = ctx.ui.button(zh ? '刷新' : 'Refresh', { size: 'sm', onClick: () => { void load(); } });
  card.body.append(title, status, sync.el, canvas, details, replayContainer, history, refresh); ctx.root.append(card.el);
  const load = async (): Promise<void> => {
    try {
      const response = await ctx.invoke<{ sync: TerrariumSyncStatus; claimed: boolean; id?: string; state?: AquariumState & AquariumFrame }>('state');
      if (ctx.signal.aborted) return;
      sync.update(response.sync, response.claimed);
      for (const el of [canvas, details, replayContainer, history]) el.hidden = !response.claimed;
      if (!response.claimed || !response.state) { status.textContent = zh ? '未认领' : 'Unclaimed'; return; }
      const state = response.state;
      title.textContent = state.name ?? (zh ? '生态箱·水' : 'Terrarium · Water');
      status.textContent = `${state.phase === 'day' ? (zh ? '白天' : 'Day') : (zh ? '夜晚' : 'Night')}${response.id ? ` · ID ${response.id}` : ''} · ${zh ? '含氧量' : 'Oxygen'} ${state.oxygen.toFixed(1)} · ${zh ? '水质' : 'Cleanliness'} ${state.cleanliness.toFixed(1)}`;
      scene.setState(state); replay.setReplays(state.replays);
      const names: Record<string, string> = zh ? { guppy: '孔雀鱼', goldfish: '金鱼', perch: '鲈鱼', waterweed: '水草', waterlily: '睡莲', algae: '海藻' } : {};
      details.replaceChildren(...state.fish.map(fish => ctx.ui.h('div', 'terrarium-plant', `${fish.id} · ${names[fish.species] ?? fish.species} · (${fish.x},${fish.y}) · ${zh ? '体力' : 'Energy'} ${fish.energy.toFixed(1)} · HP ${fish.health.toFixed(1)}`)), ...state.plants.map(plant => ctx.ui.h('div', 'terrarium-plant', `${plant.id} · ${names[plant.species] ?? plant.species} · ${zh ? '阶段' : 'Stage'} ${plant.stage} · HP ${plant.health.toFixed(1)}`)), ctx.ui.h('div', '', `${zh ? '饲料' : 'Food'} ${state.food.reduce((n, food) => n + food.portions, 0)}`));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 800 160'); svg.classList.add('terrarium-history'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', zh ? '小时历史：蓝色为含氧量，绿色为水质' : 'Hourly history: blue oxygen, green cleanliness');
      for (const [key, color] of [['oxygen', '#287cb3'], ['cleanliness', '#258568']] as const) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); line.setAttribute('fill', 'none'); line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2');
        line.setAttribute('points', state.history.map((sample, i) => `${20 + i * 760 / Math.max(1, state.history.length - 1)},${140 - sample[key] * 1.2}`).join(' ')); svg.append(line);
      }
      history.replaceChildren(ctx.ui.h('h3', '', pick(ctx.language, { zh: '小时历史 · 蓝色：含氧量 / 绿色：水质', en: 'Hourly history · Blue: oxygen / Green: cleanliness' })), svg);
    } catch (error) { if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error); }
  };
  void load(); ctx.interval(() => { void load(); }, 5000);
}
