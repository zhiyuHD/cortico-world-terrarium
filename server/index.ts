import { galleryPage } from './gallery.ts';
import { FeedbackStore, FeedbackError } from './feedback.ts';
import packageMetadata from '../package.json' with { type: 'json' };
import { ProtocolNotices } from './protocol-notices.ts';
import { AnnouncementStore } from './announcements.ts';
import { ControlStore, ControlError, meetsMinimumVersion } from './controls.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CONSOLE_ASSETS, historicalAsset, pinConsoleHtml } from './release-assets.ts';
import { validReleaseId } from './releases.ts';
import { createAdminServer } from './admin-network.ts';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { migrateState, type TerrariumState } from '../src/state.ts';
import { applyReportChanges, reportStateHash, validReportHash, validClientVersion, validClientSystem, type ClientSystem, TERRARIUM_REPORT_MAX_BYTES, type ReportMessage, type ReportReply } from '../src/report-protocol.ts';

import { validAquarium, type AquariumState } from '../src/aquarium.ts';
import { score, scoreParts, type LeaderboardBoxSummary } from '../src/scoring.ts';
export { score } from '../src/scoring.ts';

interface Entry { id: string; kind?: 'land' | 'water'; state: TerrariumState | AquariumState; phase?: 'day' | 'night'; score: number; reportedAt: string; clientVersion?: string; coopanionVersion?: string; clientSystem?: ClientSystem; reportRevision?: string; reportTransport?: 'http' | 'websocket' }
const idPattern = /^[a-z0-9][a-z0-9_-]{1,39}$/;
export interface ServerOptions { dataFile?: string; credentialsFile?: string; port?: number; announcementsFile?: string; controlsFile?: string; adminToken?: string; adminTokenFile?: string; adminHost?: string; adminPort?: number; adminAllowedCidr?: string }

class ReportError extends Error {
  constructor(readonly status: number, message: string, readonly resync = false, readonly ignored = false) { super(message); }
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
  const controls = new ControlStore(options.controlsFile ?? process.env.CORTICO_TERRARIUM_CONTROLS_FILE ?? `${dirname(file)}/controls.json`);
  await controls.restore();
  const feedback = new FeedbackStore(`${dirname(file)}/feedback.json`);
  await feedback.restore();
  const credentialsFile = options.credentialsFile ?? process.env.TERRARIUM_CREDENTIALS_FILE ?? './data/credentials.json';
  const announcements = new AnnouncementStore(options.announcementsFile ?? process.env.CORTICO_TERRARIUM_ANNOUNCEMENTS_FILE ?? `${dirname(file)}/announcements.json`);
  await announcements.restore();
  const protocols = new ProtocolNotices(`${dirname(file)}/protocol-notices.json`, () => announcements.allocateProtocolId());
  await protocols.restore();
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
  const adminHost = options.adminHost ?? process.env.CORTICO_TERRARIUM_ADMIN_HOST;
  const adminPort = options.adminPort ?? Number(process.env.CORTICO_TERRARIUM_ADMIN_PORT ?? 8788);
  const adminCidr = options.adminAllowedCidr ?? process.env.CORTICO_TERRARIUM_ADMIN_ALLOWED_CIDR ?? (adminHost ? `${adminHost}/32` : '127.0.0.1/32');
  const acceptedReports = { http: 0, websocket: 0 };
  const connections = new Map<string, Set<WebSocket>>();
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  let registry: Record<string, Entry> = Object.create(null);
  let credentials: Record<string, string> = Object.create(null);
  let registrationQueue: Promise<unknown> = Promise.resolve();
  let reportQueue: Promise<unknown> = Promise.resolve();
  try { registry = Object.assign(Object.create(null), JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const entry of Object.values(registry)) entry.score = score(entry.state);
  try { credentials = Object.assign(Object.create(null), JSON.parse(await readFile(credentialsFile, 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const releaseId = process.env.CORTICO_TERRARIUM_RELEASE_ID;
  const deploymentRoot = process.env.CORTICO_TERRARIUM_DEPLOY_ROOT;
  if (releaseId && !validReleaseId(releaseId)) throw new Error('Invalid server release ID');
  if (releaseId && !deploymentRoot) throw new Error('Managed releases require CORTICO_TERRARIUM_DEPLOY_ROOT');
  const page = await readFile(new URL('./index.html', import.meta.url));
  const sceneScript = await readFile(new URL('./scene.js', import.meta.url)).catch(async error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return readFile(new URL('../dist/scene.js', import.meta.url));
  });
  const upgradeNotice = async (id: string, client: { version?: string; transport: 'http' | 'websocket' } | undefined = protocols.client(id)) => {
    if (!client) return;
    const control = controls.get(), minimum = control.minimumClientVersion.version;
    const obsolete = !meetsMinimumVersion(client.version, minimum);
    if (!(client.transport === 'http' && !control.httpPush.enabled) && !obsolete) {
      const floor = control.minimumClientVersion.scheduledChange, http = control.httpPush.scheduledChange;
      const deadlines = [floor && !meetsMinimumVersion(client.version, floor.version) ? `${floor.at} 起最低版本将为 ${floor.version}` : '', client.transport === 'http' && http && !http.enabled ? `${http.at} 起 HTTP Push 将停止接收` : ''].filter(Boolean);
      if (!deadlines.length) return;
      return protocols.notice(id, `升级预告：${deadlines.join('；')}。期限前仍可按现行规则提交，请在宽限期内升级。只需在主人下次与你交谈时顺带提及，不要主动发送消息。`, JSON.stringify({ floor, http }));
    }
    const text = `当前客户端不满足上报要求，提交将被忽略，无法更新服务端存档和排行榜。${client.transport === 'http' && !control.httpPush.enabled ? 'HTTP Push 已停止接收内容，请改用 WebSocket Push。' : ''}${obsolete ? `客户端版本 ${client.version ?? '未上报或无效'} 低于最低要求 ${minimum}。` : ''}必须升级 cortico-world-terrarium 到最新版本才能继续提交内容。只需在主人下次与你交谈时顺带说明升级要求，不要主动发送消息。`;
    return protocols.notice(id, text, JSON.stringify({ minimum, httpPush: control.httpPush.enabled }));
  };
  const rejectReport = async (id: string, clientVersion: unknown, transport: 'http' | 'websocket'): Promise<void> => {
    await protocols.observe(id, clientVersion, transport);
    const notice = await upgradeNotice(id, { version: validClientVersion(clientVersion) ? clientVersion : undefined, transport });
    const control = controls.get(), obsolete = !meetsMinimumVersion(clientVersion, control.minimumClientVersion.version);
    if (notice && (obsolete || (transport === 'http' && !control.httpPush.enabled))) throw new ReportError(obsolete ? 426 : 410, `本次提交未成功，提交内容已被忽略。${notice.text}`, false, true);
  };
  const commitReport = (id: string, input: { phase?: unknown; clientVersion?: unknown; coopanionVersion?: unknown; clientSystem?: unknown; state?: unknown; baseRevision?: string; baseHash?: string; stateHash?: string; changes?: unknown }, transport: 'http' | 'websocket') => {
    const report = reportQueue.then(async () => {
      await rejectReport(id, input.clientVersion, transport);
      if ((input.phase !== undefined && input.phase !== 'day' && input.phase !== 'night') || (input.clientVersion !== undefined && !validClientVersion(input.clientVersion)) || (input.coopanionVersion !== undefined && !validClientVersion(input.coopanionVersion))) throw new ReportError(400, 'Invalid report metadata');
      if (input.clientSystem !== undefined && !validClientSystem(input.clientSystem)) throw new ReportError(400, 'Invalid report metadata');
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
      if (state.updatedAtMs > now + 60000 || state.updatedAtMs < now - 31 * 86400000) throw new ReportError(400, `Invalid report time: stateUpdatedAtMs=${state.updatedAtMs}, serverAtMs=${now}; allowed age <= 31 days and future offset <= 60000 ms`);
      const kind = 'fish' in state ? 'water' : 'land';
      if (registry[id] && (registry[id].kind ?? 'land') !== kind) throw new ReportError(409, 'Box habitat cannot change');
      if (registry[id] && state.updatedAtMs < registry[id].state.updatedAtMs) throw new ReportError(409, 'Stale report');
      const entry: Entry = { id, kind, state, reportTransport: transport, phase: input.phase as Entry['phase'], score: score(state), reportedAt: new Date(now).toISOString(), reportRevision: randomBytes(16).toString('hex'), ...(input.clientVersion === undefined ? {} : { clientVersion: input.clientVersion as string }), ...(input.coopanionVersion === undefined ? {} : { coopanionVersion: input.coopanionVersion as string }), ...(input.clientSystem === undefined ? {} : { clientSystem: input.clientSystem as ClientSystem }) };
      const next = Object.assign(Object.create(null), registry, { [id]: entry });
      await writeJson(file, next);
      registry = next; acceptedReports[transport]++;
      return entry;
    });
    reportQueue = report.catch(() => {});
    return report;
  };
  const handleRequest = async (req: IncomingMessage, res: ServerResponse, privateAdmin = false) => {
    const reply = (status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (!privateAdmin && adminHost && path.startsWith('/api/admin/')) { reply(404, { error: 'Not found' }); return; }
      if (deploymentRoot && path.startsWith('/releases/')) {
        const asset = req.method === 'GET' ? await historicalAsset(deploymentRoot, path, privateAdmin) : undefined;
        if (!asset) { reply(404, { error: 'Not found' }); return; }
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }); res.end(asset.bytes); return;
      }
      if (privateAdmin && !path.startsWith('/api/admin/')) {
        const asset = CONSOLE_ASSETS[path];
        if (req.method !== 'GET' || !asset) { reply(404, { error: 'Not found' }); return; }
        const content = await readFile(new URL(`./console/${asset[0]}`, import.meta.url)).catch(async error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          return readFile(new URL(`../dist/console/${asset[0]}`, import.meta.url));
        });
        res.writeHead(200, { 'content-type': asset[1], 'cache-control': asset[1] === 'font/woff2' ? 'private, max-age=86400' : 'no-store' }); res.end(asset[0] === 'index.html' ? pinConsoleHtml(content, releaseId) : content); return;
      }
      if (path === '/api/admin/boxes') {
        if (!equal(req.headers.authorization?.replace(/^Bearer /, '') ?? '', adminToken)) { reply(401, { error: 'Unauthorized' }); return; }
        if (req.method !== 'GET') { reply(405, { error: 'Method not allowed' }); return; }
        const boxes = [...new Set([...Object.keys(credentials), ...Object.keys(registry)])].map(id => {
          const entry = registry[id];
          return { id, registered: Object.hasOwn(credentials, id), name: entry?.state.name ?? id, kind: entry ? entry.kind ?? 'land' : null, score: entry?.score ?? null, reportedAt: entry?.reportedAt ?? null, clientVersion: entry?.clientVersion ?? null, coopanionVersion: entry?.coopanionVersion ?? null, clientSystem: entry?.clientSystem ?? null, reportTransport: entry?.reportTransport ?? null, wsConnections: connections.get(id)?.size ?? 0 };
        });
        reply(200, { boxes, serverAt: new Date().toISOString(), uptimeSec: process.uptime(), memoryBytes: process.memoryUsage().rss, acceptedReports }); return;
      }
      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(releaseId ? page.toString().replace('./scene.js?v=dark-mode', `/releases/${releaseId}/scene.js`) : page); return;
      }
      if (req.method === 'GET' && path === '/scene.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(sceneScript); return;
      }
      if (req.method === 'GET' && path === '/health') {
        const control = controls.get();
        reply(200, { ok: true, version: packageMetadata.version, websocketPush: true, httpPushEnabled: control.httpPush.enabled, minimumClientVersion: control.minimumClientVersion.version, ...(process.env.CORTICO_TERRARIUM_RELEASE_ID ? { releaseId: process.env.CORTICO_TERRARIUM_RELEASE_ID } : {}) }); return;
      }
      if (path === '/api/admin/controls' || path === '/api/admin/controls/http-push' || path === '/api/admin/controls/minimum-client-version') {
        if (!equal(req.headers.authorization?.replace(/^Bearer /, '') ?? '', adminToken)) { reply(401, { error: 'Unauthorized' }); return; }
        if (path === '/api/admin/controls' && req.method === 'GET') { reply(200, controls.get()); return; }
        if (path !== '/api/admin/controls' && req.method === 'PUT') {
          let raw = '';
          for await (const chunk of req) { raw += String(chunk); if (Buffer.byteLength(raw) > 1024) { reply(413, { error: 'Control too large' }); return; } }
          reply(200, await (path.endsWith('/http-push') ? controls.updateHttpPush(JSON.parse(raw)) : controls.updateMinimumClientVersion(JSON.parse(raw)))); return;
        }
        reply(405, { error: 'Method not allowed' }); return;
      }
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
        if (!protocols.client(id)) await protocols.observe(id, registry[id]?.clientVersion, registry[id]?.reportTransport === 'http' ? 'http' : 'websocket');
        const notice = await upgradeNotice(id), page = announcements.page(id, after);
        const visible = [...page.announcements, ...(notice && notice.id > after ? [notice] : [])].sort((a, b) => a.id - b.id);
        const batch = visible.slice(0, 20);
        reply(200, { announcements: batch, nextCursor: visible.length > 20 ? batch.at(-1)!.id : page.nextCursor }); return;
      }
      if (req.method === 'GET' && path === '/api/leaderboard') {
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const kind = query.get('kind');
        if (kind !== null && kind !== 'land' && kind !== 'water') { reply(400, { error: 'Invalid box kind' }); return; }
        const ranked = Object.values(registry).filter(entry => kind === null || (entry.kind ?? 'land') === kind).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
        if (query.get('view') === 'gallery') {
          if (!kind) { reply(400, { error: 'Gallery requires a box kind' }); return; }
          try { reply(200, galleryPage(ranked, query)); }
          catch (error) { reply(400, { error: (error as Error).message }); }
          return;
        }
        if (query.get('view') === 'summary') {
          const limit = Number(query.get('limit') ?? 20), ownId = query.get('ownId');
          if (!kind || !Number.isInteger(limit) || limit < 1 || limit > 100 || (ownId !== null && !idPattern.test(ownId))) { reply(400, { error: 'Summary requires kind, limit 1..100 and a valid optional ownId' }); return; }
          const summarize = (entry: Entry, index: number): LeaderboardBoxSummary => ({ rank: index + 1, competitiveRank: ranked.findIndex(other => other.score === entry.score) + 1, id: entry.id, name: entry.state.name, score: entry.score, scoreParts: scoreParts(entry.state), reportedAt: entry.reportedAt });
          const ownIndex = ranked.findIndex(entry => entry.id === ownId);
          reply(200, { habitat: kind, total: ranked.length, entries: ranked.slice(0, limit).map(summarize), own: ownIndex < 0 ? null : summarize(ranked[ownIndex], ownIndex) }); return;
        }
        reply(200, ranked.slice(0, 100)); return;
      }
      if (req.method === 'GET' && path.startsWith('/api/boxes/')) {
        const id = decodeURIComponent(path.slice('/api/boxes/'.length));
        const entry = registry[id];
        const replayOnly = new URL(req.url ?? '/', 'http://localhost').searchParams.get('view') === 'replays';
        reply(entry ? 200 : 404, entry ? replayOnly ? { replays: entry.state.replays ?? [] } : entry : { error: 'Unknown box' }); return;
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
        const control = controls.get().httpPush;
        if (control.scheduledChange?.enabled === false) res.setHeader('Sunset', new Date(control.scheduledChange.at).toUTCString());
        let raw = '';
        for await (const chunk of req) {
          raw += String(chunk);
          if (Buffer.byteLength(raw) > TERRARIUM_REPORT_MAX_BYTES) { reply(413, { error: 'Report too large' }); return; }
        }
        const input = JSON.parse(raw) as { id?: string; state?: unknown; phase?: unknown; clientVersion?: unknown; coopanionVersion?: unknown; clientSystem?: unknown } | null;
        if (!input || typeof input.id !== 'string' || !idPattern.test(input.id)) { reply(400, { error: 'Invalid report' }); return; }
        const expected = credentials[input.id];
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (!expected || !equal(token, expected)) { reply(401, { error: 'Unauthorized' }); return; }
        const entry = await commitReport(input.id, { state: input.state, phase: input.phase, clientVersion: input.clientVersion, coopanionVersion: input.coopanionVersion, clientSystem: input.clientSystem }, 'http');
        reply(200, { score: entry.score });
        return;
      }
      reply(404, { error: 'Not found' });
    } catch (error) { reply(error instanceof ReportError || error instanceof FeedbackError ? error.status : error instanceof SyntaxError || error instanceof ControlError ? 400 : 500, { error: error instanceof ReportError || error instanceof FeedbackError || error instanceof ControlError ? error.message : error instanceof SyntaxError ? 'Invalid JSON' : 'Request failed', ...(error instanceof ReportError && error.ignored ? { accepted: false, ignored: true, upgradeRequired: true } : {}) }); }
  };
  const server = createServer((req, res) => { void handleRequest(req, res); });
  const adminServer = adminHost ? createAdminServer(adminHost, adminCidr, (req, res) => { void handleRequest(req, res, true); }) : undefined;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: TERRARIUM_REPORT_MAX_BYTES, perMessageDeflate: false });
  const alive = new Set<WebSocket>();
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const id = url.searchParams.get('id') ?? '';
    const status = url.pathname !== '/api/reports/ws' ? 404
      : !idPattern.test(id) || !credentials[id] || !equal(req.headers.authorization?.replace(/^Bearer /, '') ?? '', credentials[id]) ? 401 : 0;
    if (status) { socket.end(`HTTP/1.1 ${status} ${status === 404 ? 'Not Found' : 'Unauthorized'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
    sockets.handleUpgrade(req, socket, head, ws => {
      const versionHeader = req.headers['x-cortico-client-version'];
      const connectionNotice = async () => {
        await protocols.observe(id, versionHeader ?? registry[id]?.clientVersion, 'websocket');
        const notice = await upgradeNotice(id);
        if (notice && req.headers['x-cortico-protocol-notices'] === '1' && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ kind: 'notice', notice }));
      };
      const connected = connectionNotice();
      void connected.catch(() => ws.terminate());
      const group = connections.get(id) ?? new Set<WebSocket>();
      group.add(ws); connections.set(id, group);
      alive.add(ws);
      ws.on('pong', () => alive.add(ws));
      ws.on('close', () => { alive.delete(ws); group.delete(ws); if (!group.size) connections.delete(id); });
      ws.on('error', () => ws.terminate());
      let queue: Promise<unknown> = connected, requireFull = true, requireHashes = false, lastSeq = 0, queued = 0;
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
            await rejectReport(id, input.clientVersion, 'websocket');
            if (input.protocol !== 1 || !validClientVersion(input.clientVersion) || !['day', 'night'].includes(input.phase) || !['full', 'delta'].includes(input.kind)) throw new ReportError(400, 'Client version and report protocol are required');
            requireHashes ||= input.stateHash !== undefined || (input.kind === 'delta' && input.baseHash !== undefined);
            if (requireHashes && (!validReportHash(input.stateHash) || (input.kind === 'delta' && !validReportHash(input.baseHash)))) throw new ReportError(409, 'Report checksums required', true);
            if (input.kind === 'delta' && (requireFull || typeof input.baseRevision !== 'string')) throw new ReportError(409, 'Full report required', true);
            const entry = await commitReport(id, { phase: input.phase, clientVersion: input.clientVersion, coopanionVersion: input.coopanionVersion, clientSystem: input.clientSystem, stateHash: input.stateHash, ...(input.kind === 'full' ? { state: input.state } : { baseRevision: input.baseRevision, baseHash: input.baseHash, changes: input.changes }) }, 'websocket');
            requireFull = false;
            reply = { kind: 'ack', seq, revision: entry.reportRevision!, score: entry.score, stateHash: reportStateHash(entry.state) };
          } catch (error) {
            if (error instanceof ReportError && error.resync) { requireFull = true; reply = { kind: 'resync', seq }; }
            else reply = { kind: 'error', seq, status: error instanceof ReportError || error instanceof FeedbackError ? error.status : error instanceof SyntaxError ? 400 : 500, error: error instanceof ReportError || error instanceof FeedbackError ? error.message : error instanceof SyntaxError ? 'Invalid JSON' : 'Report failed', ...(error instanceof ReportError && error.ignored ? { accepted: false, ignored: true, upgradeRequired: true } : {}) };
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
    const pending = [new Promise<void>((resolve, reject) => { close(error => error ? reject(error) : resolve()); })];
    if (adminServer?.listening) pending.push(new Promise<void>((resolve, reject) => { adminServer.close(error => error ? reject(error) : resolve()); }));
    void Promise.all(pending).then(() => callback?.(), error => callback?.(error));
    return server;
  };
  const listen = (target: ReturnType<typeof createServer>, targetPort: number, host: string) => new Promise<void>((resolve, reject) => {
    target.once('error', reject); target.listen(targetPort, host, () => { target.off('error', reject); resolve(); });
  });
  try {
    if (adminServer) await listen(adminServer, adminPort, adminHost!);
    await listen(server, port, '127.0.0.1');
  } catch (error) {
    clearInterval(heartbeat); sockets.close();
    if (adminServer?.listening) await new Promise<void>(resolve => { adminServer.close(() => resolve()); });
    throw error;
  }
  return server;
}
if (process.env.TERRARIUM_SERVER_MAIN === '1') void start();
