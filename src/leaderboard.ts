import { TERRARIUM_DEFAULTS } from './config.ts';
import type { Announcement } from './announcements.ts';
import { parseFeedback, type TerrariumFeedbackReceipt } from './feedback.ts';
import { validAnnouncement, type AnnouncementPage } from './announcements.ts';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ReportSocket, ReportSocketError } from './report-socket.ts';
import { TERRARIUM_CLIENT_VERSION, reportClientMetadata } from './version.ts';
import type { AquariumState } from './aquarium.ts';
import type { TerrariumState } from './state.ts';
import type { LeaderboardBoxSummary, LeaderboardSummary, ScoreParts } from './scoring.ts';

interface Credentials { id: string; token: string }
/** Report history belongs to this process; success means the server acknowledged a snapshot. */
export interface TerrariumSyncStatus {
  state: 'disabled' | 'idle' | 'syncing' | 'synced' | 'error';
  mode: 'full' | 'incremental';
  transport?: 'ws' | 'http';
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  nextRetryAt?: string;
}
export interface LeaderboardClientOptions {
  url: string; id: string; token?: string; credentialsFile: string; kind?: 'land' | 'water'; incrementalReports?: boolean;
  /** New registrations omit id; existing id/token options only select credentials to migrate. */
  automaticIds?: boolean;
  requestTimeoutMs?: number;
  onNotice?: (notice: Announcement) => Promise<void>;
}

export class LeaderboardClient {
  private credentials: Credentials | undefined;
  private authorizing: Promise<Credentials> | undefined;
  private reportSocket: ReportSocket | undefined;
  private reportQueue: Promise<unknown> = Promise.resolve();
  private httpFallbackUntilMs = 0;
  private syncStatus: TerrariumSyncStatus;

  constructor(private readonly options: LeaderboardClientOptions) {
    this.syncStatus = { state: options.url ? 'idle' : 'disabled', mode: options.incrementalReports ? 'incremental' : 'full', consecutiveFailures: 0 };
  }

  status(): TerrariumSyncStatus { return { ...this.syncStatus }; }

  get id(): string | undefined { return this.credentials?.id ?? (!this.options.automaticIds && this.options.token ? this.options.id : undefined); }

  async feedback(value: unknown, source: 'world' | 'ai'): Promise<TerrariumFeedbackReceipt> {
    const input = parseFeedback(value);
    if (!this.options.url) throw new Error('Feedback is unavailable; configure worlds.terrarium.leaderboardUrl');
    const url = new URL('/api/feedback', this.options.url);
    requireHttps(url);
    const credentials = this.id ? await this.authorize(url) : undefined;
    const response = await this.request(url, 'POST', { ...input, source, clientVersion: TERRARIUM_CLIENT_VERSION, ...(credentials ? { id: credentials.id } : {}) }, credentials?.token);
    if (response.status === 404 || response.status === 405) throw new Error('This server does not support feedback; upgrade the server');
    if (response.status === 429) throw new Error('Feedback limit reached; retry after one minute');
    if (response.status !== 201) throw new Error(`Feedback HTTP ${response.status}`);
    const result = parseJson(response.body) as TerrariumFeedbackReceipt;
    if (!result || !Number.isSafeInteger(result.id) || result.id < 1 || typeof result.createdAt !== 'string' || !Number.isFinite(Date.parse(result.createdAt))) throw new Error('Invalid feedback receipt');
    return { id: result.id, createdAt: result.createdAt };
  }

  async leaderboard(limit: number): Promise<LeaderboardSummary> {
    if (!this.options.url) throw new Error('Leaderboard is disabled; configure worlds.terrarium.leaderboardUrl');
    const url = new URL('/api/leaderboard', this.options.url);
    requireHttps(url);
    const habitat = this.options.kind ?? 'land';
    url.searchParams.set('kind', habitat); url.searchParams.set('view', 'summary'); url.searchParams.set('limit', String(limit));
    if (this.id) url.searchParams.set('ownId', this.id);
    const response = await this.request(url, 'GET', undefined, undefined, 262144);
    if (response.status !== 200) throw new Error(`Leaderboard read HTTP ${response.status}`);
    return parseLeaderboard(parseJson(response.body), habitat, limit, this.id);
  }

  async announcements(after: number): Promise<AnnouncementPage> {
    if (!this.options.url) return { announcements: [], nextCursor: after };
    const url = new URL(this.id ? '/api/announcements' : '/api/announcements/public', this.options.url);
    requireHttps(url);
    const credentials = this.id ? await this.authorize(url) : undefined;
    if (credentials) url.searchParams.set('id', credentials.id);
    url.searchParams.set('after', String(after));
    const response = await this.request(url, 'GET', undefined, credentials?.token, 262144);
    // Older servers have no announcement endpoint; reporting and rankings remain available.
    if (response.status === 404 || response.status === 405) return { announcements: [], nextCursor: after };
    if (response.status !== 200) throw new Error(`Announcements read HTTP ${response.status}`);
    const value = parseJson(response.body) as AnnouncementPage;
    if (!value || !Number.isSafeInteger(value.nextCursor) || value.nextCursor < after || !Array.isArray(value.announcements) || value.announcements.length > 20 || !value.announcements.every((notice, index) => validAnnouncement(notice) && notice.id > after && notice.id <= value.nextCursor && (index === 0 || notice.id > value.announcements[index - 1].id) && (notice.targets === 'all' || (credentials !== undefined && notice.targets.includes(credentials.id))))) throw new Error('Invalid announcements response');
    return value;
  }

  async claim(): Promise<string | undefined> {
    if (!this.options.url) return undefined;
    return (await this.authorize(new URL(this.options.url))).id;
  }

  async restore(): Promise<void> {
    if (!this.options.url || this.credentials || (!this.options.automaticIds && this.options.token)) return;
    const url = new URL(this.options.url);
    this.credentials = (await this.restoreCredentials(url)).credentials;
  }

  private key(url: URL): string { return `${url.origin}/${this.options.kind === 'water' ? 'water/' : ''}${!this.options.automaticIds && this.options.id ? `id/${this.options.id}` : 'auto'}`; }

  private async saveCredentials(saved: Record<string, Credentials>): Promise<void> {
    await mkdir(dirname(this.options.credentialsFile), { recursive: true });
    const temporary = `${this.options.credentialsFile}.tmp`;
    await writeFile(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 });
    await rename(temporary, this.options.credentialsFile);
  }

  private async restoreCredentials(url: URL): Promise<{ saved: Record<string, Credentials>; credentials?: Credentials }> {
    let saved: Record<string, Credentials> = Object.create(null);
    try {
      const value: unknown = parseJson(await readFile(this.options.credentialsFile, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid leaderboard credentials file');
      saved = Object.assign(Object.create(null), value);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const key = this.key(url);
    if (saved[key]) return { saved, credentials: parseCredentials(saved[key], this.options.automaticIds ? '' : this.options.id) };
    if (!this.options.automaticIds) return { saved };
    const prefix = `${url.origin}/${this.options.kind === 'water' ? 'water/' : ''}id/`;
    const legacyKey = prefix + this.options.id;
    const candidates = Object.keys(saved).filter(candidate => candidate.startsWith(prefix));
    let credentials: Credentials | undefined;
    if (this.options.token) credentials = parseCredentials({ id: this.options.id, token: this.options.token }, this.options.id);
    else if (saved[legacyKey]) credentials = parseCredentials(saved[legacyKey], this.options.id);
    else if (candidates.length === 1) credentials = parseCredentials(saved[candidates[0]], candidates[0].slice(prefix.length));
    else if (candidates.length > 1) throw new Error('Multiple saved leaderboard identities; select the existing box in report-credentials.json by copying its credentials to the server auto key before restarting.');
    if (credentials) { saved[key] = credentials; await this.saveCredentials(saved); }
    return { saved, credentials };
  }

  close(): void { this.reportSocket?.close(); this.reportSocket = undefined; }

  report(state: TerrariumState | AquariumState, phase: 'day' | 'night', full = false): Promise<void> {
    if (!this.options.url) return Promise.resolve();
    const snapshot = JSON.parse(JSON.stringify(state)) as TerrariumState | AquariumState;
    const result = this.reportQueue.then(async () => {
      if (!full && this.syncStatus.nextRetryAt && Date.now() < Date.parse(this.syncStatus.nextRetryAt)) return;
      if (full) this.close();
      this.syncStatus.state = 'syncing';
      this.syncStatus.lastAttemptAt = new Date().toISOString();
      try {
        const transport = await this.deliver(snapshot, phase);
        this.syncStatus = { ...this.syncStatus, state: 'synced', transport, lastSuccessAt: new Date().toISOString(), lastError: undefined, nextRetryAt: undefined, consecutiveFailures: 0 };
      } catch (error) {
        this.syncStatus.state = 'error';
        this.syncStatus.lastError = error instanceof Error ? error.message : String(error);
        this.syncStatus.consecutiveFailures++;
        this.syncStatus.nextRetryAt = new Date(Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(4, this.syncStatus.consecutiveFailures - 1))).toISOString();
        throw error;
      }
    });
    this.reportQueue = result.catch(() => {});
    return result;
  }

  private async deliver(state: TerrariumState | AquariumState, phase: 'day' | 'night'): Promise<'ws' | 'http'> {
    const url = new URL(this.options.url);
    requireHttps(url);
    const credentials = await this.authorize(url);
    if (Date.now() >= this.httpFallbackUntilMs) {
      this.reportSocket ??= new ReportSocket({ url, ...credentials, incremental: this.options.incrementalReports === true, timeoutMs: this.options.requestTimeoutMs, onNotice: this.options.onNotice });
      try { await this.reportSocket.report(state, phase); return 'ws'; }
      catch (error) {
        if (!(error instanceof ReportSocketError) || ![404, 405, 426, 501].includes(error.status ?? 0)) throw error;
        // Compatibility fallback for servers without the WebSocket report endpoint.
        this.close(); this.httpFallbackUntilMs = Date.now() + 5 * 60_000;
      }
    }
    const response = await this.request(new URL('/api/reports', url), 'PUT', { id: credentials.id, state, phase, ...reportClientMetadata() }, credentials.token);
    if (response.status < 200 || response.status >= 300) throw new Error(`Leaderboard report HTTP ${response.status}`);
    return 'http';
  }

  private request(url: URL, method: string, value: unknown, token?: string, maxResponseBytes = 16384) {
    return request(url, method, value, token, maxResponseBytes, this.options.requestTimeoutMs ?? TERRARIUM_DEFAULTS.requestTimeoutMs!);
  }

  private async authorize(url: URL): Promise<Credentials> {
    requireHttps(url);
    if (!this.authorizing) this.authorizing = this.authorizeOnce(url).finally(() => { this.authorizing = undefined; });
    return this.authorizing;
  }

  private async authorizeOnce(url: URL): Promise<Credentials> {
    if (!this.options.automaticIds && this.options.id && !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(this.options.id)) throw new Error('Invalid leaderboard box ID');
    if (!this.options.automaticIds && this.options.token) {
      if (!this.options.id) throw new Error('A configured report token requires a box ID');
      return { id: this.options.id, token: this.options.token };
    }
    if (this.credentials) return this.credentials;
    const key = this.key(url);
    const { saved, credentials: existing } = await this.restoreCredentials(url);
    if (existing) {
      this.credentials = existing;
      return existing;
    }
    const requested = this.options.automaticIds ? '' : this.options.id;
    const response = await this.request(new URL('/api/registrations', url), 'POST', { ...(requested ? { id: requested } : {}), kind: this.options.kind ?? 'land' });
    if (response.status === 409) throw new Error('Box ID is already registered; supply its token or choose another ID');
    if (response.status !== 201) {
      let reason = '';
      try {
        const value = parseJson(response.body) as { error?: unknown } | null;
        if (typeof value?.error === 'string' && ['Invalid registration', 'Invalid box ID', 'Invalid box kind', 'Invalid JSON', 'Registration too large'].includes(value.error)) reason = `: ${value.error}`;
      } catch {}
      throw new Error(`Leaderboard registration HTTP ${response.status}${reason}`);
    }
    const credentials = parseCredentials(parseJson(response.body), requested);
    saved[key] = credentials;
    await this.saveCredentials(saved);
    this.credentials = credentials;
    return credentials;
  }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { throw new Error('Invalid leaderboard JSON'); }
}

function parseCredentials(value: unknown, requested: string): Credentials {
  const credentials = value as Partial<Credentials> | null;
  if (!credentials || typeof credentials.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(credentials.id) || typeof credentials.token !== 'string' || !/^[a-f0-9]{64}$/.test(credentials.token) || (requested && credentials.id !== requested)) throw new Error('Invalid leaderboard credentials');
  return { id: credentials.id, token: credentials.token };
}

function requireHttps(url: URL): void {
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Leaderboard URL requires HTTPS');
}
function parseLeaderboard(value: unknown, habitat: 'land' | 'water', limit: number, ownId?: string): LeaderboardSummary {
  const invalid = (): never => { throw new Error('Invalid leaderboard summary'); };
  if (!value || typeof value !== 'object') return invalid();
  const summary = value as LeaderboardSummary;
  if (summary.habitat !== habitat || !Number.isSafeInteger(summary.total) || summary.total < 0 || !Array.isArray(summary.entries) || summary.entries.length !== Math.min(limit, summary.total)) return invalid();
  const entry = (raw: unknown): LeaderboardBoxSummary => {
    if (!raw || typeof raw !== 'object') return invalid();
    const row = raw as LeaderboardBoxSummary;
    if (typeof row.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(row.id) || !Number.isSafeInteger(row.rank) || row.rank < 1 || row.rank > summary.total || !Number.isSafeInteger(row.score) || row.score < 0 || (row.name !== undefined && typeof row.name !== 'string') || typeof row.reportedAt !== 'string' || !Number.isFinite(Date.parse(row.reportedAt)) || !row.scoreParts || typeof row.scoreParts !== 'object') return invalid();
    const keys = habitat === 'land' ? ['plants', 'bugs', 'seeds'] : ['plants', 'fish', 'water'];
    const parts = Object.fromEntries(keys.map(key => [key, (row.scoreParts as unknown as Record<string, unknown>)[key]]));
    if (Object.values(parts).some(part => !Number.isSafeInteger(part) || Number(part) < 0) || Object.values(parts).reduce<number>((sum, part) => sum + Number(part), 0) !== row.score) return invalid();
    if (row.competitiveRank !== undefined && (!Number.isSafeInteger(row.competitiveRank) || row.competitiveRank < 1 || row.competitiveRank > row.rank)) return invalid();
    return { rank: row.rank, ...(row.competitiveRank === undefined ? {} : { competitiveRank: row.competitiveRank }), id: row.id, name: row.name, score: row.score, scoreParts: parts as ScoreParts, reportedAt: row.reportedAt };
  };
  const entries = summary.entries.map(entry);
  if (entries.some((row, index) => row.rank !== index + 1) || new Set(entries.map(row => row.id)).size !== entries.length) return invalid();
  const own = summary.own === null ? null : entry(summary.own);
  if (own && own.id !== ownId) return invalid();
  return { habitat, total: summary.total, entries, own };
}
function request(url: URL, method: string, value: unknown, token?: string, maxResponseBytes = 16384, timeoutMs = TERRARIUM_DEFAULTS.requestTimeoutMs!): Promise<{ status: number; body: string }> {
  const body = value === undefined ? undefined : JSON.stringify(value);
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, { method, family: 4, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, timeout: timeoutMs }, res => {
      let response = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        response += chunk;
        if (Buffer.byteLength(response) > maxResponseBytes) res.destroy(new Error('Leaderboard response too large'));
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: response }));
    });
    const deadline = setTimeout(() => req.destroy(new Error('Leaderboard timeout')), timeoutMs);
    deadline.unref(); req.on('close', () => clearTimeout(deadline));
    req.on('timeout', () => req.destroy(new Error('Leaderboard timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
