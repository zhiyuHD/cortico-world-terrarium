import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_MAX_ANNOUNCEMENTS, type AnnouncementPage, type Announcement } from './announcements.ts';

interface Inbox { cursors: Record<string, number>; seen: number[] }
export class AnnouncementInbox {
  private queue: Promise<unknown> = Promise.resolve();
  private inbox: Inbox = { cursors: Object.create(null), seen: [] };
  constructor(private readonly file: string, private readonly origin: string) {}
  async restore(): Promise<void> {
    let saved: Record<string, Inbox>;
    try { saved = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const inbox = saved?.[this.origin];
    if (inbox === undefined) return;
    if (!inbox || !inbox.cursors || typeof inbox.cursors !== 'object' || Array.isArray(inbox.cursors) || Object.values(inbox.cursors).some(cursor => !Number.isSafeInteger(cursor) || cursor < 0) || !Array.isArray(inbox.seen) || inbox.seen.length > TERRARIUM_MAX_ANNOUNCEMENTS || inbox.seen.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid announcement inbox');
    this.inbox = { cursors: Object.assign(Object.create(null), inbox.cursors), seen: inbox.seen };
  }
  cursor(id: string): number { return this.inbox.cursors[id] ?? 0; }
  receive(id: string, page: AnnouncementPage, push: (notice: Announcement) => Promise<void>): Promise<void> {
    const result = this.queue.then(() => this.deliver(id, page, push)); this.queue = result.catch(() => {}); return result;
  }
  private async deliver(id: string, page: AnnouncementPage, push: (notice: Announcement) => Promise<void>): Promise<void> {
    for (const notice of page.announcements) {
      if (!this.inbox.seen.includes(notice.id)) {
        await push(notice);
        this.inbox.seen = [...this.inbox.seen, notice.id].slice(-TERRARIUM_MAX_ANNOUNCEMENTS);
        await this.save();
      }
    }
    if (page.nextCursor > this.cursor(id)) { this.inbox.cursors[id] = page.nextCursor; await this.save(); }
  }
  private async save(): Promise<void> {
    let saved: Record<string, Inbox> = Object.create(null);
    try { saved = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify({ ...saved, [this.origin]: this.inbox }), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
}
