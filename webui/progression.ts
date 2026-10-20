import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { TerrariumState } from '../src/state.ts';
import type { AquariumState } from '../src/aquarium.ts';
import { development, type FacilityKind } from '../src/progression.ts';

export function createProgressionControls(ctx: WebUiPanelContext, reload: () => Promise<void>) {
  const zh = ctx.language.startsWith('zh'), el = ctx.ui.h('section', 'terrarium-progress'), content = ctx.ui.h('div', ''), status = ctx.ui.h('div', 'terrarium-progress-status');
  el.setAttribute('aria-label', zh ? '观察站与扩建' : 'Observation station and expansion'); status.setAttribute('role', 'status');
  el.append(content, status); let busy = false, showLetter = true;
  let current: TerrariumState | AquariumState | undefined, selected = { x: 0, y: 0 };
  const run = async (args: Record<string, unknown>) => {
    if (busy || !current || ctx.signal.aborted) return;
    busy = true; render();
    try { await ctx.invoke('care', [{ tool: 'terrarium_progress', habitat: 'fish' in current ? 'water' : 'land', ...args }]); if (!ctx.signal.aborted) { status.textContent = zh ? '已保存' : 'Saved'; await reload(); } }
    catch (error) { if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error); }
    finally { busy = false; if (!ctx.signal.aborted) render(); }
  };
  const button = (text: string, args: Record<string, unknown>, disabled = false) => { const b = ctx.ui.button(text, { size: 'sm', onClick: () => { void run(args); } }); b.disabled = busy || disabled; return b; };
  const names: Record<FacilityKind, string> = { mulch: 'Mulch', shade: 'Shade canopy', grow_light: 'Grow light', air_stone: 'Air stone', filter: 'Filter', water_light: 'Aquatic grow light' };
  const render = () => {
    if (!current) return;
    const d = development(current), head = ctx.ui.h('div', 'terrarium-progress-head');
    const label = ctx.ui.h('div', '', zh ? `观察站 · 等级 ${d.level}` : `Observation station · Level ${d.level}`);
    const area = ctx.ui.h('strong', '', `${d.size} × ${d.size}`); head.append(label, area);
    const limits = ctx.ui.h('div', 'terrarium-progress-limits', zh ? `植物 ${current.plants.length}/${d.organisms} · ${'fish' in current ? '鱼' : '虫与卵'} ${'fish' in current ? current.fish.length : current.bugs.length + (current.eggs?.length ?? 0)}/${d.organisms} · 收藏 ${current.collection?.length ?? 0}/${d.collection}` : `Plants ${current.plants.length}/${d.organisms} · Animals ${'fish' in current ? current.fish.length : current.bugs.length + (current.eggs?.length ?? 0)}/${d.organisms} · Collection ${current.collection?.length ?? 0}/${d.collection}`);
    const progress = ctx.ui.h('div', 'terrarium-progress-track'), fill = ctx.ui.h('span', '');
    fill.style.width = `${d.next ? Math.min(100, d.peakScore / d.next.requiredScore * 100) : 100}%`; progress.append(fill);
    progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', zh ? '扩建所需最高积分' : 'Peak score toward expansion'); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(d.next?.requiredScore ?? d.peakScore)); progress.setAttribute('aria-valuenow', String(Math.min(d.peakScore, d.next?.requiredScore ?? d.peakScore)));
    const score = ctx.ui.h('div', 'terrarium-progress-score', d.next ? (zh ? `最高 ${d.peakScore} / ${d.next.requiredScore} 分 · 下一级 ${d.next.size}×${d.next.size}，收藏 ${d.next.collection}` : `Peak ${d.peakScore} / ${d.next.requiredScore} · Next ${d.next.size}×${d.next.size}, collection ${d.next.collection}`) : (zh ? `最高 ${d.peakScore} 分 · 已完成全部扩建` : `Peak ${d.peakScore} · Fully expanded`));
    const upgrade = button(zh ? '扩建观察站' : 'Expand habitat', { action: 'upgrade' }, !d.next?.available);
    const letter = ctx.ui.h('div', 'terrarium-letter');
    const toggle = ctx.ui.button(zh ? `观察站来信 · ${d.guide.completed ? '已读完' : d.guide.skipped ? '已跳过' : `${d.guide.step + 1}/${d.guide.total}`}` : `Letters · ${d.guide.step + 1}/${d.guide.total}`, { size: 'sm', onClick: () => { showLetter = !showLetter; render(); } });
    toggle.setAttribute('aria-expanded', String(showLetter)); letter.append(toggle);
    if (showLetter && 'title' in d.guide) {
      letter.append(ctx.ui.h('h3', '', d.guide.title), ctx.ui.h('p', '', d.guide.text), ctx.ui.h('p', 'terrarium-letter-task', d.guide.task));
      const actions = ctx.ui.h('div', 'terrarium-progress-actions');
      actions.append(button(zh ? (d.guide.ready ? '阅读下一封信' : '等待完成本章') : (d.guide.ready ? 'Next letter' : 'Task pending'), { action: 'guide' }, !d.guide.ready), button(zh ? '跳过引导' : 'Skip guide', { action: 'skip' })); letter.append(actions);
    }
    const facilities = ctx.ui.h('div', 'terrarium-facilities');
    for (const f of d.facilities) {
      const card = ctx.ui.h('article', `terrarium-facility${f.unlocked ? '' : ' is-locked'}`);
      card.append(ctx.ui.h('strong', '', `${zh ? f.name : names[f.kind as FacilityKind]} · ${zh ? '等级' : 'Lv'} ${f.level}`), ctx.ui.h('p', '', f.effect));
      const installed = f.installed;
      card.append(ctx.ui.h('div', '', !f.unlocked ? (zh ? '尚未解锁' : 'Locked') : installed ? `${installed.enabled ? (zh ? '运行中' : 'On') : (zh ? '已关闭' : 'Off')} · (${installed.x},${installed.y})` : (zh ? '可建造' : 'Available')));
      const actions = ctx.ui.h('div', 'terrarium-progress-actions');
      actions.append(button(zh ? `${installed ? '移到' : '建在'} (${selected.x},${selected.y})` : `${installed ? 'Move' : 'Build'} (${selected.x},${selected.y})`, { action: 'install', facility: f.kind, ...selected, enabled: true }, !f.unlocked));
      if (installed) actions.append(button(zh ? (installed.enabled ? '关闭' : '开启') : (installed.enabled ? 'Turn off' : 'Turn on'), { action: 'install', facility: f.kind, x: installed.x, y: installed.y, enabled: !installed.enabled }));
      card.append(actions); facilities.append(card);
    }
    content.replaceChildren(head, limits, progress, score, upgrade, letter, facilities);
  };
  return { el, update(state: TerrariumState | AquariumState, cell?: { x: number; y: number }) { current = state; if (cell) selected = cell; render(); } };
}
