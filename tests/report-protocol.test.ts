import { expect, it } from 'vitest';
import { applyReportChanges, reportChanges, reportStateHash } from '../src/report-protocol.ts';
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


it('hashes equivalent JSON independently of object key order while distinguishing array order and nested edits', () => {
  const before = { name: '水🌱', nested: { 'a/b~c': [1, null, { x: true, y: 2 }], missing: undefined }, count: -0 };
  const reordered = { count: 0, nested: { 'a/b~c': [1, null, { y: 2, x: true }] }, name: '水🌱' };
  expect(reportStateHash(before)).toMatch(/^[a-f0-9]{64}$/);
  expect(reportStateHash(before)).toBe(reportStateHash(reordered));
  expect(reportStateHash(before)).toBe(reportStateHash(JSON.parse(JSON.stringify(before))));
  expect(reportStateHash([1, 2])).not.toBe(reportStateHash([2, 1]));
  expect(reportStateHash({ nested: [1] })).not.toBe(reportStateHash({ nested: [2] }));
  expect(reportStateHash({ value: null })).not.toBe(reportStateHash({}));
});

it('round trips 250 reproducible nested JSON pairs without mutating either input', () => {
  let seed = 0x5eed;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const value = (depth: number): unknown => {
    const choice = random() % (depth ? 6 : 4);
    if (choice === 0) return null;
    if (choice === 1) return random() % 10000 / 10;
    if (choice === 2) return Boolean(random() % 2);
    if (choice === 3) return ['水🌱', '~/', '', '0'][random() % 4];
    if (choice === 4) return Array.from({ length: random() % 5 }, () => value(depth - 1));
    return Object.fromEntries(Array.from({ length: random() % 5 }, (_, i) => [`${i}/~key`, value(depth - 1)]));
  };
  for (let i = 0; i < 250; i++) {
    const before = value(4), after = value(4);
    const originalBefore = structuredClone(before), originalAfter = structuredClone(after);
    const applied = applyReportChanges(before, reportChanges(before, after));
    expect(applied).toEqual(after);
    expect(reportStateHash(applied)).toBe(reportStateHash(after));
    expect(before).toEqual(originalBefore); expect(after).toEqual(originalAfter);
  }
});
