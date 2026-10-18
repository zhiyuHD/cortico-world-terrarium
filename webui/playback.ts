export interface RecordedReplay<Frame> { id: string; recordedAtMs: number; hunterId: string; preyId: string; frames: [Frame, Frame, Frame] }

/** Uses recorded scenes on a separate canvas so live refreshes cannot overwrite playback. */
export function createPlaybackControls<Frame>(container: HTMLElement, createRenderer: (canvas: HTMLCanvasElement) => { setState(frame: Frame, recordedAtMs?: number): void; dispose(): void }, language: 'zh' | 'en' = 'zh') {
  const copy = language === 'zh'
    ? { title: '捕食回放', empty: '暂无捕食记录', play: '播放', pause: '暂停', frames: ['移动前', '接触猎物', '捕食后'], select: '选择捕食记录', frame: '回放帧' }
    : { title: 'Hunt replays', empty: 'No recorded hunts', play: 'Play', pause: 'Pause', frames: ['Before movement', 'Contact', 'After capture'], select: 'Choose a hunt', frame: 'Replay frame' };
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = copy.title;
  const select = document.createElement('select'); select.setAttribute('aria-label', copy.select);
  const play = document.createElement('button'); play.type = 'button'; play.textContent = copy.play;
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '2'; slider.step = '1'; slider.value = '0'; slider.setAttribute('aria-label', copy.frame);
  const label = document.createElement('p');
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500; canvas.style.width = '100%'; canvas.style.maxWidth = '800px'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', copy.title);
  const scene = createRenderer(canvas);
  details.append(summary, select, play, slider, label, canvas); container.append(details);
  let replays: readonly RecordedReplay<Frame>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const stop = (): void => { clearTimeout(timer); timer = undefined; play.textContent = copy.play; };
  const render = (): void => {
    const replay = replays.find(replay => replay.id === select.value);
    canvas.hidden = !replay; select.disabled = play.disabled = slider.disabled = !replay;
    if (!replay) { label.textContent = copy.empty; return; }
    const index = Number(slider.value);
    label.textContent = `${new Date(replay.recordedAtMs).toLocaleString(language)} · ${replay.hunterId} → ${replay.preyId} · ${copy.frames[index]}`;
    slider.setAttribute('aria-valuetext', copy.frames[index]);
    scene.setState(replay.frames[index], replay.recordedAtMs);
  };
  const advance = (): void => {
    if (disposed) return;
    slider.value = String(Number(slider.value) + 1); render();
    if (Number(slider.value) < 2) timer = setTimeout(advance, 1500);
    else stop();
  };
  play.addEventListener('click', () => {
    if (timer !== undefined) { stop(); return; }
    slider.value = '0'; render(); play.textContent = copy.pause; timer = setTimeout(advance, 1500);
  });
  slider.addEventListener('input', () => { stop(); render(); });
  select.addEventListener('change', () => { stop(); slider.value = '0'; render(); });
  render();
  return {
    setReplays(next: readonly RecordedReplay<Frame>[]) {
      if (disposed) return;
      const selected = select.value;
      const retained = next.some(replay => replay.id === selected);
      replays = next;
      select.replaceChildren(...[...next].reverse().map(replay => {
        const option = document.createElement('option'); option.value = replay.id;
        option.textContent = `${new Date(replay.recordedAtMs).toLocaleString(language)} · ${replay.hunterId} → ${replay.preyId}`;
        return option;
      }));
      if (retained) select.value = selected;
      else { stop(); slider.value = '0'; render(); }
    },
    dispose() { disposed = true; stop(); scene.dispose(); details.remove(); },
  };
}
