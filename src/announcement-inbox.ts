import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { TERRARIUM_MAX_ANNOUNCEMENTS, type AnnouncementPage, type Announcement } from './announcements.ts';

interface Inbox { cursors: Record<string, number>; seen: number[] }
export class AnnouncementInbox {
  private queue: Promise<unknown> = Promise.resolve();
  private inbox: Inbox = { cursors: Object.create(null), seen: [] };
  constructor(private readonly file: string, private readonly origin: string) {}
  async restore(): Promise<void> {
    const saved = await this.read();
    const inbox = saved[this.origin];
    if (inbox) this.inbox = { cursors: Object.assign(Object.create(null), inbox.cursors), seen: inbox.seen };
  }
  private async read(): Promise<Record<string, Inbox>> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.values(saved).some(inbox =>
        !inbox || !inbox.cursors || typeof inbox.cursors !== 'object' || Array.isArray(inbox.cursors) ||
        Object.values(inbox.cursors).some(cursor => !Number.isSafeInteger(cursor) || Number(cursor) < 0) ||
        !Array.isArray(inbox.seen) || inbox.seen.length > TERRARIUM_MAX_ANNOUNCEMENTS ||
        inbox.seen.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1))) throw new SyntaxError('Invalid announcement inbox');
      return saved as Record<string, Inbox>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null);
      if (!(error instanceof SyntaxError)) throw error;
      await rename(this.file, `${this.file}.corrupt-${Date.now()}-${randomUUID()}`);
      return Object.create(null);
    }
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
    const saved = await this.read();
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify({ ...saved, [this.origin]: this.inbox })); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, this.file);
    const directory = await open(dirname(this.file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
