import { AnnouncementStore } from './announcements.ts';
import { createServer } from 'node:http';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { migrateState, type TerrariumState } from '../src/state.ts';

import { validAquarium, type AquariumState } from '../src/aquarium.ts';
import { score, scoreParts, type LeaderboardBoxSummary } from '../src/scoring.ts';
export { score } from '../src/scoring.ts';

interface Entry { id: string; kind?: 'land' | 'water'; state: TerrariumState | AquariumState; phase?: 'day' | 'night'; score: number; reportedAt: string }
const idPattern = /^[a-z0-9][a-z0-9_-]{1,39}$/;
export interface ServerOptions { dataFile?: string; credentialsFile?: string; port?: number; announcementsFile?: string; adminToken?: string; adminTokenFile?: string }

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
        const input = JSON.parse(raw) as { id?: string; state?: unknown; phase?: string };
        let state: TerrariumState | AquariumState;
        try {
          if ((input.state as { kind?: string })?.kind === 'water') {
            if (!validAquarium(input.state)) throw new Error('Invalid aquarium');
            state = input.state;
          } else state = migrateState(input.state);
        }
        catch { reply(400, { error: 'Invalid report' }); return; }
        if (typeof input.id !== 'string' || !idPattern.test(input.id) || (input.phase !== undefined && input.phase !== 'day' && input.phase !== 'night')) { reply(400, { error: 'Invalid report' }); return; }
        const expected = credentials[input.id];
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (!expected || !equal(token, expected)) { reply(401, { error: 'Unauthorized' }); return; }
        const now = Date.now();
        if (state.updatedAtMs > now + 60000 || state.updatedAtMs < now - 31 * 86400000) { reply(400, { error: 'Invalid report time' }); return; }
        const id = input.id;
        const kind = 'fish' in state ? 'water' : 'land';
        const report = reportQueue.then(async () => {
          if (registry[id] && (registry[id].kind ?? 'land') !== kind) { reply(409, { error: 'Box habitat cannot change' }); return; }
          if (registry[id] && state.updatedAtMs < registry[id].state.updatedAtMs) { reply(409, { error: 'Stale report' }); return; }
          const next = Object.assign(Object.create(null), registry, { [id]: { id, kind, state, phase: input.phase, score: score(state), reportedAt: new Date(now).toISOString() } });
          await writeJson(file, next);
          registry = next;
          reply(200, { score: registry[id].score });
        });
        reportQueue = report.catch(() => {});
        await report;
        return;
      }
      reply(404, { error: 'Not found' });
    } catch (error) { reply(error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? 'Invalid JSON' : 'Request failed' }); }
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}
if (process.env.TERRARIUM_SERVER_MAIN === '1') void start();
