// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createPublicReplayControls } from '../webui/public-controls.ts';

it('allocates no renderer while closed and releases it on close, offscreen pause and disposal', () => {
  const host = document.createElement('div'); document.body.append(host);
  let created = 0, live = 0;
  const shown: number[] = [];
  const controls = createPublicReplayControls(host, () => {
    created++; live++;
    return { setState(frame: number) { shown.push(frame); }, dispose() { live--; } };
  });
  try {
    controls.setReplays([{ id: 'hunt', recordedAtMs: 1, hunterId: 'hunter', preyId: 'prey', frames: [1, 2, 3] }]);
    expect(created).toBe(0); expect(live).toBe(0);
    const toggle = host.querySelector<HTMLButtonElement>('.pc-disclosure')!;
    toggle.click(); expect(live).toBe(1); expect(shown.at(-1)).toBe(1);
    host.querySelectorAll<HTMLButtonElement>('.pc-step')[2].click(); expect(shown.at(-1)).toBe(3);
    controls.setActive(false); expect(live).toBe(0);
    controls.setReplays([{ id: 'hunt', recordedAtMs: 1, hunterId: 'hunter', preyId: 'prey', frames: [1, 2, 3] }]);
    expect(live).toBe(0);
    controls.setActive(true); expect(live).toBe(1); expect(shown.at(-1)).toBe(3);
    toggle.click(); expect(live).toBe(0);
    toggle.click(); expect(live).toBe(1);
    controls.dispose(); expect(live).toBe(0); expect(host.children).toHaveLength(0);
  } finally { host.remove(); }
});
