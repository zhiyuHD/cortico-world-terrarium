import { validAnnouncement, type AnnouncementPage } from './announcements.ts';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AquariumState } from './aquarium.ts';
import type { TerrariumState } from './state.ts';
import type { LeaderboardBoxSummary, LeaderboardSummary, ScoreParts } from './scoring.ts';

interface Credentials { id: string; token: string }
export interface LeaderboardClientOptions { url: string; id: string; token?: string; credentialsFile: string; kind?: 'land' | 'water' }

export class LeaderboardClient {
  private credentials: Credentials | undefined;
  private authorizing: Promise<Credentials> | undefined;

  constructor(private readonly options: LeaderboardClientOptions) {}

  get id(): string | undefined { return this.credentials?.id ?? (this.options.token ? this.options.id : undefined); }

  async leaderboard(limit: number): Promise<LeaderboardSummary> {
    if (!this.options.url) throw new Error('Leaderboard is disabled; configure worlds.terrarium.leaderboardUrl');
    const url = new URL('/api/leaderboard', this.options.url);
    requireHttps(url);
    const habitat = this.options.kind ?? 'land';
    url.searchParams.set('kind', habitat); url.searchParams.set('view', 'summary'); url.searchParams.set('limit', String(limit));
    if (this.id) url.searchParams.set('ownId', this.id);
    const response = await request(url, 'GET', undefined, undefined, 262144);
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
    const response = await request(url, 'GET', undefined, credentials?.token, 262144);
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
    if (!this.options.url || this.credentials || this.options.token) return;
    const url = new URL(this.options.url);
    try {
      const value: unknown = parseJson(await readFile(this.options.credentialsFile, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid leaderboard credentials file');
      const saved = Object.assign(Object.create(null), value);
      const credentials = saved[this.key(url)];
      if (credentials) this.credentials = parseCredentials(credentials, this.options.id);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  private key(url: URL): string { return `${url.origin}/${this.options.kind === 'water' ? 'water/' : ''}${this.options.id ? `id/${this.options.id}` : 'auto'}`; }

  async report(state: TerrariumState | AquariumState, phase: 'day' | 'night'): Promise<void> {
    if (!this.options.url) return;
    const url = new URL(this.options.url);
    requireHttps(url);
    const credentials = await this.authorize(url);
    const response = await request(new URL('/api/reports', url), 'PUT', { id: credentials.id, state, phase }, credentials.token);
    if (response.status < 200 || response.status >= 300) throw new Error(`Leaderboard report HTTP ${response.status}`);
  }

  private async authorize(url: URL): Promise<Credentials> {
    requireHttps(url);
    if (!this.authorizing) this.authorizing = this.authorizeOnce(url).finally(() => { this.authorizing = undefined; });
    return this.authorizing;
  }

  private async authorizeOnce(url: URL): Promise<Credentials> {
    if (this.options.token) {
      if (!this.options.id) throw new Error('A configured report token requires a box ID');
      return { id: this.options.id, token: this.options.token };
    }
    if (this.credentials) return this.credentials;
    const key = this.key(url);
    let saved: Record<string, Credentials> = Object.create(null);
    try {
      const value: unknown = parseJson(await readFile(this.options.credentialsFile, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid leaderboard credentials file');
      saved = Object.assign(Object.create(null), value);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (saved[key]) {
      this.credentials = parseCredentials(saved[key], this.options.id);
      return this.credentials;
    }
    const response = await request(new URL('/api/registrations', url), 'POST', { ...(this.options.id ? { id: this.options.id } : {}), kind: this.options.kind ?? 'land' });
    if (response.status === 409) throw new Error('Box ID is already registered; supply its token or choose another ID');
    if (response.status !== 201) throw new Error(`Leaderboard registration HTTP ${response.status}`);
    const credentials = parseCredentials(parseJson(response.body), this.options.id);
    saved[key] = credentials;
    await mkdir(dirname(this.options.credentialsFile), { recursive: true });
    const temporary = `${this.options.credentialsFile}.tmp`;
    await writeFile(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 });
    await rename(temporary, this.options.credentialsFile);
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
    return { rank: row.rank, id: row.id, name: row.name, score: row.score, scoreParts: parts as ScoreParts, reportedAt: row.reportedAt };
  };
  const entries = summary.entries.map(entry);
  if (entries.some((row, index) => row.rank !== index + 1) || new Set(entries.map(row => row.id)).size !== entries.length) return invalid();
  const own = summary.own === null ? null : entry(summary.own);
  if (own && own.id !== ownId) return invalid();
  return { habitat, total: summary.total, entries, own };
}
function request(url: URL, method: string, value: unknown, token?: string, maxResponseBytes = 16384): Promise<{ status: number; body: string }> {
  const body = value === undefined ? undefined : JSON.stringify(value);
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, { method, family: 4, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, timeout: 5000 }, res => {
      let response = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        response += chunk;
        if (Buffer.byteLength(response) > maxResponseBytes) res.destroy(new Error('Leaderboard response too large'));
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: response }));
    });
    req.on('timeout', () => req.destroy(new Error('Leaderboard timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
