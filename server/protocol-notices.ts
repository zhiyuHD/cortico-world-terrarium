import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { Announcement } from '../src/announcements.ts';
import { validClientVersion } from '../src/report-protocol.ts';

interface Client { version?: string; transport: 'http' | 'websocket'; key?: string; id?: number; createdAt?: string }

/** Keeps delivery identities outside the operator announcement list; content is derived from current policy. */
export class ProtocolNotices {
  private clients: Record<string, Client> = Object.create(null);
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly allocateId: () => Promise<number>) {}
  async restore(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid protocol notice identities');
      this.clients = Object.assign(Object.create(null), saved);
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!this.clients || Object.values(this.clients).some(client => !client || !['http', 'websocket'].includes(client.transport) || (client.version !== undefined && !validClientVersion(client.version)) || (client.id !== undefined && (!Number.isSafeInteger(client.id) || client.id < 1 || typeof client.key !== 'string' || !Number.isFinite(Date.parse(client.createdAt!)))))) throw new Error('Invalid protocol notice identities');
  }
  client(id: string): Client | undefined { return this.clients[id]; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  observe(id: string, version: unknown, transport: Client['transport']): Promise<void> {
    return this.serial(async () => {
      const declared = validClientVersion(version) ? version : undefined;
      if (this.clients[id]?.version === declared && this.clients[id]?.transport === transport) return;
      this.clients[id] = { ...this.clients[id], version: declared, transport }; await this.save();
    });
  }
  notice(id: string, text: string, policy = text): Promise<Announcement> {
    return this.serial(async () => {
      const client = this.clients[id];
      const key = createHash('sha256').update(policy).digest('hex');
      if (client.key !== key || !client.id || Date.parse(client.createdAt!) + 30 * 86400000 <= Date.now()) {
        const shared = Object.values(this.clients).find(other => other.key === key && other.id && Date.parse(other.createdAt!) + 30 * 86400000 > Date.now());
        client.id = shared?.id ?? await this.allocateId(); client.key = key; client.createdAt = shared?.createdAt ?? new Date().toISOString(); await this.save();
      }
      return { id: client.id!, title: '客户端需要升级', text, targets: [id], createdAt: client.createdAt!, expiresAt: new Date(Date.parse(client.createdAt!) + 30 * 86400000).toISOString() };
    });
  }
  private async save(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.clients), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
}
