import type { RecordedReplay } from './playback.ts';

let nextId = 0;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function installStyles(): void {
  if (document.getElementById('terrarium-public-controls')) return;
  const style = node('style', ''); style.id = 'terrarium-public-controls';
  style.textContent = `
.pc-select{position:relative;min-width:0;font-size:12px;color:inherit}.pc-trigger{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;border:1px solid #dde3d7;background:#fafbf5;color:inherit;border-radius:9px;padding:10px 12px;text-align:left;cursor:pointer;transition:background .2s,border-color .2s,box-shadow .2s}.pc-trigger>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pc-chevron{flex:none;width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg) translateY(-2px);transition:transform .22s}.pc-trigger[aria-expanded=true]{border-color:#9fb590;box-shadow:0 0 0 3px #91aa7d14}.pc-trigger[aria-expanded=true] .pc-chevron{transform:rotate(225deg) translate(-2px,-1px)}
.pc-menu{position:absolute;z-index:10;top:calc(100% + 7px);right:0;min-width:100%;width:max-content;max-width:min(440px,calc(100vw - 64px));max-height:240px;overflow:auto;padding:5px;border:1px solid #dde3d7;border-radius:11px;background:#fffefa;box-shadow:0 12px 32px #253f351c;opacity:0;visibility:hidden;transform:translateY(-6px) scale(.98);transform-origin:top right;transition:opacity .18s,transform .18s,visibility 0s .18s}.pc-select[data-open=true] .pc-menu{transition-delay:0s;opacity:1;visibility:visible;transform:translateY(0) scale(1)}.pc-option{display:flex;width:100%;align-items:center;justify-content:space-between;gap:14px;border:0;border-radius:6px;background:transparent;padding:10px 11px;text-align:left;color:inherit;cursor:pointer;transition:background .16s,color .16s}.pc-option>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pc-option:hover,.pc-option:focus-visible{background:#edf1e5;outline:none}.pc-option[aria-selected=true]{background:#e7eddc;color:#355a45}.pc-tick{width:12px;height:6px;flex:none;border-left:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg) scale(.4);opacity:0;transition:opacity .18s,transform .18s}.pc-option[aria-selected=true] .pc-tick{opacity:1;transform:rotate(-45deg) scale(1)}.pc-trigger:disabled,.pc-play:disabled{opacity:.45;cursor:default}
.pc-disclosure{border:0;background:transparent;color:#5d7253;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:16px 0;cursor:pointer;font-size:12px;text-align:left}.pc-disclosure .pc-chevron{transform:rotate(-45deg)}.pc-disclosure[aria-expanded=true] .pc-chevron{transform:rotate(45deg)}.pc-panel{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .32s cubic-bezier(.2,.7,.3,1),opacity .22s}.pc-panel[data-open=true]{grid-template-rows:1fr;opacity:1}.pc-panel-inner{min-height:0;overflow:hidden}.pc-replay-body{padding:0 0 18px}.pc-replay .pc-select{margin:0 0 16px}.pc-transport{display:flex;align-items:center;gap:18px;margin:16px 0}.pc-play{width:42px;height:38px;flex:none;display:grid;place-items:center;border:1px solid #d9e2ce;border-radius:10px;background:#e8eddf;color:#355a45;cursor:pointer;transition:transform .16s,background .16s}.pc-play:hover{background:#dae5cc}.pc-play:active{transform:scale(.94)}.pc-play-icon{width:0;height:0;border-left:10px solid currentColor;border-top:6px solid transparent;border-bottom:6px solid transparent;transition:transform .18s}.pc-play[aria-pressed=true] .pc-play-icon{width:10px;height:12px;border:0;border-left:3px solid currentColor;border-right:3px solid currentColor;transform:scale(.9)}
.pc-slider{position:relative;flex:1;min-width:60px;height:32px;touch-action:none;cursor:pointer;border-radius:8px}.pc-track{position:absolute;top:14px;left:8px;right:8px;height:4px;border-radius:8px;background:#e1e7d8}.pc-fill{height:100%;width:var(--progress,0%);border-radius:inherit;background:#7d9668;transition:width .22s ease}.pc-thumb{position:absolute;top:9px;left:calc(8px + (100% - 16px)*var(--fraction,0));width:14px;height:14px;margin-left:-7px;border:3px solid #fffefa;border-radius:50%;background:#64854f;box-shadow:0 0 0 1px #8aa474,0 2px 5px #355a4520;transition:left .22s ease,transform .16s,box-shadow .16s}.pc-slider:hover .pc-thumb,.pc-slider[data-dragging=true] .pc-thumb{transform:scale(1.2);box-shadow:0 0 0 4px #8aa47422}.pc-slider[aria-disabled=true]{opacity:.4;cursor:default}.pc-steps{display:flex;justify-content:space-between;gap:8px;margin:0 0 10px}.pc-step{font-size:10px!important;padding:4px 0!important;border:0!important;background:transparent!important;color:#7b8774;transition:color .2s}.pc-step[aria-pressed=true]{color:#355a45;font-weight:600}.pc-replay-label{font-size:11px;line-height:1.8;color:#748076;margin:10px 0}.pc-replay canvas{display:block;width:100%;border-radius:9px}.pc-select button,.pc-play,.pc-disclosure,.pc-step{font-family:inherit}.pc-slider:focus-visible,.pc-trigger:focus-visible,.pc-play:focus-visible,.pc-disclosure:focus-visible,.pc-step:focus-visible{outline:2px solid #88a77d;outline-offset:3px}
@media(prefers-reduced-motion:reduce){.pc-select *,.pc-panel,.pc-slider *,.pc-play,.pc-play-icon,.pc-disclosure *,.pc-step{transition:none!important}}
`;
  document.head.append(style);
}
export interface SelectOption { value: string; label: string }
export function createPublicSelect(container: HTMLElement, label: string, onChange: (value: string) => void) {
  installStyles();
  const abort = new AbortController(), signal = abort.signal;
  const root = node('div', 'pc-select'), trigger = node('button', 'pc-trigger'), caption = node('span', '', label), chevron = node('span', 'pc-chevron'), menu = node('div', 'pc-menu');
  trigger.type = 'button'; trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-label', label); trigger.setAttribute('aria-haspopup', 'listbox');
  menu.id = `pc-menu-${++nextId}`; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', label); trigger.setAttribute('aria-controls', menu.id);
  trigger.append(caption, chevron); root.append(trigger, menu); container.append(root);
  let options: readonly SelectOption[] = [], value = '', open = false;
  const close = (focus = false): void => { open = false; root.dataset.open = 'false'; trigger.setAttribute('aria-expanded', 'false'); menu.inert = true; if (focus) trigger.focus(); };
  const sync = (): void => {
    caption.textContent = options.find(option => option.value === value)?.label ?? label;
    Array.from(menu.children).forEach((option, index) => option.setAttribute('aria-selected', String(options[index].value === value)));
  };
  const focusOption = (index: number): void => { const option = menu.children[(index + options.length) % options.length] as HTMLElement | undefined; option?.focus(); };
  const show = (): void => { if (trigger.disabled || !options.length) return; open = true; root.dataset.open = 'true'; trigger.setAttribute('aria-expanded', 'true'); menu.inert = false; focusOption(Math.max(0, options.findIndex(option => option.value === value))); };
  trigger.addEventListener('click', () => open ? close() : show());
  root.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (event.target as HTMLButtonElement).click(); }
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); if (!open) { show(); return; }
      const index = Array.from(menu.children).indexOf(document.activeElement as Element);
      focusOption(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (open && event.key.length === 1 && event.key !== ' ') {
      const index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (index >= 0) { event.preventDefault(); focusOption(index); }
    }
  });
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target as Node)) close(); }, { signal });
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget as Node | null)) close(); });
  close();
  return {
    root,
    get value() { return value; },
    setOptions(next: readonly SelectOption[]) {
      if (JSON.stringify(options) === JSON.stringify(next)) return;
      options = next; if (!options.some(option => option.value === value)) value = options[0]?.value ?? '';
      menu.replaceChildren(...options.map(option => {
        const button = node('button', 'pc-option'), text = node('span', '', option.label), tick = node('span', 'pc-tick');
        button.type = 'button'; button.tabIndex = -1; button.setAttribute('role', 'option'); button.append(text, tick);
        button.addEventListener('click', () => { const changed = value !== option.value; value = option.value; sync(); close(true); if (changed) onChange(value); });
        return button;
      })); sync(); if (!options.length) close();
    },
    setDisabled(disabled: boolean) { trigger.disabled = disabled; if (disabled) close(); },
    dispose() { abort.abort(); root.remove(); },
  };
}

export function createPublicReplayControls<Frame>(container: HTMLElement, createRenderer: (canvas: HTMLCanvasElement) => { setState(frame: Frame, recordedAtMs?: number): void; dispose(): void }, language: 'zh' | 'en' = 'zh') {
  installStyles();
  const copy = language === 'zh'
    ? { title: '捕食回放', empty: '暂无捕食记录', play: '播放', pause: '暂停', frames: ['移动前', '接触猎物', '捕食后'], select: '选择捕食记录', frame: '回放帧' }
    : { title: 'Hunt replays', empty: 'No recorded hunts', play: 'Play', pause: 'Pause', frames: ['Before movement', 'Contact', 'After capture'], select: 'Choose a hunt', frame: 'Replay frame' };
  const root = node('div', 'pc-replay'), toggle = node('button', 'pc-disclosure', copy.title), chevron = node('span', 'pc-chevron'), panel = node('div', 'pc-panel'), inner = node('div', 'pc-panel-inner'), body = node('div', 'pc-replay-body'), selectHost = node('div', ''), transport = node('div', 'pc-transport'), play = node('button', 'pc-play'), icon = node('span', 'pc-play-icon'), slider = node('div', 'pc-slider'), track = node('div', 'pc-track'), fill = node('div', 'pc-fill'), thumb = node('div', 'pc-thumb'), steps = node('div', 'pc-steps'), label = node('p', 'pc-replay-label'), canvas = node('canvas', '');
  toggle.type = play.type = 'button'; toggle.setAttribute('aria-expanded', 'false'); toggle.append(chevron); panel.id = `pc-panel-${++nextId}`; toggle.setAttribute('aria-controls', panel.id); panel.inert = true;
  play.append(icon); play.setAttribute('aria-label', copy.play); play.setAttribute('aria-pressed', 'false');
  slider.tabIndex = 0; slider.setAttribute('role', 'slider'); slider.setAttribute('aria-label', copy.frame); slider.setAttribute('aria-valuemin', '0'); slider.setAttribute('aria-valuemax', '2'); track.append(fill); slider.append(track, thumb);
  canvas.width = 800; canvas.height = 500; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', copy.title);
  transport.append(play, slider); body.append(selectHost, transport, steps, label, canvas); inner.append(body); panel.append(inner); root.append(toggle, panel); container.append(root);
  const scene = createRenderer(canvas);
  let replays: readonly RecordedReplay<Frame>[] = [], index = 0, timer: ReturnType<typeof setTimeout> | undefined, disposed = false, expanded = false;
  const stop = (): void => { clearTimeout(timer); timer = undefined; play.setAttribute('aria-label', copy.play); play.setAttribute('aria-pressed', 'false'); };
  const select = createPublicSelect(selectHost, copy.select, () => { stop(); index = 0; render(); });
  const stepButtons = copy.frames.map((text, i) => { const button = node('button', 'pc-step', text); button.type = 'button'; button.addEventListener('click', () => { stop(); index = i; render(); }); steps.append(button); return button; });
  const render = (): void => {
    const replay = replays.find(replay => replay.id === select.value);
    canvas.hidden = transport.hidden = steps.hidden = !replay; select.setDisabled(!replay); play.disabled = !replay;
    slider.setAttribute('aria-disabled', String(!replay)); slider.tabIndex = replay ? 0 : -1;
    slider.setAttribute('aria-valuenow', String(index)); slider.setAttribute('aria-valuetext', copy.frames[index]); slider.style.setProperty('--fraction', String(index / 2)); slider.style.setProperty('--progress', `${index * 50}%`);
    stepButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(index === i)));
    if (!replay) { label.textContent = copy.empty; return; }
    label.textContent = `${new Date(replay.recordedAtMs).toLocaleString(language)} · ${replay.hunterId} → ${replay.preyId} · ${copy.frames[index]}`;
    if (expanded) scene.setState(replay.frames[index], replay.recordedAtMs);
  };
  toggle.addEventListener('click', () => { expanded = !expanded; toggle.setAttribute('aria-expanded', String(expanded)); panel.dataset.open = String(expanded); panel.inert = !expanded; if (!expanded) stop(); render(); });
  const advance = (): void => { if (disposed) return; index++; render(); if (index < 2) timer = setTimeout(advance, 1500); else stop(); };
  play.addEventListener('click', () => { if (timer !== undefined) { stop(); return; } index = 0; render(); play.setAttribute('aria-label', copy.pause); play.setAttribute('aria-pressed', 'true'); timer = setTimeout(advance, 1500); });
  const seek = (clientX: number): void => { if (!replays.length) return; const rect = slider.getBoundingClientRect(); stop(); index = Math.max(0, Math.min(2, Math.round((clientX - rect.left - 8) / (rect.width - 16) * 2))); render(); };
  slider.addEventListener('pointerdown', event => { if (event.button !== 0 || !replays.length) return; event.preventDefault(); slider.focus(); slider.setPointerCapture(event.pointerId); slider.dataset.dragging = 'true'; seek(event.clientX); });
  slider.addEventListener('pointermove', event => { if (slider.hasPointerCapture(event.pointerId)) seek(event.clientX); });
  const release = (event: PointerEvent): void => { slider.dataset.dragging = 'false'; if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId); };
  slider.addEventListener('pointerup', release); slider.addEventListener('pointercancel', release);
  slider.addEventListener('keydown', event => { if (!replays.length || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); stop(); index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : Math.max(0, Math.min(2, index + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1))); render(); });
  render();
  return {
    setReplays(next: readonly RecordedReplay<Frame>[]) {
      if (disposed) return;
      const retained = next.some(replay => replay.id === select.value); replays = next;
      select.setOptions([...next].reverse().map(replay => ({ value: replay.id, label: `${new Date(replay.recordedAtMs).toLocaleString(language)} · ${replay.hunterId} → ${replay.preyId}` })));
      if (!retained) { stop(); index = 0; } render();
    },
    dispose() { disposed = true; stop(); select.dispose(); scene.dispose(); root.remove(); },
  };
}
