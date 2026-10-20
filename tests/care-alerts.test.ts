import { expect, it } from 'vitest';
import { careAlerts } from '../src/care-alerts.ts';
import { validCareAlerts } from '../src/care-alerts.ts';
import { newState, validState, waterSoil } from '../src/state.ts';
import { newAquarium } from '../src/aquarium.ts';

it('combines new dry plots, suppresses unchanged levels across saves and reports worsening and recovery', () => {
  const s = newState(0);
  for (const p of s.plants) { p.moisture = 15; s.soil[p.y * 5 + p.x].moisture = 15; }
  expect(careAlerts(s)).toHaveLength(2);
  const restored = JSON.parse(JSON.stringify(s));
  expect(validState(restored)).toBe(true);
  expect(careAlerts(restored)).toEqual([]);
  restored.plants[0].moisture = 0;
  expect(careAlerts(restored)).toEqual([expect.stringContaining('恶化')]);
  waterSoil(restored, restored.plants[0].x, restored.plants[0].y, { targetMoisture: 60 });
  expect(careAlerts(restored)).toEqual([expect.stringContaining('恢复')]);
  expect(careAlerts(restored)).toEqual([]);
  restored.plants = [];
  expect(careAlerts(restored)).toEqual([]);
});

it('holds oxygen warning until recovery and rearms after recovery', () => {
  const s = newAquarium(0); s.oxygen = 39;
  expect(careAlerts(s)).toHaveLength(1);
  s.oxygen = 44; expect(careAlerts(s)).toEqual([]);
  s.oxygen = 24; expect(careAlerts(s)).toEqual([expect.stringContaining('恶化')]);
  s.oxygen = 50; expect(careAlerts(s)).toEqual([expect.stringContaining('恢复')]);
  s.oxygen = 39; expect(careAlerts(s)).toEqual([expect.stringContaining('新增')]);
});

it('validates saved alert levels', () => {
  expect(validCareAlerts(undefined)).toBe(true);
  expect(validCareAlerts({ 'fern:dry': { severity: 8, label: 'bad' } })).toBe(false);
  expect(validCareAlerts([])).toBe(false);
});
