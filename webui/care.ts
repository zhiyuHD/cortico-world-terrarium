import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { landCare, waterCare } from '../src/care.ts';

export function careText(care: ReturnType<typeof landCare> | ReturnType<typeof waterCare>, zh: boolean): string[] {
  const lines = [zh ? `${care.phase === 'night' ? '距离天亮' : '距离夜晚'} ${care.hoursUntilChange.toFixed(1)} 小时` : `${care.hoursUntilChange.toFixed(1)} hours until ${care.phase === 'night' ? 'daylight' : 'night'}`];
  for (const p of care.plants) {
    const reasons: string[] = [];
    if (p.waitForDaylight) reasons.push(zh ? '等天亮' : 'waiting for daylight');
    if ('moistureShortfall' in p) {
      if (p.moistureShortfall) reasons.push(`${zh ? '缺水' : 'moisture shortfall'} ${p.moistureShortfall.toFixed(1)}`);
      if (p.moistureExcess) reasons.push(`${zh ? '水分超出上限' : 'excess moisture'} ${p.moistureExcess.toFixed(1)}`);
      if (p.lightShortfall) reasons.push(`${zh ? '白天光照还差' : 'daylight shortfall'} ${p.lightShortfall.toFixed(2)}`);
      if (p.lightExcess) reasons.push(`${zh ? '白天光照超出' : 'excess daylight'} ${p.lightExcess.toFixed(2)}`);
    } else if (p.cleanlinessShortfall) reasons.push(`${zh ? '水质还差' : 'cleanliness shortfall'} ${p.cleanlinessShortfall.toFixed(1)}`);
    lines.push(`${p.id} · ${p.nextStage === null ? (zh ? '已到最高阶段' : 'fully grown') : `${Math.round(p.progress * 100)}% · ${zh ? '下阶段还需适宜白天' : 'suitable daylight remaining'} ${p.suitableHoursRemaining.toFixed(1)}h`}${reasons.length ? ` · ${reasons.join(' / ')}` : ''}`);
  }
  if ('seeds' in care) for (const s of care.seeds) lines.push(`${s.id} · ${zh ? '发芽还需适宜白天' : 'suitable daylight until sprouting'} ${s.suitableDaylightHoursRemaining.toFixed(1)}h${s.waitForDaylight ? (zh ? ' · 等天亮' : ' · waiting for daylight') : ''}${s.moistureShortfall ? ` · ${zh ? '缺水' : 'moisture shortfall'} ${s.moistureShortfall.toFixed(1)}` : ''}`);
  if ('oxygenForecast' in care) lines.push(zh ? `天亮含氧估计 ${care.oxygenForecast.oxygen.toFixed(1)}；假定期间不人工操作，实际可能变化。` : `Estimated dawn oxygen ${care.oxygenForecast.oxygen.toFixed(1)}; assumes no caretaker actions.`);
  const goals: Record<string, string> = zh ? { 'healthy-diversity': '健康植物种类', 'three-blooms': '同时开花', 'stocked-colony': '蚁巢储粮', 'healthy-aquatic-diversity': '健康水草种类', 'balanced-water': '氧气与水质均衡' } : {};
  for (const g of care.goals) lines.push(`${goals[g.id] ?? g.id}: ${Math.min(g.current, g.target).toFixed(0)}/${g.target}`);
  if ('suggestedFoodCleanup' in care && care.suggestedFoodCleanup.length) lines.push(`${zh ? '建议清理残饵' : 'Suggested food cleanup'}: ${care.suggestedFoodCleanup.join(', ')}`);
  if ('feeding' in care) for (const f of care.feeding) if (f.lastMeal) lines.push(`${f.fishId} · ${zh ? '最近取食' : 'Last meal'}: ${f.lastMeal.id} (${f.lastMeal.kind}) · ${new Date(f.lastMeal.atMs).toISOString()}`);
  return lines;
}
export function createCareControls(ctx: WebUiPanelContext, habitat: 'land' | 'water', reload: () => Promise<void>) {
  const zh = ctx.language.startsWith('zh'), el = ctx.ui.h('div', 'terrarium-care'), status = ctx.ui.h('div', '');
  status.setAttribute('role', 'status');
  const hint = ctx.ui.h('div', '', zh ? '收藏后暂停生长与消耗，不计分；每箱最多 48 个，放回仍受容量限制。' : 'Collected organisms are frozen and unscored; up to 48 per habitat. Restoring uses normal capacity.');
  const actions = ctx.ui.h('div', 'terrarium-watering-buttons'); let busy = false;
  const run = async (args: Record<string, unknown>) => {
    if (busy || ctx.signal.aborted) return; busy = true;
    try { await ctx.invoke('care', [args]); if (!ctx.signal.aborted) { status.textContent = zh ? '已保存' : 'Saved'; await reload(); } }
    catch (e) { if (!ctx.signal.aborted) status.textContent = e instanceof Error ? e.message : String(e); }
    finally { busy = false; }
  };
  el.append(hint, actions, status);
  return { el, update(state: { plants: { id: string; x: number; y: number }[]; bugs?: { id: string }[]; fish?: { id: string }[]; seeds?: { id: string }[]; collection?: { kind: string; specimen: { id: string; x: number; y: number } }[]; food?: { id: string }[] }, cell: { x: number; y: number } = { x: 2, y: 2 }) {
    actions.replaceChildren();
    const add = (text: string, args: Record<string, unknown>) => actions.append(ctx.ui.button(text, { size: 'sm', onClick: () => { void run(args); } }));
    if (habitat === 'land') {
      add(zh ? `(${cell.x},${cell.y}) 排水 10` : 'Drain selected cell by 10', { tool: 'terrarium_drain', ...cell, amount: 10 });
      add(zh ? '选中格每小时补到 60' : 'Selected cell: hourly target 60', { tool: 'terrarium_set_irrigation', ...cell, enabled: true, targetMoisture: 60 });
      add(zh ? '关闭选中格定时浇水' : 'Disable selected cell irrigation', { tool: 'terrarium_set_irrigation', ...cell, enabled: false });
    } else {
      for (const food of state.food ?? []) add(`${zh ? '清理残饵' : 'Remove food'} ${food.id}`, { tool: 'terrarium_cleanup_food', id: food.id });
      for (const species of ['waterweed', 'waterlily', 'algae']) add(`${zh ? '选中格种植' : 'Plant selected cell'} ${species}`, { tool: 'terrarium_plant_aquatic_area', species, x1: cell.x, y1: cell.y, x2: cell.x, y2: cell.y });
    }
    for (const p of [...state.plants, ...(state.bugs ?? []), ...(state.fish ?? []), ...(state.seeds ?? [])]) add(`${zh ? '收藏' : 'Collect'} ${p.id}`, { tool: 'terrarium_collection', action: 'collect', id: p.id });
    for (const item of state.collection ?? []) add(`${zh ? '放回选中格' : 'Restore to selected cell'} ${item.specimen.id}`, { tool: 'terrarium_collection', action: 'restore', id: item.specimen.id, ...cell });
  } };
}
