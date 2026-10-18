import { wateringReport, type SoilCell, type WateredPlant } from '../src/habitat.ts';
import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';

export function createWateringControls(ctx: WebUiPanelContext, reload: () => Promise<void>) {
  const zh = ctx.language.startsWith('zh');
  const el = ctx.ui.h('div', 'terrarium-watering');
  const status = ctx.ui.h('div', 'terrarium-watering-status');
  status.setAttribute('role', 'status');
  const hint = ctx.ui.h('div', 'terrarium-watering-hint', zh ? '每格 +35 水分，每株 +5 健康；水分过高也会伤害植物。' : 'Each cell: +35 moisture; each plant: +5 health. Excess water also damages plants.');
  const preview = ctx.ui.h('div', 'terrarium-watering-status');
  let busy = false, claimed = false, cell: { x: number; y: number } | undefined;
  const buttons = ctx.ui.h('div', 'terrarium-watering-buttons');
  const nearby = ctx.ui.button(zh ? '浇选中格及周围' : 'Water selected neighborhood', { size: 'sm', onClick: () => { if (cell) void submit(Math.max(0, cell.x - 1), Math.max(0, cell.y - 1), Math.min(4, cell.x + 1), Math.min(4, cell.y + 1)); } });
  const all = ctx.ui.button(zh ? '浇全部 25 格' : 'Water all 25 cells', { size: 'sm', onClick: () => { void submit(0, 0, 4, 4); } });
  const updateButtons = (): void => { nearby.disabled = busy || !claimed || !cell; all.disabled = busy || !claimed; };
  const submit = async (x1: number, y1: number, x2: number, y2: number): Promise<void> => {
    if (busy || !claimed || ctx.signal.aborted) return;
    busy = true; updateButtons();
    status.textContent = zh ? '浇水中…' : 'Watering…';
    try {
      const response = await ctx.invoke('water', [{ x1, y1, x2, y2 }]) as { watering: ReturnType<typeof wateringReport> };
      if (ctx.signal.aborted) return;
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      status.textContent = zh ? `已浇水：${count} 格 (${x1},${y1})–(${x2},${y2})` : `Watered ${count} cells (${x1},${y1})–(${x2},${y2})`;
      const warnings = response.watering.plants.filter(plant => plant.moistureStatus !== 'suitable').map(plant => zh
        ? `${plant.id} (${plant.x},${plant.y}) 水分${plant.moistureStatus === 'high' ? '过高' : '过低'} ${plant.moisture.toFixed(1)}（适宜 ${plant.minMoisture}–${plant.maxMoisture}）`
        : `${plant.id} (${plant.x},${plant.y}) moisture too ${plant.moistureStatus === 'high' ? 'high' : 'low'}: ${plant.moisture.toFixed(1)} (range ${plant.minMoisture}–${plant.maxMoisture})`);
      if (warnings.length) status.textContent += ` · ${warnings.join('；')}`;
      await reload();
    } catch (error) { if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error); }
    finally { busy = false; updateButtons(); }
  };
  buttons.append(nearby, all); el.append(buttons, hint, preview, status);
  updateButtons();
  return { el, update(available: boolean, selected?: { x: number; y: number }, state?: { plants: ReadonlyArray<WateredPlant>; soil: ReadonlyArray<SoilCell> }): void {
    claimed = available; cell = selected; el.hidden = !claimed; updateButtons();
    const risks = state ? wateringReport(state.plants, state.soil.map(soil => ({ ...soil, moisture: Math.min(100, soil.moisture + 35) }))).plants.filter(plant => plant.moistureStatus === 'high') : [];
    preview.textContent = risks.length ? (zh ? '全箱浇水将超量：' : 'Watering all cells would exceed moisture limits: ') + risks.map(plant => `${plant.id} (${plant.x},${plant.y}) ${plant.moisture.toFixed(1)} > ${plant.maxMoisture}`).join('；') : '';
    nearby.title = cell ? `(${Math.max(0, cell.x - 1)},${Math.max(0, cell.y - 1)})–(${Math.min(4, cell.x + 1)},${Math.min(4, cell.y + 1)})` : '';
  } };
}
