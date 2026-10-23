import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { TerrariumState } from '../src/state.ts';
import { TERRARIUM_POTS, balance, plantQuote } from '../src/merchant.ts';

export function createMerchantControls(ctx: WebUiPanelContext, reload: () => Promise<void>) {
  const zh = ctx.language.startsWith('zh'), el = ctx.ui.h('section', 'terrarium-progress'), body = ctx.ui.h('div', ''), status = ctx.ui.h('p', '');
  status.setAttribute('role', 'status'); el.append(body, status);
  let state: TerrariumState | undefined, selected = { x: 0, y: 0 }, busy = false, open = false;
  const run = async (args: Record<string, unknown>) => {
    if (busy || ctx.signal.aborted) return;
    busy = true; render();
    try { await ctx.invoke('care', [{ tool: 'terrarium_merchant', ...args }]); if (!ctx.signal.aborted) { status.textContent = zh ? '交易已保存' : 'Trade saved'; await reload(); } }
    catch (error) { if (!ctx.signal.aborted) status.textContent = String(error instanceof Error ? error.message : error); }
    finally { busy = false; if (!ctx.signal.aborted) render(); }
  };
  const button = (text: string, args: Record<string, unknown>, disabled = false) => { const b = ctx.ui.button(text, { size: 'sm', onClick: () => { void run(args); } }); b.disabled = disabled || busy; return b; };
  const render = () => {
    if (!state) { body.replaceChildren(); return; }
    const toggle = ctx.ui.button(zh ? `商人的小铺 · ${balance(state)} 金币` : `Merchant · ${balance(state)} coins`, { onClick: () => { open = !open; render(); } });
    toggle.setAttribute('aria-expanded', String(open)); body.replaceChildren(toggle);
    if (!open) return;
    body.append(ctx.ui.h('p', '', zh ? '出售不可撤销。植物须自然生长满 6 小时、健康 ≥40；施肥不增加售价。花盆留在格子上，收回和替换免费。' : 'Sales are permanent. Plants need 6 natural growth hours and health ≥40. Fertilizer adds no sale value. Pots stay on plots; storing and replacing are free.'));
    const sales = ctx.ui.h('div', 'terrarium-progress-actions');
    for (const plant of state.plants) { const quote = plantQuote(plant); sales.append(button(`${plant.id} · ${quote.coins} ${zh ? '金币出售' : 'coins / sell'}`, { action: 'sell', id: plant.id }, !quote.eligible)); }
    body.append(sales, ctx.ui.h('h3', '', `${zh ? '摆放位置' : 'Selected plot'} (${selected.x},${selected.y})`));
    const placed = state.economy?.pots.find(p => p.x === selected.x && p.y === selected.y);
    if (placed) body.append(button(zh ? `收回${TERRARIUM_POTS[placed.kind].name}` : `Store ${placed.kind} pot`, { action: 'remove', ...selected }));
    const catalog = ctx.ui.h('div', 'terrarium-facilities');
    for (const [kind, pot] of Object.entries(TERRARIUM_POTS)) {
      const card = ctx.ui.h('article', 'terrarium-facility'), count = state.economy?.inventory[kind as keyof typeof TERRARIUM_POTS] ?? 0;
      card.append(ctx.ui.h('strong', '', `${zh ? pot.name : kind} · ${pot.price}`), ctx.ui.h('p', '', pot.effect), ctx.ui.h('p', '', `${zh ? '库存' : 'Owned'} ${count}`), button(zh ? '购买' : 'Buy', { action: 'buy', pot: kind }, balance(state) < pot.price), button(zh ? '放在此格' : 'Place here', { action: 'place', pot: kind, ...selected }, count < 1));
      catalog.append(card);
    }
    body.append(catalog);
  };
  return { el, update(value?: TerrariumState, position?: { x: number; y: number }) { state = value; if (position) selected = position; render(); } };
}
