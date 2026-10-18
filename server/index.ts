import { FeedbackStore, FeedbackError } from './feedback.ts';
import { AnnouncementStore } from './announcements.ts';
import { createServer } from 'node:http';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { migrateState, type TerrariumState } from '../src/state.ts';
import { applyReportChanges, reportStateHash, validReportHash, validClientVersion, TERRARIUM_REPORT_MAX_BYTES, type ReportMessage, type ReportReply } from '../src/report-protocol.ts';

import { validAquarium, type AquariumState } from '../src/aquarium.ts';
import { score, scoreParts, type LeaderboardBoxSummary } from '../src/scoring.ts';
export { score } from '../src/scoring.ts';

interface Entry { id: string; kind?: 'land' | 'water'; state: TerrariumState | AquariumState; phase?: 'day' | 'night'; score: number; reportedAt: string; clientVersion?: string; coopanionVersion?: string; reportRevision?: string }
const idPattern = /^[a-z0-9][a-z0-9_-]{1,39}$/;
export interface ServerOptions { dataFile?: string; credentialsFile?: string; port?: number; announcementsFile?: string; adminToken?: string; adminTokenFile?: string }

class ReportError extends Error {
  constructor(readonly status: number, message: string, readonly resync = false) { super(message); }
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = file + '.tmp';
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, file);
}
export async function start(options: ServerOptions = {}): Promise<ReturnType<typeof createServer>> {
  const file = options.dataFile ?? process.env.TERRARIUM_DATA_FILE ?? './data/leaderboard.json';
  const feedback = new FeedbackStore(`${dirname(file)}/feedback.json`);
  await feedback.restore();
  const credentialsFile = options.credentialsFile ?? process.env.TERRARIUM_CREDENTIALS_FILE ?? './data/credentials.json';
  const announcements = new AnnouncementStore(options.announcementsFile ?? process.env.CORTICO_TERRARIUM_ANNOUNCEMENTS_FILE ?? `${dirname(file)}/announcements.json`);
  await announcements.restore();
  const adminTokenFile = options.adminTokenFile ?? process.env.CORTICO_TERRARIUM_ADMIN_TOKEN_FILE ?? `${dirname(file)}/admin-token`;
  let adminToken = options.adminToken ?? process.env.CORTICO_TERRARIUM_ADMIN_TOKEN;
  if (!adminToken) {
    try { adminToken = (await readFile(adminTokenFile, 'utf8')).trim(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      adminToken = randomBytes(32).toString('hex');
      await mkdir(dirname(adminTokenFile), { recursive: true });
      await writeFile(adminTokenFile, adminToken, { mode: 0o600, flag: 'wx' });
    }
    if (!adminToken) throw new Error('Empty announcement admin token');
  }
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  let registry: Record<string, Entry> = Object.create(null);
  let credentials: Record<string, string> = Object.create(null);
  let registrationQueue: Promise<unknown> = Promise.resolve();
  let reportQueue: Promise<unknown> = Promise.resolve();
  try { registry = Object.assign(Object.create(null), JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try { credentials = Object.assign(Object.create(null), JSON.parse(await readFile(credentialsFile, 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const page = await readFile(new URL('./index.html', import.meta.url));
  const sceneScript = await readFile(new URL('./scene.js', import.meta.url)).catch(async error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return readFile(new URL('../dist/scene.js', import.meta.url));
  });
  const commitReport = (id: string, input: { phase?: unknown; clientVersion?: unknown; coopanionVersion?: unknown; state?: unknown; baseRevision?: string; baseHash?: string; stateHash?: string; changes?: unknown }) => {
    const report = reportQueue.then(async () => {
      if ((input.phase !== undefined && input.phase !== 'day' && input.phase !== 'night') || (input.clientVersion !== undefined && !validClientVersion(input.clientVersion)) || (input.coopanionVersion !== undefined && !validClientVersion(input.coopanionVersion))) throw new ReportError(400, 'Invalid report metadata');
      let raw = input.state;
      if (input.baseRevision !== undefined) {
        if (!registry[id] || input.baseRevision !== registry[id].reportRevision) throw new ReportError(409, 'Full report required', true);
        if (input.baseHash !== undefined && input.baseHash !== reportStateHash(registry[id].state)) throw new ReportError(409, 'Report baseline checksum mismatch', true);
        try { raw = applyReportChanges(registry[id].state, input.changes); }
        catch { throw new ReportError(400, 'Invalid report changes'); }
      }
      let state: TerrariumState | AquariumState;
      try {
        if ((raw as { kind?: string })?.kind === 'water') {
          if (!validAquarium(raw)) throw new Error('Invalid aquarium');
          state = raw;
        } else state = migrateState(raw);
      } catch { throw new ReportError(400, 'Invalid report'); }
      if (input.stateHash !== undefined && input.stateHash !== reportStateHash(state)) throw new ReportError(409, 'Report state checksum mismatch', true);
      const now = Date.now();
      if (state.updatedAtMs > now + 60000 || state.updatedAtMs < now - 31 * 86400000) throw new ReportError(400, 'Invalid report time');
      const kind = 'fish' in state ? 'water' : 'land';
      if (registry[id] && (registry[id].kind ?? 'land') !== kind) throw new ReportError(409, 'Box habitat cannot change');
      if (registry[id] && state.updatedAtMs < registry[id].state.updatedAtMs) throw new ReportError(409, 'Stale report');
      const entry: Entry = { id, kind, state, phase: input.phase as Entry['phase'], score: score(state), reportedAt: new Date(now).toISOString(), reportRevision: randomBytes(16).toString('hex'), ...(input.clientVersion === undefined ? {} : { clientVersion: input.clientVersion as string }), ...(input.coopanionVersion === undefined ? {} : { coopanionVersion: input.coopanionVersion as string }) };
      const next = Object.assign(Object.create(null), registry, { [id]: entry });
      await writeJson(file, next);
      registry = next;
      return entry;
    });
    reportQueue = report.catch(() => {});
    return report;
  };
  const server = createServer(async (req, res) => {
    const reply = (status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(page); return;
      }
      if (req.method === 'GET' && path === '/scene.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(sceneScript); return;
      }
      if (req.method === 'GET' && path === '/health') { reply(200, { ok: true }); return; }
      if (path === '/api/feedback') {
        if (req.method !== 'POST') { reply(405, { error: 'Method not allowed' }); return; }
        let raw = '';
        for await (const chunk of req) { raw += String(chunk); if (Buffer.byteLength(raw) > 16384) { reply(413, { error: 'Feedback too large' }); return; } }
        const input = JSON.parse(raw) as { id?: unknown } | null;
        if (!input || typeof input !== 'object' || Array.isArray(input)) { reply(400, { error: 'Invalid feedback' }); return; }
        let boxId: string | undefined;
        if (input.id !== undefined || req.headers.authorization !== undefined) {
          if (typeof input.id !== 'string' || !Object.hasOwn(credentials, input.id) || !equal(req.headers.authorization?.replace(/^Bearer /, '') ?? '', credentials[input.id])) { reply(401, { error: 'Unauthorized' }); return; }
          boxId = input.id;
        }
        reply(201, await feedback.submit(input, boxId)); return;
      }
      if (path === '/api/admin/feedback' || path.startsWith('/api/admin/feedback/')) {
        if (!equal(req.headers.authorization?.replace(/^Bearer /, '') ?? '', adminToken)) { reply(401, { error: 'Unauthorized' }); return; }
        if (req.method === 'GET' && path === '/api/admin/feedback') {
          const after = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(after) || after < 0) { reply(400, { error: 'Invalid feedback cursor' }); return; }
          reply(200, feedback.list(after)); return;
        }
        if (req.method === 'POST' && /^\/api\/admin\/feedback\/[1-9][0-9]*\/resolve$/.test(path)) {
          const resolved = await feedback.resolve(Number(path.split('/').at(-2)));
          reply(resolved ? 200 : 404, { resolved }); return;
        }
        reply(405, { error: 'Method not allowed' }); return;
      }
      if (path === '/api/admin/announcements' || path.startsWith('/api/admin/announcements/')) {
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (!equal(token, adminToken)) { reply(401, { error: 'Unauthorized' }); return; }
        if (path === '/api/admin/announcements' && req.method === 'GET') { reply(200, { announcements: announcements.list() }); return; }
        if (path === '/api/admin/announcements' && req.method === 'POST') {
          let raw = '';
          for await (const chunk of req) { raw += String(chunk); if (Buffer.byteLength(raw) > 16384) { reply(413, { error: 'Announcement too large' }); return; } }
          let notice;
          try { notice = await announcements.publish(JSON.parse(raw), id => Object.hasOwn(credentials, id)); }
          catch (error) { if (error instanceof SyntaxError || (error instanceof Error && /^(Invalid announcement|Announcement capacity)/.test(error.message))) { reply(400, { error: (error as Error).message }); return; } throw error; }
          reply(201, notice); return;
        }
        if (req.method === 'DELETE' && /^\/api\/admin\/announcements\/[1-9][0-9]*$/.test(path)) {
          const removed = await announcements.revoke(Number(path.split('/').at(-1)));
          reply(removed ? 200 : 404, { removed }); return;
        }
        reply(405, { error: 'Method not allowed' }); return;
      }
      if (req.method === 'GET' && path === '/api/announcements/public') {
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
        if (query.get('view') === 'latest') { reply(200, announcements.latestPublic()); return; }
        const after = Number(query.get('after') ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) { reply(400, { error: 'Invalid announcement cursor' }); return; }
        reply(200, announcements.page(undefined, after)); return;
      }
      if (req.method === 'GET' && path === '/api/announcements') {
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const id = query.get('id') ?? '', token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        const expected = credentials[id];
        if (!expected || !equal(token, expected)) { reply(401, { error: 'Unauthorized' }); return; }
        const after = Number(query.get('after') ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) { reply(400, { error: 'Invalid announcement cursor' }); return; }
        reply(200, announcements.page(id, after)); return;
      }
      if (req.method === 'GET' && path === '/api/leaderboard') {
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const kind = query.get('kind');
        if (kind !== null && kind !== 'land' && kind !== 'water') { reply(400, { error: 'Invalid box kind' }); return; }
        const ranked = Object.values(registry).filter(entry => kind === null || (entry.kind ?? 'land') === kind).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
        if (query.get('view') === 'summary') {
          const limit = Number(query.get('limit') ?? 20), ownId = query.get('ownId');
          if (!kind || !Number.isInteger(limit) || limit < 1 || limit > 100 || (ownId !== null && !idPattern.test(ownId))) { reply(400, { error: 'Summary requires kind, limit 1..100 and a valid optional ownId' }); return; }
          const summarize = (entry: Entry, index: number): LeaderboardBoxSummary => ({ rank: index + 1, id: entry.id, name: entry.state.name, score: entry.score, scoreParts: scoreParts(entry.state), reportedAt: entry.reportedAt });
          const ownIndex = ranked.findIndex(entry => entry.id === ownId);
          reply(200, { habitat: kind, total: ranked.length, entries: ranked.slice(0, limit).map(summarize), own: ownIndex < 0 ? null : summarize(ranked[ownIndex], ownIndex) }); return;
        }
        reply(200, ranked.slice(0, 100)); return;
      }
      if (req.method === 'GET' && path.startsWith('/api/boxes/')) {
        const id = decodeURIComponent(path.slice('/api/boxes/'.length));
        reply(registry[id] ? 200 : 404, registry[id] ?? { error: 'Unknown box' }); return;
      }
      if (req.method === 'POST' && path === '/api/registrations') {
        let raw = '';
        for await (const chunk of req) {
          raw += String(chunk);
          if (Buffer.byteLength(raw) > 1024) { reply(413, { error: 'Registration too large' }); return; }
        }
        const input: unknown = JSON.parse(raw);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'id' && key !== 'kind')) { reply(400, { error: 'Invalid registration' }); return; }
        const requested = (input as { id?: unknown }).id;
        const kind = (input as { kind?: unknown }).kind;
        if (kind !== undefined && kind !== 'land' && kind !== 'water') { reply(400, { error: 'Invalid box kind' }); return; }
        if (requested !== undefined && (typeof requested !== 'string' || !idPattern.test(requested))) { reply(400, { error: 'Invalid box ID' }); return; }
        const register = registrationQueue.then(async () => {
          const id = typeof requested === 'string' ? requested : `box-${randomBytes(12).toString('hex')}`;
          if (Object.hasOwn(credentials, id) || Object.hasOwn(registry, id)) { reply(409, { error: 'Box ID is already registered; supply its token or choose another ID' }); return; }
          const token = randomBytes(32).toString('hex');
          const next = Object.assign(Object.create(null), credentials, { [id]: token });
          await writeJson(credentialsFile, next);
          credentials = next;
          reply(201, { id, token });
        });
        registrationQueue = register.catch(() => {});
        await register;
        return;
      }
      if (req.method === 'PUT' && path === '/api/reports') {
        let raw = '';
        for await (const chunk of req) {
          raw += String(chunk);
          if (Buffer.byteLength(raw) > 1048576) { reply(413, { error: 'Report too large' }); return; }
        }
        const input = JSON.parse(raw) as { id?: string; state?: unknown; phase?: unknown; clientVersion?: unknown; coopanionVersion?: unknown } | null;
        if (!input || typeof input.id !== 'string' || !idPattern.test(input.id)) { reply(400, { error: 'Invalid report' }); return; }
        const expected = credentials[input.id];
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (!expected || !equal(token, expected)) { reply(401, { error: 'Unauthorized' }); return; }
        const entry = await commitReport(input.id, { state: input.state, phase: input.phase, clientVersion: input.clientVersion, coopanionVersion: input.coopanionVersion });
        reply(200, { score: entry.score });
        return;
      }
      reply(404, { error: 'Not found' });
    } catch (error) { reply(error instanceof ReportError || error instanceof FeedbackError ? error.status : error instanceof SyntaxError ? 400 : 500, { error: error instanceof ReportError || error instanceof FeedbackError ? error.message : error instanceof SyntaxError ? 'Invalid JSON' : 'Request failed' }); }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: TERRARIUM_REPORT_MAX_BYTES, perMessageDeflate: false });
  const alive = new Set<WebSocket>();
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const id = url.searchParams.get('id') ?? '';
    const status = url.pathname !== '/api/reports/ws' ? 404
      : !idPattern.test(id) || !credentials[id] || !equal(req.headers.authorization?.replace(/^Bearer /, '') ?? '', credentials[id]) ? 401 : 0;
    if (status) { socket.end(`HTTP/1.1 ${status} ${status === 404 ? 'Not Found' : 'Unauthorized'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
    sockets.handleUpgrade(req, socket, head, ws => {
      alive.add(ws);
      ws.on('pong', () => alive.add(ws));
      ws.on('close', () => alive.delete(ws));
      ws.on('error', () => ws.terminate());
      let queue: Promise<unknown> = Promise.resolve(), requireFull = true, requireHashes = false, lastSeq = 0, queued = 0;
      ws.on('message', (raw, binary) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (++queued > 8) { ws.close(1008, 'Too many pending reports'); return; }
        const task = queue.then(async () => {
          let seq = 0;
          let reply: ReportReply;
          try {
            if (binary) throw new ReportError(400, 'Text reports required');
            const input = JSON.parse(raw.toString()) as ReportMessage;
            if (!input || !Number.isSafeInteger(input.seq) || input.seq <= lastSeq) throw new ReportError(400, 'Invalid report sequence');
            seq = input.seq; lastSeq = seq;
            if (input.protocol !== 1 || !validClientVersion(input.clientVersion) || !['day', 'night'].includes(input.phase) || !['full', 'delta'].includes(input.kind)) throw new ReportError(400, 'Client version and report protocol are required');
            requireHashes ||= input.stateHash !== undefined || (input.kind === 'delta' && input.baseHash !== undefined);
            if (requireHashes && (!validReportHash(input.stateHash) || (input.kind === 'delta' && !validReportHash(input.baseHash)))) throw new ReportError(409, 'Report checksums required', true);
            if (input.kind === 'delta' && (requireFull || typeof input.baseRevision !== 'string')) throw new ReportError(409, 'Full report required', true);
            const entry = await commitReport(id, { phase: input.phase, clientVersion: input.clientVersion, coopanionVersion: input.coopanionVersion, stateHash: input.stateHash, ...(input.kind === 'full' ? { state: input.state } : { baseRevision: input.baseRevision, baseHash: input.baseHash, changes: input.changes }) });
            requireFull = false;
            reply = { kind: 'ack', seq, revision: entry.reportRevision!, score: entry.score, stateHash: reportStateHash(entry.state) };
          } catch (error) {
            if (error instanceof ReportError && error.resync) { requireFull = true; reply = { kind: 'resync', seq }; }
            else reply = { kind: 'error', seq, status: error instanceof ReportError || error instanceof FeedbackError ? error.status : error instanceof SyntaxError ? 400 : 500, error: error instanceof ReportError || error instanceof FeedbackError ? error.message : error instanceof SyntaxError ? 'Invalid JSON' : 'Report failed' };
          }
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
        });
        queue = task.catch(() => ws.terminate()).finally(() => { queued--; });
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      if (!alive.delete(ws)) ws.terminate();
      else ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  const close = server.close.bind(server);
  server.close = (callback?: (error?: Error) => void) => {
    clearInterval(heartbeat);
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
    return close(callback);
  };
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}
if (process.env.TERRARIUM_SERVER_MAIN === '1') void start();
