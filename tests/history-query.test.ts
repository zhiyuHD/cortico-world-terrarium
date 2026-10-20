import { expect, it } from 'vitest';
import { historyPage, landHistory, waterHistory, TERRARIUM_HISTORY_PAGE_SIZE, TERRARIUM_MAX_HISTORY_PAGE_SIZE } from '../src/history-query.ts';
import { newState } from '../src/state.ts';
import { newAquarium, stockFish } from '../src/aquarium.ts';

it('pages backwards without duplication while keeping samples chronological and validating bounds', () => {
  const data = Array.from({ length: 168 }, (_, i) => i);
  const first = historyPage(data, {}), second = historyPage(data, { offset: first.nextOffset });
  expect(first.samples).toEqual(data.slice(-TERRARIUM_HISTORY_PAGE_SIZE));
  expect(second.samples).toEqual(data.slice(-2 * TERRARIUM_HISTORY_PAGE_SIZE, -TERRARIUM_HISTORY_PAGE_SIZE));
  expect(historyPage(data, { offset: 999 }).samples).toEqual([]);
  expect(historyPage(data, { offset: 167 }).nextOffset).toBeNull();
  expect(() => historyPage(data, { limit: TERRARIUM_MAX_HISTORY_PAGE_SIZE + 1 })).toThrow('limit');
  expect(() => historyPage(data, { offset: -1 })).toThrow('offset');
});

it('filters plant history and preserves absence samples and stored precision', () => {
  const s = newState(0); s.history[0].plants[0].health = 45.123456789;
  s.history.push({ ...structuredClone(s.history[0]), recordedAtMs: 3600000, plants: [] });
  const saved = JSON.stringify(s);
  expect(landHistory(s, { plant: 'fern', metric: 'health' })).toMatchObject({ total: 2, samples: [{ plant: { id: 'fern', health: 45.1 } }, { plant: null }] });
  const text = JSON.stringify(landHistory(s, { plant: 'fern', metric: 'health' }));
  expect(text).not.toContain('growthHours'); expect(text).not.toContain('species');
  expect(JSON.stringify(s)).toBe(saved);
  expect(() => landHistory(s, { x: 0, y: 0, metric: 'health' })).toThrow('moisture only');
});

it('keeps 168 samples with twelve fish bounded, and filters dead fish without duplicating other fish', () => {
  const s = newAquarium(0);
  for (let i = 0; i < 12; i++) stockFish(s, 'guppy', i % 5, 2);
  s.history = Array.from({ length: 168 }, (_, i) => ({ recordedAtMs: i * 3600000, oxygen: 80.123456789, cleanliness: 95.123456789, fish: structuredClone(s.fish) }));
  const id = s.fish[0].id, otherId = s.fish[1].id; s.fish = [];
  const normal = waterHistory(s, {}) as { samples: object[] };
  expect(normal.samples).toHaveLength(TERRARIUM_HISTORY_PAGE_SIZE);
  expect(JSON.stringify(normal)).not.toContain('fish');
  const filtered = JSON.stringify(waterHistory(s, { fish: id, metric: 'energy', limit: TERRARIUM_MAX_HISTORY_PAGE_SIZE }));
  expect(filtered.length).toBeLessThan(4000);
  expect(filtered).toContain(id); expect(filtered).not.toContain(otherId); expect(filtered).not.toContain('cleanliness');
  expect(() => waterHistory(s, { metric: 'energy' })).toThrow('requires fish');
  expect(() => waterHistory(s, { fish: 'absent' })).toThrow('Unknown fish');
});
