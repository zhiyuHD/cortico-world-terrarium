import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import WebSocket from 'ws';
import { afterEach, expect, it } from 'vitest';
import { start } from '../server/index.ts';
import { adminNetwork } from '../server/admin-network.ts';
import { runAdmin } from '../server/admin.ts';
import { newState } from '../src/state.ts';
import { TERRARIUM_CLIENT_VERSION } from '../src/version.ts';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function reserve() {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const close = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return { server, port: address.port, close };
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-console-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const port = await reserve(); await port.close();
  const credentialsFile = join(dir, 'credentials.json'); await writeFile(credentialsFile, JSON.stringify({ first: 'box-token', second: 'other-token' }));
  await writeFile(join(dir, 'admin-token'), 'admin-secret', { mode: 0o600 });
  const options = { port: 0, adminHost: '127.0.0.1', adminPort: port.port, adminAllowedCidr: '127.0.0.1/32', dataFile: join(dir, 'leaderboard.json'), credentialsFile, adminToken: 'admin-secret' };
  const server = await start(options);
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const publicUrl = `http://127.0.0.1:${address.port}`, adminUrl = `http://127.0.0.1:${port.port}`;
  const admin = (path: string, method = 'GET', body?: unknown, headers = {}) => fetch(adminUrl + path, { method, headers: { authorization: 'Bearer admin-secret', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { dir, server, options, adminUrl, publicUrl, admin };
}
it('isolates console assets and admin operations from the public listener and requires credentials on the private API', async () => {
  const { dir, adminUrl, publicUrl, admin } = await fixture();
  for (const path of ['/api/admin/boxes', '/api/admin/controls', '/api/admin/feedback', '/api/admin/announcements', '/client.js', '/client.css']) expect((await fetch(publicUrl + path, { headers: { authorization: 'Bearer admin-secret' } })).status).toBe(404);
  expect((await fetch(publicUrl + '/')).status).toBe(200);
  const page = await fetch(adminUrl); expect(page.status).toBe(200); expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'"); expect(await page.text()).not.toContain('admin-secret');
  for (const path of ['/api/admin/boxes', '/api/admin/controls', '/api/admin/feedback', '/api/admin/announcements']) {
    expect((await fetch(adminUrl + path)).status).toBe(401); expect((await admin(path)).status).toBe(200);
  }
  expect((await fetch(adminUrl + '/api/registrations', { method: 'POST', body: '{}' })).status).toBe(404);
  expect((await admin('/api/admin/controls', 'GET', undefined, { origin: 'https://untrusted.invalid' })).status).toBe(403);
  const wrongHost = await new Promise<number>((resolve, reject) => { const req = request(adminUrl, { headers: { host: 'untrusted.invalid' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); }); req.on('error', reject); req.end(); });
  expect(wrongHost).toBe(403);
  const denied = await new Promise<number>((resolve, reject) => { const req = request(adminUrl, { localAddress: '127.0.0.2', headers: { 'x-forwarded-for': '127.0.0.1' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); }); req.on('error', reject); req.end(); });
  expect(denied).toBe(403);
  expect(await runAdmin(['controls', '--server', adminUrl, '--token-file', join(dir, 'admin-token')])).toMatchObject({ httpPush: { enabled: true, scheduledChange: null } });
});
it('tracks HTTP and WS reporting independently from live connections and omits box tokens and state', async () => {
  const { publicUrl, admin } = await fixture();
  const boxes = async () => (await (await admin('/api/admin/boxes')).json()).boxes;
  expect(await boxes()).toMatchObject([{ id: 'first', clientVersion: null, reportedAt: null, reportTransport: null, wsConnections: 0 }, { id: 'second', reportedAt: null }]);
  const state = newState(Date.now());
  expect((await fetch(publicUrl + '/api/reports', { method: 'PUT', headers: { authorization: 'Bearer box-token' }, body: JSON.stringify({ id: 'first', state }) })).status).toBe(200);
  expect((await boxes())[0]).toMatchObject({ clientVersion: null, reportTransport: 'http', wsConnections: 0 });
  const ws = new WebSocket(publicUrl.replace('http:', 'ws:') + '/api/reports/ws?id=first', { headers: { authorization: 'Bearer box-token' } });
  await once(ws, 'open');
  try {
    expect((await boxes())[0]).toMatchObject({ reportTransport: 'http', wsConnections: 1 });
    const reply = once(ws, 'message'); ws.send(JSON.stringify({ protocol: 1, seq: 1, kind: 'full', state, clientVersion: TERRARIUM_CLIENT_VERSION, coopanionVersion: '0.2.4', clientSystem: { name: 'Linux', version: 'TestOS 2 (kernel 6.12)' }, phase: 'day' }));
    expect(JSON.parse(String((await reply)[0])).kind).toBe('ack');
    const result = await boxes(); expect(result[0]).toMatchObject({ clientVersion: TERRARIUM_CLIENT_VERSION, coopanionVersion: '0.2.4', clientSystem: { name: 'Linux', version: 'TestOS 2 (kernel 6.12)' }, reportTransport: 'websocket', wsConnections: 1 });
    expect(JSON.stringify(result)).not.toMatch(/box-token|other-token|admin-secret|"state"/);
  } finally { const closed = once(ws, 'close'); ws.close(); await closed; }
  await expect.poll(async () => (await boxes())[0].wsConnections).toBe(0);
  expect((await boxes())[0].reportTransport).toBe('websocket');
});
it('supports targeted feedback replies, resolution and persisted cloud controls through the private listener', async () => {
  const { publicUrl, admin } = await fixture();
  const response = await fetch(publicUrl + '/api/feedback', { method: 'POST', headers: { authorization: 'Bearer box-token' }, body: JSON.stringify({ id: 'first', text: 'fixture feedback', source: 'ai' }) });
  const receipt = await response.json(); expect(response.status).toBe(201);
  expect((await (await admin('/api/admin/feedback')).json()).feedback[0]).toMatchObject({ id: receipt.id, boxId: 'first' });
  expect((await admin('/api/admin/announcements', 'POST', { title: 'Feedback reply', text: 'fixture reply', targets: ['first'] })).status).toBe(201);
  const notices = async (id: string, token: string) => (await (await fetch(publicUrl + `/api/announcements?id=${id}`, { headers: { authorization: `Bearer ${token}` } })).json()).announcements;
  expect(await notices('first', 'box-token')).toHaveLength(1); expect(await notices('second', 'other-token')).toHaveLength(0);
  expect((await (await fetch(publicUrl + '/api/announcements/public')).json()).announcements).toHaveLength(0);
  expect((await admin(`/api/admin/feedback/${receipt.id}/resolve`, 'POST')).status).toBe(200);
  expect((await (await admin('/api/admin/feedback')).json()).feedback[0].resolvedAt).toBeTruthy();
  const at = new Date(Date.now() + 60000).toISOString();
  expect(await (await admin('/api/admin/controls/http-push', 'PUT', { enabled: false, at })).json()).toMatchObject({ httpPush: { enabled: true, scheduledChange: { enabled: false, at } } });
});
it('rejects public bind addresses and enforces LAN source ranges', () => {
  for (const host of ['0.0.0.0', '8.8.8.8', 'localhost', '::']) expect(() => adminNetwork(host, '192.168.22.0/24')).toThrow();
  expect(() => adminNetwork('192.168.22.219', '192.168.23.0/24')).toThrow();
  const allowed = adminNetwork('192.168.22.219', '192.168.22.0/24');
  expect(allowed('192.168.22.236')).toBe(true); expect(allowed('::ffff:192.168.22.140')).toBe(true);
  expect(allowed('192.168.23.1')).toBe(false); expect(allowed('8.218.211.196')).toBe(false);
});
it('releases the private port when public startup fails and when the running service closes', async () => {
  const { options, adminUrl } = await fixture();
  await expect(start({ ...options, port: 0 })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  const occupied = await reserve(); cleanup.push(occupied.close);
  const adminPort = await reserve(); await adminPort.close();
  await expect(start({ ...options, port: occupied.port, adminPort: adminPort.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  const probe = createServer(); await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(adminPort.port, '127.0.0.1', resolve); });
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const dispose = cleanup.pop()!; await dispose(); // occupied public port
  const closeFixture = cleanup.pop()!; await closeFixture();
  await expect(fetch(adminUrl)).rejects.toThrow();
});
