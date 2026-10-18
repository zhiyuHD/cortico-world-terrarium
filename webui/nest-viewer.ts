import { nestContents, TERRARIUM_NEST_SIZE } from '../src/colony.ts';
import type { NestState } from '../src/state.ts';
import type { SceneState } from './scene.ts';

const STYLE = `
.tn-dialog{box-sizing:border-box;width:min(720px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:0;border:1px solid #c0ac85;border-radius:24px;background:#f7f1e4;color:#473c2e;box-shadow:0 30px 120px #17170e55;font:14px/1.5 system-ui,sans-serif;overflow:auto}
.tn-dialog::backdrop{background:#18251dd0;backdrop-filter:blur(7px)}.tn-head{padding:22px 24px 12px;display:flex;justify-content:space-between;gap:16px;align-items:center}.tn-head h2{font-size:22px;margin:0;font-weight:600}.tn-kicker{font:10px monospace;letter-spacing:2px;color:#8c7b5f;margin-bottom:5px}
.tn-dialog{overscroll-behavior:contain}.tn-head{position:sticky;top:0;z-index:2;background:#f7f1e4}
.tn-close,.tn-open{font:inherit;cursor:pointer;border:1px solid #b6aa88;border-radius:24px;background:#fffaf0;color:#4c573a;padding:8px 15px;transition:background .2s,transform .2s}.tn-close:hover,.tn-open:hover{background:#e8e4d1;transform:translateY(-1px)}.tn-toolbar{position:relative;display:flex;gap:6px;flex-wrap:wrap;z-index:1}.scene-wrap>.tn-toolbar{position:absolute;left:12px;bottom:10px}.tn-toolbar[hidden]{display:none}.tn-open{font-size:11px;padding:5px 11px;background:#fff9e8e8;backdrop-filter:blur(8px)}
.tn-summary{display:flex;flex-wrap:wrap;gap:8px;padding:0 24px 16px}.tn-summary span{background:#e9e2cd;border-radius:8px;padding:6px 10px;font-size:12px;font-variant-numeric:tabular-nums}
.tn-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;padding:18px;margin:0 24px;background:#796448;border:1px solid #6b593f;border-radius:18px;box-shadow:inset 0 3px 15px #3d2d2030}
.tn-cell{position:relative;box-sizing:border-box;width:100%;min-width:0;min-height:94px;aspect-ratio:1;overflow:hidden;border:1px solid #c6ac78;border-radius:19% 28% 23% 26%;background:radial-gradient(ellipse at 40% 35%,#a68a5e,#967347);color:#fff2d2;cursor:pointer;box-shadow:inset 0 3px 10px #3f2b2030,0 2px 2px #30251d28;font:inherit;padding:8px;transition:background .2s,box-shadow .2s}
.tn-cell:hover,.tn-cell[aria-pressed=true]{background:radial-gradient(ellipse at 40% 35%,#b79b6a,#a7804c);box-shadow:inset 0 0 0 2px #f3dba5,0 2px 8px #30251d30}.tn-cell:focus-visible,.tn-close:focus-visible,.tn-open:focus-visible{outline:3px solid #9cbd9a;outline-offset:3px}
.tn-cell-label{position:absolute;left:9px;top:6px;font-size:10px;color:#f6e7c3c9}.tn-occupants{position:absolute;inset:38px 5px 20px;display:flex;justify-content:center;align-items:center;gap:6px;overflow:hidden}.tn-ant{display:inline-flex;flex:0 1 auto;min-width:0;width:40px;height:30px;--ant-abdomen:#b77a50;--ant-head:#d7a171;--ant-chest:#c48a5c}.tn-ant svg{display:block;width:100%;height:100%;overflow:visible}.tn-ant.queen{width:46px;height:34px;--ant-abdomen:#c6984f;--ant-head:#e3b97e;--ant-chest:#d2a164}.tn-eggs{display:flex;flex:0 0 16px;flex-wrap:wrap;align-content:center;justify-content:center;gap:2px}.tn-egg{display:inline-block;width:6px;height:8px;border-radius:60% 50% 55% 45%;background:#fff1ce;box-shadow:inset -2px -1px 1px #d4bd91;transform:rotate(25deg)}.tn-food{flex:0 0 auto;white-space:nowrap;font-size:13px;color:#ffe2a1;font-variant-numeric:tabular-nums}.tn-cell-count{position:absolute;bottom:5px;right:8px;font-size:10px;color:#fff0ce}.tn-detail{padding:16px 24px 22px;min-height:65px}.tn-detail h3{font-size:13px;margin:0 0 5px}.tn-detail p{font-size:12px;margin:3px 0;color:#7b6a50;overflow-wrap:anywhere}.tn-note{padding:0 24px 18px;font-size:12px;color:#85755b}
@media(max-width:480px){.tn-head{padding:16px 16px 12px}.tn-head h2{font-size:19px}.tn-grid{padding:10px;margin:0 12px;gap:6px}.tn-cell{padding:5px}.tn-cell-label{font-size:8px;left:5px}.tn-occupants{gap:3px;inset:38px 3px 18px}.tn-summary{padding:0 16px 12px;gap:5px}.tn-summary span{font-size:11px;padding:4px 7px}.tn-detail{padding:14px 16px}.tn-cell-count{font-size:8px;right:5px}.tn-ant{width:34px;height:26px}.tn-ant.queen{width:40px;height:30px}.tn-ant~.tn-ant{display:none}.tn-eggs{flex-basis:12px}.tn-egg{width:5px;height:7px}.tn-food{font-size:10px}}
@media(prefers-reduced-motion:reduce){.tn-cell,.tn-open,.tn-close{transition:none}}
.tn-cell.has-queen{border-color:#ffdd8a;box-shadow:inset 0 0 0 1px #edce8d,0 0 9px #f8d87b35}.tn-queen-badge{position:absolute;right:6px;top:20px;border:1px solid #ffe8ab;border-radius:5px;padding:1px 4px;background:#f3d58b;color:#563d1c;font-size:10px;font-weight:600;line-height:1.3}.tn-cell-count{left:3px;right:3px;text-align:center;white-space:nowrap}.tn-time{font-variant-numeric:tabular-nums}
@media(max-width:480px){.tn-cell-label{font-size:9px}.tn-cell-count,.tn-queen-badge{font-size:9px}}
@media(max-width:360px){.tn-ant{width:24px;height:18px}.tn-ant.queen{width:28px;height:21px}.tn-eggs{flex-basis:10px;gap:1px}.tn-egg{width:4px;height:6px}}
@media(pointer:coarse){.tn-open,.tn-close{min-height:44px;padding:9px 14px}}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-dialog{background:#23251d;color:#e4e3ce;border-color:#65634b}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-head{background:#23251d}
:root:is([data-theme="dark"],[data-color-mode="dark"]) :is(.tn-kicker,.tn-detail p){color:#b5b299}
:root:is([data-theme="dark"],[data-color-mode="dark"]) :is(.tn-close,.tn-open){background:#313b29;color:#d0ddbd;border-color:#697655}
:root:is([data-theme="dark"],[data-color-mode="dark"]) :is(.tn-close,.tn-open):hover{background:#405135}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-summary span{background:#393d2e}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-grid{background:#403928;border-color:#62563b}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-cell{background:radial-gradient(ellipse at 40% 35%,#726443,#574329);border-color:#8c794d}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-cell:is(:hover,[aria-pressed="true"]){background:radial-gradient(ellipse at 40% 35%,#88764e,#6a5230)}

`;

const ANT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 36" fill="none" focusable="false">
  <ellipse cx="23" cy="32" rx="17" ry="1.8" fill="#60432b" opacity=".15"/>
  <g stroke="#9c7152" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 19Q10 21 10 26M22 19Q21 22 22 26M28 19Q32 21 33 25"/>
  </g>
  <g stroke="#80543d" stroke-width="1.8" stroke-linecap="round">
    <path d="M31 9Q29 3 26 5M36 9Q38 3 41 5"/>
  </g>
  <g stroke="#81553b" stroke-width="1.1">
    <ellipse cx="13" cy="20" rx="9" ry="7" fill="var(--ant-abdomen)"/>
    <ellipse cx="23" cy="21" rx="5" ry="4.8" fill="var(--ant-chest)"/>
    <ellipse cx="33" cy="15" rx="8" ry="7.8" fill="var(--ant-head)"/>
  </g>
  <ellipse cx="10" cy="17" rx="3.8" ry="1.7" transform="rotate(-24 10 17)" fill="#ffe4b2" opacity=".45"/>
  <path d="M17 24Q16 29 12 29M23 25Q23 30 20 30M28 23Q31 28 34 28" stroke="#80543d" stroke-width="2.3" stroke-linecap="round"/>
  <g fill="#fff6df"><ellipse cx="30" cy="13.5" rx="2.1" ry="2.4"/><ellipse cx="36" cy="13.5" rx="2.1" ry="2.4"/></g>
  <g fill="#594132"><circle cx="30.6" cy="13.8" r="1.15"/><circle cx="36.6" cy="13.8" r="1.15"/></g>
  <g fill="#fffaf0"><circle cx="30.9" cy="13.2" r=".45"/><circle cx="36.9" cy="13.2" r=".45"/></g>
  <ellipse cx="28" cy="18" rx="1.7" ry="1" fill="#d98c70" opacity=".55"/>
  <path d="M32 18Q34 20.5 36 18" stroke="#81553b" stroke-width="1.1" stroke-linecap="round"/>
</svg>`;

export function createNestViewer(canvas: HTMLCanvasElement, language: 'zh' | 'en' = 'zh') {
  const doc = canvas.ownerDocument;
  if (!doc.getElementById('terrarium-nest-style')) { const style = doc.createElement('style'); style.id = 'terrarium-nest-style'; style.textContent = STYLE; doc.head.append(style); }
  const zh = language === 'zh';
  const text = zh ? { title: '蚁巢内部', enter: '进入蚁巢', close: '返回生态箱', ant: '蚂蚁', egg: '卵', queen: '蚁后', worker: '工蚁', food: '储粮', entrance: '入口', storage: '粮仓', nursery: '育幼室', room: '巢室', empty: '此格没有蚂蚁或卵。', legacy: '该客户端尚未上报蚁巢内部状态；升级 World 后可查看蚁后与巢内生物。' }
    : { title: 'Inside the nest', enter: 'Enter nest', close: 'Back to terrarium', ant: 'Ants', egg: 'Eggs', queen: 'Queen', worker: 'Worker', food: 'Food', entrance: 'Entrance', storage: 'Pantry', nursery: 'Nursery', room: 'Chamber', empty: 'No ants or eggs in this cell.', legacy: 'This client has not reported colony locations. Upgrade the World to see the queen and nest residents.' };
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, label?: string): HTMLElementTagNameMap[K] => { const node = doc.createElement(tag); node.className = cls; if (label !== undefined) node.textContent = label; return node; };
  const toolbar = el('div', 'tn-toolbar'), dialog = el('dialog', 'tn-dialog');
  const head = el('div', 'tn-head'), title = el('h2', '', text.title), close = el('button', 'tn-close', text.close);
  close.type = 'button'; const heading = el('div', ''); heading.append(el('div', 'tn-kicker', 'COLONY / 4 × 4'), title); head.append(heading, close);
  const summary = el('div', 'tn-summary'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', 'tn-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', zh ? '4×4 蚁巢格子' : '4 by 4 nest cells');
  const detail = el('div', 'tn-detail'); detail.setAttribute('aria-live', 'polite');
  const note = el('p', 'tn-note', text.legacy); dialog.append(head, summary, grid, detail, note); doc.body.append(dialog); dialog.setAttribute('aria-label', text.title);
  let state: SceneState | null = null, selectedId: string | null = null, cellIndex = 10, recordedAtMs: number | undefined;
  const triggers = new Map<string, HTMLButtonElement>();
  let returnView: { opener: HTMLElement; x: number; y: number; ancestors: Array<{ node: HTMLElement; x: number; y: number }> } | null = null;
  const cells = Array.from({ length: TERRARIUM_NEST_SIZE ** 2 }, (_, index) => { const cell = el('button', 'tn-cell'); cell.type = 'button'; cell.addEventListener('click', () => { cellIndex = index; render(); }); grid.append(cell); return cell; });
  const roomName = (x: number, y: number) => x === 0 && y === 0 ? text.entrance : x === 3 && y === 0 ? text.storage : x === 2 && y === 2 ? text.nursery : text.room;
  const remainingTime = (hatchesAtMs: number): string => {
    const minutes = Math.ceil((hatchesAtMs - (recordedAtMs ?? Date.now())) / 60_000);
    if (minutes <= 0) return zh ? '等待孵化' : 'Awaiting hatching';
    const hours = Math.floor(minutes / 60), rest = minutes % 60;
    const duration = zh ? `${hours ? `${hours} 小时` : ''}${rest ? `${hours ? ' ' : ''}${rest} 分钟` : ''}` : `${hours ? `${hours}h` : ''}${rest ? `${hours ? ' ' : ''}${rest}m` : ''}`;
    return zh ? `预计 ${duration}后孵化` : `Hatches in about ${duration}`;
  };
  const render = (): void => {
    const nest = state?.nests?.find(nest => nest.id === selectedId);
    if (!state || !nest) { if (dialog.open) dialog.close(); return; }
    const contents = nestContents(state, nest); title.textContent = `${text.title} · ${nest.id}`;
    summary.replaceChildren(...[`${text.ant} ${contents.ants.length}`, `${text.queen} ${contents.queens}`, `${text.egg} ${contents.eggs.length}`, `${text.food} ${contents.food}/${nest.depth * 20}`].map(label => el('span', '', label)));
    note.hidden = state.bugs.some(bug => bug.species === 'ant' && bug.role !== undefined);
    for (const [index, cell] of cells.entries()) {
      const x = index % TERRARIUM_NEST_SIZE, y = Math.floor(index / TERRARIUM_NEST_SIZE);
      const ants = contents.ants.filter(ant => ant.inside!.x === x && ant.inside!.y === y), eggs = contents.eggs.filter(egg => egg.inside!.x === x && egg.inside!.y === y);
      const hasQueen = ants.some(ant => ant.role === 'queen');
      cell.classList.toggle('has-queen', hasQueen);
      cell.setAttribute('aria-pressed', String(index === cellIndex)); cell.setAttribute('aria-label', `${roomName(x, y)} (${x},${y}), ${text.ant} ${ants.length}, ${text.egg} ${eggs.length}${hasQueen ? `, ${text.queen}` : ''}`);
      const occupants = el('span', 'tn-occupants');
      const visibleAnts = [...ants].sort((a, b) => Number(b.role === 'queen') - Number(a.role === 'queen')).slice(0, 2);
      for (const ant of visibleAnts) { const icon = el('span', 'tn-ant' + (ant.role === 'queen' ? ' queen' : '')); icon.innerHTML = ANT_SVG; icon.title = `${ant.id} · ${ant.role === 'queen' ? text.queen : text.worker}`; icon.setAttribute('aria-hidden', 'true'); occupants.append(icon); }
      if (eggs.length) {
        const cluster = el('span', 'tn-eggs'); cluster.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < Math.min(3, eggs.length); i++) cluster.append(el('span', 'tn-egg'));
        occupants.append(cluster);
      }
      if (x === 3 && y === 0 && nest.food) occupants.append(el('span', 'tn-food', `● ${nest.food}`));
      cell.replaceChildren(el('span', 'tn-cell-label', `${roomName(x, y)} ${x},${y}`), occupants, el('span', 'tn-cell-count', `${zh ? '蚁' : 'Ant'} ${ants.length} · ${zh ? '卵' : 'Egg'} ${eggs.length}`));
      if (hasQueen) cell.append(el('span', 'tn-queen-badge', text.queen));
      if (index === cellIndex) {
        detail.replaceChildren(el('h3', '', `${roomName(x, y)} (${x},${y})`));
        if (!ants.length && !eggs.length) detail.append(el('p', '', text.empty));
        if (x === 3 && y === 0) detail.append(el('p', '', `${text.food}: ${nest.food}`));
        for (const ant of ants) detail.append(el('p', '', `${ant.id} · ${ant.role === 'queen' ? text.queen : text.worker}${ant.energy === undefined ? '' : ` · ${zh ? '体力' : 'Energy'} ${ant.energy.toFixed(0)}`}`));
        for (const egg of eggs) {
          const row = el('p', '', `${egg.id} · ${remainingTime(egg.hatchesAtMs)} · `);
          const time = el('time', 'tn-time', new Date(egg.hatchesAtMs).toLocaleString(zh ? 'zh-CN' : 'en'));
          time.dateTime = new Date(egg.hatchesAtMs).toISOString(); row.append(time); detail.append(row);
        }
      }
    }
  };
  const restoreView = (): void => {
    if (dialog.open || !returnView) return;
    const saved = returnView; returnView = null;
    if (saved.opener.isConnected) saved.opener.focus({ preventScroll: true });
    for (const { node, x, y } of saved.ancestors) if (node.isConnected) node.scrollTo({ left: x, top: y, behavior: 'instant' });
    doc.defaultView!.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
  };
  const open = (nest: NestState, opener: HTMLElement): void => {
    selectedId = nest.id; render();
    if (dialog.open) return;
    const ancestors = [];
    for (let node = canvas.parentElement; node; node = node.parentElement) ancestors.push({ node, x: node.scrollLeft, y: node.scrollTop });
    returnView = { opener, x: doc.defaultView!.scrollX, y: doc.defaultView!.scrollY, ancestors };
    opener.focus({ preventScroll: true });
    dialog.showModal();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) dialog.animate([{ opacity: 0, transform: 'translateY(16px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
  };
  const hit = (event: MouseEvent): void => {
    const bounds = canvas.getBoundingClientRect();
    const rx = Math.max(24, 30 * bounds.width / canvas.width), ry = Math.max(24, 20 * bounds.height / canvas.height);
    const targets = (state?.nests ?? []).map(nest => ({ nest,
      dx: event.clientX - bounds.left - (260 + nest.x * 70) * bounds.width / canvas.width,
      dy: event.clientY - bounds.top - (290 + nest.y * 9) * bounds.height / canvas.height,
    })).filter(({ dx, dy }) => Math.abs(dx) <= rx && Math.abs(dy) <= ry);
    targets.sort((a, b) => a.dx ** 2 + a.dy ** 2 - b.dx ** 2 - b.dy ** 2);
    const nest = targets[0]?.nest;
    if (nest) open(nest, triggers.get(nest.id) ?? canvas);
  };
  dialog.addEventListener('close', restoreView);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  canvas.addEventListener('click', hit);
  let nestIds = '';
  return {
    setState(next: SceneState, atMs?: number) {
      state = next; recordedAtMs = atMs; const nests = next.nests ?? [];
      if (canvas.parentElement && toolbar.parentElement !== canvas.parentElement) canvas.after(toolbar);
      const ids = nests.map(nest => nest.id).join(',');
      if (ids !== nestIds) { nestIds = ids; triggers.clear(); toolbar.replaceChildren(...nests.map(nest => { const button = el('button', 'tn-open', `${text.enter} · ${nest.id}`); button.type = 'button'; triggers.set(nest.id, button); button.addEventListener('click', () => { const current = state?.nests?.find(current => current.id === nest.id); if (current) open(current, button); }); return button; })); }
      toolbar.hidden = !nests.length; canvas.style.cursor = nests.length ? 'pointer' : ''; if (dialog.open) render();
    },
    dispose() { canvas.removeEventListener('click', hit); canvas.style.cursor = ''; if (dialog.open) dialog.close(); restoreView(); dialog.removeEventListener('close', restoreView); toolbar.remove(); dialog.remove(); },
  };
}
