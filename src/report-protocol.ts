import { createHash } from 'node:crypto';

export const TERRARIUM_REPORT_MAX_BYTES = 8_388_608;
export const TERRARIUM_REPORT_MAX_CHANGES = 16_384;

export type ReportChange = { op: 'add' | 'replace'; path: string; value: unknown } | { op: 'remove'; path: string };
export type ReportMessage = {
  protocol: 1; seq: number; clientVersion: string; coopanionVersion?: string; phase: 'day' | 'night'; stateHash?: string;
} & ({ kind: 'full'; state: unknown } | { kind: 'delta'; baseRevision: string; baseHash?: string; changes: ReportChange[] });
export type ReportReply = { kind: 'ack'; seq: number; revision: string; score: number; stateHash?: string }
  | { kind: 'resync'; seq: number }
  | { kind: 'error'; seq: number; status: number; error: string };

export function validClientVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

const escape = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** SHA-256 of JSON state with sorted object keys; array order remains significant. */
export function reportStateHash(state: unknown): string {
  const json = JSON.stringify(state, (_key, value: unknown) => object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return createHash('sha256').update(json).digest('hex');
}

export function validReportHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function reportChanges(before: unknown, after: unknown, path = ''): ReportChange[] {
  if (before === after) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes = before.slice(0, after.length).flatMap((value, index) => reportChanges(value, after[index], `${path}/${index}`));
    for (let index = before.length - 1; index >= after.length; index--) changes.push({ op: 'remove', path: `${path}/${index}` });
    for (let index = before.length; index < after.length; index++) changes.push({ op: 'add', path: `${path}/${index}`, value: after[index] });
    return changes;
  }
  if (object(before) && object(after)) {
    const changes: ReportChange[] = [];
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) changes.push({ op: 'remove', path: `${path}/${escape(key)}` });
    for (const key of Object.keys(after)) changes.push(...(Object.hasOwn(before, key) ? reportChanges(before[key], after[key], `${path}/${escape(key)}`) : [{ op: 'add' as const, path: `${path}/${escape(key)}`, value: after[key] }]));
    return changes;
  }
  return [{ op: 'replace', path, value: after }];
}

export function applyReportChanges(base: unknown, changes: unknown): unknown {
  if (!Array.isArray(changes) || changes.length > TERRARIUM_REPORT_MAX_CHANGES) throw new Error('Invalid report changes');
  let state = structuredClone(base);
  for (const change of changes) {
    if (!object(change) || !['add', 'replace', 'remove'].includes(String(change.op)) || typeof change.path !== 'string' || (change.op !== 'remove' && !Object.hasOwn(change, 'value'))) throw new Error('Invalid report change');
    if (change.path === '') {
      if (change.op !== 'replace') throw new Error('Invalid root change');
      state = structuredClone(change.value); continue;
    }
    if (!change.path.startsWith('/')) throw new Error('Invalid report path');
    const keys = change.path.slice(1).split('/').map(part => {
      if (/~(?![01])/.test(part)) throw new Error('Invalid report path');
      const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid report path');
      return key;
    });
    if (keys.length > 32) throw new Error('Report path too deep');
    let target = state;
    for (const key of keys.slice(0, -1)) {
      if ((!object(target) && !Array.isArray(target)) || !Object.hasOwn(target, key)) throw new Error('Missing report path');
      target = (target as Record<string, unknown>)[key];
    }
    const key = keys.at(-1)!;
    if (Array.isArray(target)) {
      if (!/^(0|[1-9]\d*)$/.test(key)) throw new Error('Invalid array index');
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index > target.length || (change.op !== 'add' && index === target.length)) throw new Error('Missing report path');
      if (change.op === 'add') target.splice(index, 0, structuredClone(change.value));
      else if (change.op === 'remove') target.splice(index, 1);
      else target[index] = structuredClone(change.value);
    } else {
      if (!object(target) || (change.op !== 'add' && !Object.hasOwn(target, key))) throw new Error('Missing report path');
      if (change.op === 'remove') delete target[key];
      else target[key] = structuredClone(change.value);
    }
  }
  if (Buffer.byteLength(JSON.stringify(state)) > TERRARIUM_REPORT_MAX_BYTES) throw new Error('Report too large');
  return state;
}
