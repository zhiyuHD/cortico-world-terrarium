import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';

export function createWateringControls(ctx: WebUiPanelContext, reload: () => Promise<void>) {
  const zh = ctx.language.startsWith('zh');
  const el = ctx.ui.h('div', 'terrarium-watering');
  const status = ctx.ui.h('div', 'terrarium-watering-status');
  status.setAttribute('role', 'status');
  const hint = ctx.ui.h('div', 'terrarium-watering-hint', zh ? '每格 +35 水分，每株 +5 健康；水分过高也会伤害植物。' : 'Each cell: +35 moisture; each plant: +5 health. Excess water also damages plants.');
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
      await ctx.invoke('water', [{ x1, y1, x2, y2 }]);
      if (ctx.signal.aborted) return;
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      status.textContent = zh ? `已浇水：${count} 格 (${x1},${y1})–(${x2},${y2})` : `Watered ${count} cells (${x1},${y1})–(${x2},${y2})`;
      await reload();
    } catch (error) { if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error); }
    finally { busy = false; updateButtons(); }
  };
  buttons.append(nearby, all); el.append(buttons, hint, status);
  updateButtons();
  return { el, update(available: boolean, selected?: { x: number; y: number }): void {
    claimed = available; cell = selected; el.hidden = !claimed; updateButtons();
    nearby.title = cell ? `(${Math.max(0, cell.x - 1)},${Math.max(0, cell.y - 1)})–(${Math.min(4, cell.x + 1)},${Math.min(4, cell.y + 1)})` : '';
  } };
}
