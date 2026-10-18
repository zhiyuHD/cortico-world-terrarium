import { expect, it } from 'vitest';
import { applyReportChanges, reportChanges } from '../src/report-protocol.ts';
import { newState } from '../src/state.ts';

it('round trips nested edits, array insertion and deletion, escaped keys and removed optional fields', () => {
  const before = { state: newState(0), 'a/b~c': [1, { name: 'old' }], remove: true };
  const after = structuredClone(before);
  after.state.bugs.push({ id: 'bug-1', species: 'aphid', x: 2, y: 3, energy: 70, ageHours: 1 });
  after.state.plants[0].health -= 1; after.state.items.pop();
  after['a/b~c'][1] = { name: 'new' }; delete (after as Partial<typeof after>).remove;
  const changes = reportChanges(before, after);
  expect(applyReportChanges(before, changes)).toEqual(after);
  expect(before.state.bugs).toEqual([]);
  expect(changes).toContainEqual({ op: 'replace', path: '/state/plants/0/health', value: after.state.plants[0].health });
  expect(changes).toContainEqual({ op: 'replace', path: '/a~1b~0c/1/name', value: 'new' });
  expect(applyReportChanges(after, reportChanges(after, before))).toEqual(before);
  expect(reportChanges(before, structuredClone(before))).toEqual([]);
});

it('rejects missing paths, array gaps and prototype writes without mutating the accepted baseline', () => {
  const base = { list: [1], safe: { value: 1 } };
  for (const changes of [
    [{ op: 'add', path: '/__proto__/polluted', value: true }],
    [{ op: 'replace', path: '/safe/constructor/prototype/polluted', value: true }],
    [{ op: 'add', path: '/list/3', value: 2 }],
    [{ op: 'remove', path: '/missing' }],
    [{ op: 'remove', path: '/list/01' }],
    [{ op: 'replace', path: '/bad~2path', value: 1 }],
    [{ op: 'replace', path: '/safe/value', value: 2 }, { op: 'remove', path: '/missing' }],
  ]) expect(() => applyReportChanges(base, changes)).toThrow();
  expect(base).toEqual({ list: [1], safe: { value: 1 } });
  expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
});
