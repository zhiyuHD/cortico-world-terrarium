import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AnnouncementInbox } from '../src/announcement-inbox.ts';

it('retries failed event delivery and keeps receipt progress separate for service origins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-inbox-')), file = join(dir, 'inbox.json');
  const page = { announcements: [{ id: 1, title: '', text: '通知', targets: 'all' as const, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() }], nextCursor: 1 };
  try {
    const first = new AnnouncementInbox(file, 'https://service-a.example'); await first.restore();
    await expect(first.receive('public', page, async () => { throw new Error('Event delivery failed'); })).rejects.toThrow('delivery failed');
    expect(first.cursor('public')).toBe(0);
    const received: number[] = [];
    await first.receive('public', page, async notice => { received.push(notice.id); });
    const second = new AnnouncementInbox(file, 'https://service-b.example'); await second.restore();
    await second.receive('public', page, async notice => { received.push(notice.id); });
    const restarted = new AnnouncementInbox(file, 'https://service-a.example'); await restarted.restore();
    expect(restarted.cursor('public')).toBe(1);
    await restarted.receive('land-box', page, async notice => { received.push(notice.id); });
    expect(received).toEqual([1, 1]); expect(restarted.cursor('land-box')).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
