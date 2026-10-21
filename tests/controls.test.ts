import { ReportSocket } from '../src/report-socket.ts';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import WebSocket from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { start } from '../server/index.ts';
import { runAdmin } from '../server/admin.ts';
import { ControlStore } from '../server/controls.ts';
import { newState } from '../src/state.ts';
import { reportChanges, reportStateHash } from '../src/report-protocol.ts';
import { TERRARIUM_CLIENT_VERSION } from '../src/version.ts';

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { try { for (const dispose of disposals.splice(0).reverse()) await dispose(); } finally { vi.useRealTimers(); } });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-controls-'));
  disposals.push(() => rm(dir, { recursive: true, force: true }));
  const options = { port: 0, dataFile: join(dir, 'leaderboard.json'), credentialsFile: join(dir, 'credentials.json') };
  let server = await start(options);
  const close = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  disposals.push(close);
  const url = () => { const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); return `http://127.0.0.1:${address.port}`; };
  const admin = (...args: string[]) => runAdmin([...args, '--server', url(), '--token-file', join(dir, 'admin-token')]);
  const adminToken = (await readFile(join(dir, 'admin-token'), 'utf8')).trim();
  const registration = await fetch(url() + '/api/registrations', { method: 'POST', body: JSON.stringify({ id: 'control-box' }) });
  const credentials = await registration.json() as { id: string; token: string };
  const state = newState(Date.now());
  const report = () => fetch(url() + '/api/reports', { method: 'PUT', headers: { authorization: `Bearer ${credentials.token}` }, body: JSON.stringify({ ...credentials, state, clientVersion: TERRARIUM_CLIENT_VERSION }) });
  const update = (input: unknown, token = adminToken) => fetch(url() + '/api/admin/controls/http-push', { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  const nextReportChunk = () => new Promise<void>(resolve => server.once('request', req => req.once('data', () => resolve())));
  return { dir, url, admin, state, credentials, report, update, nextReportChunk, restart: async () => { await close(); server = await start(options); } };
}

it('requires admin credentials, gates only HTTP reports, keeps WebSocket full and delta reports working, and can reopen HTTP', async () => {
  const { url, admin, credentials, report, update, state } = await fixture();
  expect(await admin('controls')).toMatchObject({ httpPush: { enabled: true, scheduledChange: null } });
  expect((await fetch(url() + '/api/admin/controls')).status).toBe(401);
  expect((await update({ enabled: false }, credentials.token)).status).toBe(401);
  expect((await report()).status).toBe(200);
  const previous = await (await fetch(url() + '/api/boxes/' + credentials.id)).json();
  await admin('http-push', 'off');
  const rejected = await report();
  expect(rejected.status).toBe(410); expect(await rejected.json()).toMatchObject({ accepted: false, ignored: true, error: expect.stringContaining('WebSocket Push') });
  expect(await (await fetch(url() + '/api/boxes/' + credentials.id)).json()).toEqual(previous);
  for (const path of ['/health', '/api/leaderboard', '/api/announcements/public']) expect((await fetch(url() + path)).status).toBe(200);
  expect((await fetch(url() + '/api/announcements?id=' + credentials.id, { headers: { authorization: `Bearer ${credentials.token}` } })).status).toBe(200);
  expect((await fetch(url() + '/api/registrations', { method: 'POST', body: '{"id":"new-control-box"}' })).status).toBe(201);
  const ws = new WebSocket(url().replace('http:', 'ws:') + '/api/reports/ws?id=' + credentials.id, { headers: { authorization: `Bearer ${credentials.token}` } });
  await once(ws, 'open');
  try {
    const send = async (input: unknown) => { const reply = once(ws, 'message'); ws.send(JSON.stringify(input)); return JSON.parse(String((await reply)[0])); };
    const full = await send({ protocol: 1, seq: 1, kind: 'full', clientVersion: TERRARIUM_CLIENT_VERSION, phase: 'day', state, stateHash: reportStateHash(state) });
    expect(full.kind).toBe('ack');
    const changed = { ...state, name: 'WS after HTTP shutdown' };
    const delta = await send({ protocol: 1, seq: 2, kind: 'delta', clientVersion: TERRARIUM_CLIENT_VERSION, phase: 'day', baseRevision: full.revision, baseHash: reportStateHash(state), stateHash: reportStateHash(changed), changes: reportChanges(state, changed) });
    expect(delta).toMatchObject({ kind: 'ack', stateHash: reportStateHash(changed) });
    expect(await (await fetch(url() + '/api/boxes/' + credentials.id)).json()).toMatchObject({ state: changed });
  } finally { ws.terminate(); }
  await admin('http-push', 'on');
  expect((await report()).status).toBe(200);
});

it('enforces the exact scheduled boundary across restarts and preserves the rule on disk', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const startAt = Date.parse('2026-10-24T23:59:00+08:00'); vi.setSystemTime(startAt);
  const { dir, admin, report, restart } = await fixture();
  const at = '2026-10-25T00:00:00+08:00';
  expect(await admin('http-push', 'off', '--at', at)).toMatchObject({ httpPush: { enabled: true, scheduledChange: { enabled: false, at: new Date(at).toISOString() } } });
  expect((await stat(join(dir, 'controls.json'))).mode & 0o777).toBe(0o600);
  await restart();
  vi.setSystemTime(startAt + 59_999);
  const beforeShutdown = await report();
  expect(beforeShutdown.status).toBe(200);
  expect(beforeShutdown.headers.get('sunset')).toBe(new Date(at).toUTCString());
  vi.setSystemTime(startAt + 60_000); expect((await report()).status).toBe(410);
  expect(await admin('controls')).toMatchObject({ httpPush: { enabled: false, scheduledChange: null } });
  await restart(); expect((await report()).status).toBe(410);
  await admin('http-push', 'on'); await restart(); expect((await report()).status).toBe(200);
});

it('can replace and cancel schedules and schedule HTTP reopening', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const now = Date.now();
  const { admin, report, restart } = await fixture();
  await admin('http-push', 'off', '--at', new Date(now + 1000).toISOString());
  await admin('http-push', 'off', '--at', new Date(now + 2000).toISOString());
  vi.setSystemTime(now + 1000); expect((await report()).status).toBe(200);
  await admin('http-push', 'cancel'); await restart();
  vi.setSystemTime(now + 2000); expect((await report()).status).toBe(200);
  await admin('http-push', 'off');
  await admin('http-push', 'on', '--at', new Date(now + 3000).toISOString());
  expect((await report()).status).toBe(410);
  vi.setSystemTime(now + 3000); expect((await report()).status).toBe(200);
  await admin('http-push', 'cancel'); await restart(); expect((await report()).status).toBe(200);
});

it('rejects an HTTP body that started before the deadline but completes after it', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const now = Date.now();
  const { url, admin, state, credentials, report, nextReportChunk } = await fixture();
  expect((await report()).status).toBe(200);
  await admin('http-push', 'off', '--at', new Date(now + 1000).toISOString());
  const payload = JSON.stringify({ id: credentials.id, state: { ...state, name: 'Must not be committed' } });
  const firstChunk = nextReportChunk();
  const pending = request(url() + '/api/reports', { method: 'PUT', headers: { authorization: `Bearer ${credentials.token}` } });
  const response = new Promise<number>((resolve, reject) => {
    pending.on('error', reject);
    pending.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
  });
  pending.write(payload.slice(0, 10)); await firstChunk;
  vi.setSystemTime(now + 1000); pending.end(payload.slice(10));
  expect(await response).toBe(410);
  expect(await (await fetch(url() + '/api/boxes/' + credentials.id)).json()).toMatchObject({ state });
});

it('rejects malformed, oversized and past controls without changing the persisted rule', async () => {
  const { admin, update, url } = await fixture();
  const future = new Date(Date.now() + 60_000).toISOString();
  await admin('http-push', 'off', '--at', future);
  const accepted = await admin('controls');
  for (const input of [null, [], {}, { enabled: 'false' }, { enabled: false, at: '2026-10-25T00:00:00' }, { enabled: false, at: 'invalid' }, { enabled: false, at: new Date(Date.now() - 1).toISOString() }, { enabled: false, unknown: true }, { cancel: true, enabled: false }, { cancel: false }]) {
    expect((await update(input)).status).toBe(400); expect(await admin('controls')).toEqual(accepted);
  }
  expect((await update({ enabled: false, padding: 'x'.repeat(1100) })).status).toBe(413);
  expect((await fetch(url() + '/api/admin/controls/http-push')).status).toBe(401);
  await expect(admin('http-push', 'maybe')).rejects.toThrow();
  await expect(admin('http-push', 'cancel', '--at', future)).rejects.toThrow();
  expect(await admin('controls')).toEqual(accepted);
});

it('rejects corrupt persisted controls instead of reopening HTTP', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-controls-invalid-')); disposals.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'controls.json');
  for (const state of [null, {}, { httpPush: { enabled: 'false', scheduledChange: null } }, { httpPush: { enabled: true, scheduledChange: { enabled: false, at: 'invalid' } } }]) {
    await writeFile(file, JSON.stringify(state)); await expect(new ControlStore(file).restore()).rejects.toThrow('Invalid controls file');
  }
});

it('ignores HTTP and existing WS full/delta reports below the floor without changing snapshots, and deduplicates private upgrade notices across restarts', async () => {
  const { url, admin, credentials, report, state, restart } = await fixture();
  await report();
  const before = await (await fetch(url() + '/api/boxes/' + credentials.id)).json();
  const ws = new WebSocket(url().replace('http:', 'ws:') + '/api/reports/ws?id=' + credentials.id, { headers: { authorization: `Bearer ${credentials.token}` } });
  await once(ws, 'open');
  const send = async (input: unknown) => { const reply = once(ws, 'message'); ws.send(JSON.stringify(input)); return JSON.parse(String((await reply)[0])); };
  const full = await send({ protocol: 1, seq: 1, kind: 'full', clientVersion: '0.7.3', phase: 'day', state });
  expect(full.kind).toBe('ack');
  const baseline = await (await fetch(url() + '/api/boxes/' + credentials.id)).json();
  await admin('minimum-version', '0.7.4');
  for (const clientVersion of [undefined, '0.7.3', '0.7.4-beta.1']) {
    const response = await fetch(url() + '/api/reports', { method: 'PUT', headers: { authorization: `Bearer ${credentials.token}` }, body: JSON.stringify({ id: credentials.id, clientVersion, state: { bad: true } }) });
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ accepted: false, ignored: true, upgradeRequired: true, error: expect.stringContaining('本次提交未成功') });
  }
  const ignored = await send({ protocol: 1, seq: 2, kind: 'delta', clientVersion: '0.7.3', phase: 'day', baseRevision: full.revision, changes: [{ op: 'replace', path: '/name', value: 'Must not persist' }] });
  expect(ignored).toMatchObject({ kind: 'error', status: 426, accepted: false, ignored: true });
  expect(await (await fetch(url() + '/api/boxes/' + credentials.id)).json()).toEqual(baseline);
  ws.terminate();
  const poll = async () => (await (await fetch(url() + '/api/announcements?id=' + credentials.id, { headers: { authorization: `Bearer ${credentials.token}` } })).json()).announcements;
  const notices = await poll();
  expect(notices.length).toBeGreaterThan(0);
  expect(notices.every((notice: { targets: string[]; text: string }) => notice.targets.length === 1 && notice.targets[0] === credentials.id && notice.text.includes('不要主动发送消息'))).toBe(true);
  expect((await (await fetch(url() + '/api/announcements/public')).json()).announcements).toEqual([]);
  await restart();
  await fetch(url() + '/api/reports', { method: 'PUT', headers: { authorization: `Bearer ${credentials.token}` }, body: JSON.stringify({ id: credentials.id, clientVersion: '0.7.3', state }) });
  expect(await poll()).toEqual(notices);
  expect((await report()).status).toBe(200);
  expect((await admin('controls')) as unknown).toMatchObject({ minimumClientVersion: { version: '0.7.4' } });
  await admin('minimum-version', 'off');
  expect((await fetch(url() + '/api/reports', { method: 'PUT', headers: { authorization: `Bearer ${credentials.token}` }, body: JSON.stringify({ id: credentials.id, state }) })).status).toBe(200);
  expect(before).toHaveProperty('state');
});

it('applies minimum version schedules at the exact boundary and preserves independent controls through edits and restarts', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const now = Date.now();
  const { admin, restart, dir } = await fixture();
  const at = new Date(now + 1000).toISOString();
  await admin('minimum-version', '0.7.4', '--at', at);
  await admin('http-push', 'off', '--at', at);
  await restart();
  vi.setSystemTime(now + 999);
  expect(await admin('controls')).toMatchObject({ httpPush: { enabled: true }, minimumClientVersion: { version: null, scheduledChange: { version: '0.7.4' } } });
  vi.setSystemTime(now + 1000);
  expect(await admin('controls')).toMatchObject({ httpPush: { enabled: false }, minimumClientVersion: { version: '0.7.4', scheduledChange: null } });
  await admin('http-push', 'on'); await restart();
  expect(await admin('controls')).toMatchObject({ httpPush: { enabled: true }, minimumClientVersion: { version: '0.7.4' } });
  await admin('minimum-version', 'off', '--at', new Date(now + 2000).toISOString());
  await admin('minimum-version', 'cancel'); await restart();
  expect(await admin('controls')).toMatchObject({ minimumClientVersion: { version: '0.7.4', scheduledChange: null } });
  expect(JSON.parse(await readFile(join(dir, 'controls.json'), 'utf8'))).toMatchObject({ minimumClientVersion: { version: '0.7.4' } });
});

it('compares version numbers numerically and treats unknown or prerelease clients below an equal stable floor', async () => {
  const { meetsMinimumVersion } = await import('../server/controls.ts');
  for (const value of ['0.7.4', '0.7.10', '1.0.0', '0.7.4+build.1', '0.8.0-beta.1']) expect(meetsMinimumVersion(value, '0.7.4')).toBe(true);
  for (const value of [undefined, 'invalid', '0.7.3', '0.7.4-rc.1', '0.6.99']) expect(meetsMinimumVersion(value, '0.7.4')).toBe(false);
  expect(meetsMinimumVersion(undefined, null)).toBe(true);
});

it('migrates old control files and rejects malformed minimum-version controls without changing either rule', async () => {
  const { admin, dir, url } = await fixture();
  const file = join(dir, 'old-controls.json');
  await writeFile(file, JSON.stringify({ httpPush: { enabled: false, scheduledChange: null } }));
  const store = new ControlStore(file); await store.restore();
  expect(store.get()).toMatchObject({ httpPush: { enabled: false }, minimumClientVersion: { version: null, scheduledChange: null } });
  const token = (await readFile(join(dir, 'admin-token'), 'utf8')).trim();
  const before = await admin('controls');
  for (const body of [{ version: '0.7' }, { version: '0.7.4-beta' }, { version: 7 }, { version: '0.7.4', extra: true }, {}, null]) {
    const response = await fetch(url() + '/api/admin/controls/minimum-client-version', { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    expect(response.status).toBe(400); expect(await admin('controls')).toEqual(before);
  }
  expect((await fetch(url() + '/api/admin/controls/minimum-client-version', { method: 'PUT', body: '{"version":"0.7.4"}' })).status).toBe(401);
});

it('delivers a protocol notice at capable WS connection, keeps operator lists empty and preserves legacy polling across restarts', async () => {
  const { url, admin, credentials, restart } = await fixture();
  await admin('minimum-version', '99.0.0');
  const connect = async (capable: boolean) => {
    const ws = new WebSocket(url().replace('http:', 'ws:') + '/api/reports/ws?id=' + credentials.id, { headers: { authorization: `Bearer ${credentials.token}`, 'x-cortico-client-version': '0.7.3', ...(capable ? { 'x-cortico-protocol-notices': '1' } : {}) } });
    return ws;
  };
  const first = await connect(true), incoming = once(first, 'message');
  const frame = JSON.parse(String((await incoming)[0])); first.terminate(); await once(first, 'close');
  expect(frame).toMatchObject({ kind: 'notice', notice: { targets: [credentials.id], title: '客户端需要升级', text: expect.stringContaining('99.0.0') } });
  expect(await admin('list')).toMatchObject({ announcements: [] });
  expect(await (await fetch(url() + '/api/announcements/public')).json()).toMatchObject({ announcements: [] });
  const poll = async (after = 0) => (await fetch(url() + '/api/announcements?id=' + credentials.id + '&after=' + after, { headers: { authorization: `Bearer ${credentials.token}` } })).json() as Promise<{ announcements: Array<{ id: number }>; nextCursor: number }>;
  const page = await poll(); expect(page.announcements).toEqual([frame.notice]); expect(page.nextCursor).toBe(frame.notice.id);
  await restart(); expect(await poll()).toEqual(page); expect((await poll(page.nextCursor)).announcements).toEqual([]);
  const legacy = await connect(false), messages: unknown[] = []; legacy.on('message', data => messages.push(JSON.parse(String(data)))); await once(legacy, 'open');
  const reply = once(legacy, 'message'); legacy.send(JSON.stringify({ protocol: 1, seq: 1, kind: 'full', clientVersion: '0.7.3', state: newState(Date.now()) }));
  expect(JSON.parse(String((await reply)[0]))).toMatchObject({ kind: 'error', ignored: true, upgradeRequired: true });
  expect(messages).toHaveLength(1); legacy.terminate(); await once(legacy, 'close');
  await admin('minimum-version', 'off'); expect((await poll()).announcements).toEqual([]);
});

it('paginates protocol and operator notices together without hiding any ordinary notices', async () => {
  const { url, admin, credentials } = await fixture();
  await admin('minimum-version', '99.0.0');
  for (let i = 0; i < 24; i++) await admin('publish', '--text', `ordinary-${i}`, '--to', credentials.id);
  const read = async (after: number) => (await fetch(url() + '/api/announcements?id=' + credentials.id + '&after=' + after, { headers: { authorization: `Bearer ${credentials.token}` } })).json() as Promise<{ announcements: Array<{ id: number; text: string }>; nextCursor: number }>;
  const a = await read(0), b = await read(a.nextCursor), c = await read(b.nextCursor);
  expect(a.announcements).toHaveLength(20); expect(b.announcements).toHaveLength(5); expect(c.announcements).toEqual([]);
  const all = [...a.announcements, ...b.announcements]; expect(new Set(all.map(value => value.id)).size).toBe(25);
  expect(all.filter(value => value.text.startsWith('ordinary-'))).toHaveLength(24);
  expect((await admin('list') as { announcements: unknown[] }).announcements).toHaveLength(24);
});


it('handles a socket notice independently from the rejected report acknowledgement and resumes after reopening', async () => {
  const { url, admin, credentials, state } = await fixture();
  await admin('minimum-version', '99.0.0');
  const received: number[] = [];
  const client = new ReportSocket({ url: new URL(url()), ...credentials, incremental: true, onNotice: async notice => { received.push(notice.id); } });
  try {
    await expect(client.report(state, 'day')).rejects.toThrow('提交内容已被忽略');
    expect(received).toHaveLength(1);
    await admin('minimum-version', 'off');
    await client.report(state, 'day');
    expect(await (await fetch(url() + '/api/boxes/' + credentials.id)).json()).toMatchObject({ state });
    expect(received).toHaveLength(1);
  } finally { client.close(); }
});

it('warns during a scheduled grace period while accepting reports, then rejects at the deadline', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const now = Date.now();
  const { url, admin, credentials, report } = await fixture();
  const at = new Date(now + 60_000).toISOString();
  await admin('minimum-version', '99.0.0', '--at', at);
  expect((await report()).status).toBe(200);
  const poll = async () => (await (await fetch(url() + '/api/announcements?id=' + credentials.id, { headers: { authorization: `Bearer ${credentials.token}` } })).json()).announcements;
  const advance = await poll();
  expect(advance).toHaveLength(1); expect(advance[0].text).toContain(at); expect(advance[0].text).toContain('期限前仍可');
  expect(await admin('list')).toMatchObject({ announcements: [] });
  vi.setSystemTime(now + 59_999); expect((await report()).status).toBe(200); expect(await poll()).toEqual(advance);
  vi.setSystemTime(now + 60_000); expect((await report()).status).toBe(426);
  const blocked = await poll(); expect(blocked).toHaveLength(1); expect(blocked[0].id).not.toBe(advance[0].id); expect(blocked[0].text).toContain('提交将被忽略');
});

it('retains native forum and logo controls when the legacy server updates its own transport policy', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-controls-rollback-')); disposals.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'controls.json');
  const native = { forum: { enabled: false, scheduledChange: { enabled: true, at: '2099-01-01T00:00:00Z' } }, logo: { version: '0.8.6', scheduledChange: { version: '0.8.7', at: '2099-01-01T00:00:00Z' } } };
  await writeFile(file, JSON.stringify({ ...native, httpPush: { enabled: true, scheduledChange: null }, minimumClientVersion: { version: null, scheduledChange: null } }));
  const store = new ControlStore(file); await store.restore(); await store.updateHttpPush({ enabled: false });
  expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject(native);
  const restarted = new ControlStore(file); await restarted.restore(); expect(restarted.get()).toMatchObject({ ...native, httpPush: { enabled: false } });
});
