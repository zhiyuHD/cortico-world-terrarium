// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { drawHistory, historyPaths } from '../webui/history.ts';
import { newState } from '../src/state.ts';

it('uses elapsed time on the chart and breaks lines where plants are absent', () => {
  const paths = historyPaths([{ recordedAtMs: 0, value: 100 }, { recordedAtMs: 10, value: 50 }, { recordedAtMs: 20, value: null }, { recordedAtMs: 40, value: 0 }], 100);
  expect(paths).toEqual(['M44.00,24.00 L218.00,94.00', 'M740.00,164.00']);
});

it('renders soil history and keeps plant stage units visible', () => {
  const history = newState(0).history;
  const labels = { moisture: 'Moisture', health: 'Health', stage: 'Stage', empty: 'Waiting' };
  const plant = drawHistory(history, 'fern', labels, 'en');
  expect(plant.getAttribute('role')).toBe('img');
  expect(plant.textContent).toContain('Stage (0–3)');
  expect(plant.textContent).toContain('Waiting');
  const soil = drawHistory(history, 'soil:0', labels, 'en');
  expect(soil.querySelectorAll('path')).toHaveLength(1);
  expect(soil.textContent).not.toContain('Stage (0–3)');
});
