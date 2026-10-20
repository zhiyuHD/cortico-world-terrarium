import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { DeathRecord } from '../src/deaths.ts';

export function createDeathHistory(ctx: WebUiPanelContext) {
  const zh = ctx.language.startsWith('zh');
  const el = ctx.ui.h('section', 'terrarium-deaths');
  const list = ctx.ui.h('div', 'terrarium-death-list');
  let records: DeathRecord[] = [], expanded = false;
  const toggle = ctx.ui.button('', { size: 'sm', onClick: () => { expanded = !expanded; render(); } });
  const render = (): void => {
    toggle.textContent = `${zh ? '死亡记录' : 'Death records'} · ${records.length} ${expanded ? (zh ? '收起' : 'Hide') : (zh ? '展开' : 'Show')}`;
    toggle.setAttribute('aria-expanded', String(expanded));
    list.hidden = !expanded;
    list.replaceChildren(...records.slice().reverse().map(r => {
      const o = r.organism;
      const card = ctx.ui.h('div', 'terrarium-death');
      const values = Object.entries(o).filter(([key]) => ['health', 'energy', 'hunger', 'ageHours'].includes(key)).map(([key, value]) => `${({ health: '健康', energy: '能量', hunger: '饥饿', ageHours: '年龄(h)' } as Record<string, string>)[zh ? key : ''] ?? key} ${Number(value).toFixed(1)}`);
      const meal = o.lastMeal;
      card.append(ctx.ui.h('strong', '', `${o.id} · ${o.species} · (${o.x},${o.y})`), ctx.ui.h('div', '', `${new Date(r.recordedAtMs).toLocaleString(ctx.language)} · ${r.cause}`), ctx.ui.h('div', '', values.join(' · ')), ctx.ui.h('div', '', `${zh ? '环境' : 'Environment'}: ${Object.entries(r.environment).map(([key, value]) => `${zh ? ({phase:'时段',moisture:'水分',light:'光照',oxygen:'含氧',cleanliness:'水质'} as Record<string,string>)[key] ?? key : key} ${typeof value === 'number' ? value.toFixed(1) : zh && value === 'day' ? '白天' : zh && value === 'night' ? '夜晚' : value}`).join(' · ')}`));
      if ('energy' in o) card.append(ctx.ui.h('div', '', meal ? `${zh ? '最近实际取食' : 'Last actual meal'}: ${new Date(meal.atMs).toLocaleString(ctx.language)} · ${zh ? ({foraging:'实际取食',fish:'捕食',food:'饲料',algae:'海藻'} as Record<string,string>)[meal.kind] ?? meal.kind : meal.kind}${meal.id ? ` (${meal.id})` : ''}` : (zh ? '最近实际取食：未记录' : 'Last actual meal: not recorded')));
      return card;
    }));
  };
  el.append(toggle, list);
  return { el, update(value: DeathRecord[] = []): void { records = value; render(); } };
}
