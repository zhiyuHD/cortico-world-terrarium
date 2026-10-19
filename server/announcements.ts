import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_MAX_ANNOUNCEMENTS, validAnnouncement, type Announcement, type AnnouncementPage } from '../src/announcements.ts';

interface Store { nextId: number; announcements: Announcement[] }
export class AnnouncementStore {
  private state: Store = { nextId: 1, announcements: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async restore(): Promise<void> {
    let state: Store;
    try { state = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!state || !Number.isSafeInteger(state.nextId) || state.nextId < 1 || !Array.isArray(state.announcements) || state.announcements.length > TERRARIUM_MAX_ANNOUNCEMENTS || !state.announcements.every((notice, i) => validAnnouncement(notice) && notice.id < state.nextId && (i === 0 || notice.id > state.announcements[i - 1].id))) throw new Error('Invalid announcements file');
    this.state = state;
  }
  page(id: string | undefined, after: number): AnnouncementPage {
    const now = Date.now();
    const visible = this.state.announcements.filter(notice => notice.id > after && Date.parse(notice.expiresAt) > now && (notice.targets === 'all' || (id !== undefined && notice.targets.includes(id))));
    const announcements = visible.slice(0, 20);
    return { announcements, nextCursor: visible.length > 20 ? announcements.at(-1)!.id : this.state.nextId - 1 };
  }
  latestPublic(): AnnouncementPage { return { announcements: this.state.announcements.filter(notice => notice.targets === 'all' && Date.parse(notice.expiresAt) > Date.now()).slice(-20), nextCursor: this.state.nextId - 1 }; }
  list(): Announcement[] { return this.state.announcements; }
  publish(input: unknown, registered: (id: string) => boolean): Promise<Announcement> {
    return this.serial(async () => {
      const value = input as Partial<Announcement> | null;
      const now = Date.now();
      const notice = { id: this.state.nextId, title: value?.title ?? '', text: value?.text, targets: value?.targets ?? 'all', createdAt: new Date(now).toISOString(), expiresAt: value?.expiresAt ?? new Date(now + 7 * 86400000).toISOString() };
      if (!validAnnouncement(notice) || Date.parse(notice.expiresAt) <= now || Date.parse(notice.expiresAt) > now + 30 * 86400000 || (notice.targets !== 'all' && notice.targets.some(id => !registered(id)))) throw new Error('Invalid announcement: supply text, optional title, registered target IDs and expiry within 30 days');
      const retained = this.state.announcements.filter(entry => Date.parse(entry.expiresAt) > now);
      if (retained.length >= TERRARIUM_MAX_ANNOUNCEMENTS) throw new Error('Announcement capacity reached; revoke an announcement first');
      await this.save({ nextId: notice.id + 1, announcements: [...retained, notice] });
      return notice;
    });
  }
  ensureUpgradeNotice(id: string, text: string): Promise<void> {
    return this.serial(async () => {
      const now = Date.now();
      if (this.state.announcements.some(notice => notice.title === '客户端需要升级' && notice.text === text && Array.isArray(notice.targets) && notice.targets.includes(id) && Date.parse(notice.expiresAt) > now)) return;
      const retained = this.state.announcements.filter(notice => Date.parse(notice.expiresAt) > now);
      if (retained.length >= TERRARIUM_MAX_ANNOUNCEMENTS) return;
      const notice: Announcement = { id: this.state.nextId, title: '客户端需要升级', text, targets: [id], createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 86400000).toISOString() };
      await this.save({ nextId: notice.id + 1, announcements: [...retained, notice] });
    });
  }
  revoke(id: number): Promise<boolean> {
    return this.serial(async () => {
      if (!this.state.announcements.some(notice => notice.id === id)) return false;
      await this.save({ ...this.state, announcements: this.state.announcements.filter(notice => notice.id !== id) });
      return true;
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  private async save(state: Store): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file); this.state = state;
  }
}
