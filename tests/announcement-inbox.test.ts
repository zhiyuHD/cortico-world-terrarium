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


it('deduplicates simultaneous socket and polling delivery without skipping older announcements', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-protocol-inbox-'));
  try {
    const file = join(dir, 'inbox.json'), inbox = new AnnouncementInbox(file, 'https://service.example');
    const notice = (id: number) => ({ id, title: '', text: '通知', targets: 'all' as const, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const received: number[] = [], push = async (value: { id: number }) => { received.push(value.id); };
    await Promise.all([inbox.receive('protocol', { announcements: [notice(30)], nextCursor: 0 }, push), inbox.receive('box', { announcements: [notice(1), notice(30)], nextCursor: 30 }, push)]);
    await inbox.receive('box', { announcements: [], nextCursor: 0 }, push);
    const restored = new AnnouncementInbox(file, 'https://service.example'); await restored.restore();
    expect(received).toEqual([30, 1]); expect(restored.cursor('box')).toBe(30); expect(restored.cursor('protocol')).toBe(0);
    await restored.receive('box', { announcements: [notice(30)], nextCursor: 30 }, push); expect(received).toEqual([30, 1]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
