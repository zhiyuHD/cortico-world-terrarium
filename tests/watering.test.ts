// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { newState, waterArea } from '../src/state.ts';
import { wateringReport } from '../src/habitat.ts';
import { createWateringControls } from '../webui/watering.ts';

it('previews overwatering and retains immediate warnings after refreshing the panel', async () => {
  const state = newState(0);
  state.soil[0].moisture = 61.4;
  state.soil[4].moisture = 30;
  let refreshed = false;
  const context = {
    language: 'zh', signal: new AbortController().signal,
    ui: {
      h(tag: string, className: string, text?: string) {
        const el = document.createElement(tag); el.className = className; el.textContent = text ?? ''; return el;
      },
      button(text: string, options: { onClick: () => void }) {
        const el = document.createElement('button'); el.textContent = text; el.addEventListener('click', options.onClick); return el;
      },
    },
    async invoke() {
      const cells = waterArea(state, 0, 0, 4, 4);
      return { watering: { soil: cells, ...wateringReport(state.plants, cells) } };
    },
  } as unknown as WebUiPanelContext;
  const controls = createWateringControls(context, async () => { controls.update(true, undefined, state); refreshed = true; });
  controls.update(true, undefined, state);
  expect(controls.el.textContent).toContain('全箱浇水将超量：fern (0,0) 96.4');
  (controls.el.querySelectorAll('button')[1] as HTMLButtonElement).click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(refreshed).toBe(true);
  const receipt = controls.el.querySelector('[role="status"]')!.textContent;
  expect(receipt).toContain('已浇水：25 格');
  expect(receipt).toContain('fern (0,0) 水分过高 96.4');
  expect(receipt).not.toContain('clover');
});
