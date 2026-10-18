import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import WebSocket from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { start } from '../server/index.ts';
import { LeaderboardClient } from '../src/leaderboard.ts';
import { newState } from '../src/state.ts';
import { newAquarium, stockFish } from '../src/aquarium.ts';
import { reportChanges, type ReportReply } from '../src/report-protocol.ts';
import { TERRARIUM_CLIENT_VERSION } from '../src/version.ts';
import { createReportProxy } from './report-service.ts';

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function fixture(incrementalReports = false, rejectUpgrade = false, kind: 'land' | 'water' = 'land') {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-ws-'));
  const server = await start({ port: 0, dataFile: join(dir, 'server.json'), credentialsFile: join(dir, 'server-tokens.json') });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const origin = `http://127.0.0.1:${address.port}`;
  const proxy = await createReportProxy(origin, undefined, rejectUpgrade);
  const credentialsFile = join(dir, 'client.json');
  const client = new LeaderboardClient({ url: proxy.url, id: '', credentialsFile, incrementalReports, kind });
  const id = (await client.claim())!;
  const credentials = Object.values(JSON.parse(await readFile(credentialsFile, 'utf8')))[0] as { id: string; token: string };
  const get = async () => (await (await fetch(`${origin}/api/boxes/${id}`)).json());
  disposals.push(async () => {
    client.close(); await proxy.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  const httpReport = async (state: unknown, clientVersion?: unknown) => fetch(`${origin}/api/reports`, { method: 'PUT', headers: { authorization: `Bearer ${credentials.token}` }, body: JSON.stringify({ id, state, clientVersion }) });
  return { client, id, credentials, origin, proxy, get, httpReport };
}

it('reuses WebSocket connections with full reports by default and always declares the actual client version', async () => {
  const { client, proxy, get } = await fixture();
  const state = newState(Date.now());
  await client.report(state, 'day'); state.name = '第二次'; await client.report(state, 'night');
  expect(proxy.frames.map(frame => frame.kind)).toEqual(['full', 'full']);
  expect(proxy.frames.every(frame => frame.clientVersion === TERRARIUM_CLIENT_VERSION)).toBe(true);
  expect(await get()).toMatchObject({ clientVersion: TERRARIUM_CLIENT_VERSION, phase: 'night', state });
});

it('sends acknowledged deltas after a full snapshot and sends full state again after reconnect or resync', async () => {
  const { client, proxy, get, httpReport } = await fixture(true);
  const state = newState(Date.now());
  await client.report(state, 'day');
  state.plants[0].health -= 2;
  await client.report(state, 'night');
  expect(proxy.frames.map(frame => frame.kind)).toEqual(['full', 'delta']);
  const delta = proxy.frames[1];
  expect(delta).toMatchObject({ changes: [{ op: 'replace', path: '/plants/0/health', value: state.plants[0].health }] });
  expect(delta).not.toHaveProperty('state');
  expect(await get()).toMatchObject({ state, phase: 'night' });
  expect((await httpReport({ ...state, name: '另一个客户端' })).status).toBe(200);
  state.name = '重新同步'; await client.report(state, 'day');
  expect(proxy.frames.slice(-2).map(frame => frame.kind)).toEqual(['delta', 'full']);
  expect((await get()).state).toEqual(state);
  proxy.disconnect();
  state.name = '连接恢复'; await client.report(state, 'day');
  expect(proxy.frames.at(-1)?.kind).toBe('full');
  expect((await get()).state).toEqual(state);
  client.close(); state.name = '重启'; await client.report(state, 'day');
  expect(proxy.frames.at(-1)?.kind).toBe('full');
});

it('serializes concurrent water reports against the acknowledged snapshot without retaining caller mutations', async () => {
  const { client, get, proxy } = await fixture(true, false, 'water');
  const state = newAquarium(Date.now()); stockFish(state, 'guppy', 2, 2);
  const first = client.report(state, 'day');
  state.fish[0].x = 3; state.name = '水庭';
  const expected = structuredClone(state), second = client.report(state, 'night');
  state.name = '未投递修改'; await Promise.all([first, second]);
  expect(proxy.frames.map(frame => frame.kind)).toEqual(['full', 'delta']);
  expect((await get()).state).toEqual(expected);
});

it('resends a full snapshot after a lost acknowledgement without applying a delta twice', async () => {
  const { client, proxy, get } = await fixture(true);
  const state = newState(Date.now()); await client.report(state, 'day');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    proxy.skipNextReply(); state.bugs.push({ id: 'bug-fixture', species: 'aphid', x: 1, y: 1, ageHours: 0, energy: 80 });
    const pending = client.report(state, 'day');
    const deadline = performance.now() + 2_000;
    while ((await get()).state.bugs.length === 0) { if (performance.now() > deadline) throw new Error('Report not committed'); await nextTurn(); }
    expect(client.status().state).toBe('syncing');
    await vi.advanceTimersByTimeAsync(5_000); await pending;
    expect(proxy.frames.map(frame => frame.kind)).toEqual(['full', 'delta', 'full']);
    expect((await get()).state).toEqual(state);
  } finally { vi.useRealTimers(); }
});

it('falls back to the unchanged HTTP endpoint on an older server while including clientVersion', async () => {
  const { client, get, proxy, httpReport } = await fixture(true, true);
  const state = newState(Date.now());
  await client.report(state, 'day'); state.name = '旧版兼容'; await client.report(state, 'night');
  expect(client.status()).toMatchObject({ state: 'synced', transport: 'http' });
  expect(proxy.frames).toEqual([]);
  expect(await get()).toMatchObject({ clientVersion: TERRARIUM_CLIENT_VERSION, state });
  const legacy = await httpReport(state);
  expect(await legacy.json()).toEqual({ score: (await get()).score });
  expect(await get()).not.toHaveProperty('clientVersion');
  expect((await httpReport(state, 123)).status).toBe(400);
});

it('closes silent connections after a missed heartbeat', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const { origin, id, credentials } = await fixture();
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/reports/ws?id=' + id, { headers: { authorization: `Bearer ${credentials.token}` }, autoPong: false });
    await once(ws, 'open');
    const ping = once(ws, 'ping');
    await vi.advanceTimersByTimeAsync(30_000); await ping;
    const closed = once(ws, 'close');
    await vi.advanceTimersByTimeAsync(30_000); await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  } finally { vi.useRealTimers(); }
});

async function socket(origin: string, id: string, token: string): Promise<WebSocket> {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/reports/ws?id=' + id, { headers: { authorization: `Bearer ${token}` } });
  await once(ws, 'open'); return ws;
}
async function send(ws: WebSocket, message: unknown): Promise<ReportReply> {
  const response = once(ws, 'message'); ws.send(JSON.stringify(message));
  return JSON.parse((await response)[0].toString());
}

it('requires authenticated upgrades, client versions and a full first snapshot; invalid deltas leave accepted state intact', async () => {
  const { origin, id, credentials, get } = await fixture();
  const rejected = new WebSocket(origin.replace('http:', 'ws:') + '/api/reports/ws?id=' + id, { headers: { authorization: 'Bearer wrong' } });
  const status = await new Promise<number | undefined>(resolve => {
    rejected.on('error', () => {});
    rejected.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); rejected.terminate(); });
  });
  expect(status).toBe(401);
  const ws = await socket(origin, id, credentials.token);
  try {
    let seq = 0;
    const header = () => ({ protocol: 1, seq: ++seq, phase: 'day', clientVersion: TERRARIUM_CLIENT_VERSION });
    const state = newState(Date.now());
    expect(await send(ws, { ...header(), clientVersion: undefined, kind: 'full', state })).toMatchObject({ kind: 'error', status: 400 });
    expect(await send(ws, { ...header(), kind: 'delta', baseRevision: 'missing', changes: [] })).toMatchObject({ kind: 'resync' });
    const accepted = await send(ws, { ...header(), kind: 'full', state });
    expect(accepted.kind).toBe('ack'); if (accepted.kind !== 'ack') throw new Error('No acknowledgement');
    for (const changes of [
      [{ op: 'replace', path: '/plants/0/health', value: -1 }],
      [{ op: 'add', path: '/__proto__/polluted', value: true }],
      [{ op: 'remove', path: '/missing' }],
    ]) {
      expect(await send(ws, { ...header(), kind: 'delta', baseRevision: accepted.revision, changes })).toMatchObject({ kind: 'error', status: 400 });
      expect((await get()).state).toEqual(state);
    }
    const changed = { ...state, name: '成功重试' };
    expect(await send(ws, { ...header(), kind: 'delta', baseRevision: accepted.revision, changes: reportChanges(state, changed) })).toMatchObject({ kind: 'ack' });
    expect((await get()).state).toEqual(changed);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  } finally { ws.terminate(); }
});


it('tracks acknowledged uploads and failures independently of reads, and full sync preserves incremental mode', async () => {
  const { client, proxy, get, credentials } = await fixture(true);
  expect(client.status()).toEqual({ state: 'idle', mode: 'incremental', consecutiveFailures: 0 });
  const state = newState(Date.now());
  await client.report(state, 'day');
  const success = client.status();
  expect(success).toMatchObject({ state: 'synced', transport: 'ws', consecutiveFailures: 0 });
  expect(Number.isFinite(Date.parse(success.lastAttemptAt!))).toBe(true);
  expect(Number.isFinite(Date.parse(success.lastSuccessAt!))).toBe(true);
  success.state = 'error';
  expect(client.status().state).toBe('synced');
  await client.report(state, 'day');
  const invalid = { ...state, version: 999 } as unknown as typeof state;
  const lastSuccessAt = client.status().lastSuccessAt;
  await expect(client.report(invalid, 'day')).rejects.toThrow();
  await expect(client.report(invalid, 'day')).rejects.toThrow();
  const failed = client.status();
  expect(failed).toMatchObject({ state: 'error', consecutiveFailures: 2, lastSuccessAt });
  expect(failed.lastError).toBeTruthy();
  expect(JSON.stringify(failed)).not.toContain(credentials.token);
  expect((await get()).state).toEqual(state);
  const frames = proxy.frames.length;
  client.status(); client.status();
  expect(proxy.frames).toHaveLength(frames);
  await client.report(state, 'day', true);
  expect(proxy.frames.at(-1)?.kind).toBe('full');
  expect(client.status()).toMatchObject({ state: 'synced', mode: 'incremental', consecutiveFailures: 0 });
  expect(client.status().lastError).toBeUndefined();
  state.name = '继续增量'; await client.report(state, 'day');
  expect(proxy.frames.at(-1)?.kind).toBe('delta');
  expect((await get()).state).toEqual(state);
});

it('keeps reporting disabled during manual full sync without creating credentials', async () => {
  const client = new LeaderboardClient({ url: '', id: '', credentialsFile: 'unused' });
  await client.report(newState(Date.now()), 'day', true);
  expect(client.status()).toEqual({ state: 'disabled', mode: 'full', consecutiveFailures: 0 });
  expect(client.id).toBeUndefined();
});
