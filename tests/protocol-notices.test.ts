import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ProtocolNotices } from '../server/protocol-notices.ts';
import { AnnouncementStore } from '../server/announcements.ts';

it('persists delivery identities, changes notices with policy and keeps message content out of both stores', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-protocol-'));
  try {
    const store = new AnnouncementStore(join(dir, 'announcements.json')); await store.restore();
    const file = join(dir, 'protocol.json'), notices = new ProtocolNotices(file, () => store.allocateProtocolId()); await notices.restore();
    await notices.observe('box', '0.7.3', 'http');
    const [a, b] = await Promise.all([notices.notice('box', 'policy-a'), notices.notice('box', 'policy-a')]); expect(a).toEqual(b);
    const restored = new ProtocolNotices(file, () => store.allocateProtocolId()); await restored.restore(); expect(await restored.notice('box', 'policy-a')).toEqual(a);
    const changed = await restored.notice('box', 'policy-b'); expect(changed.id).toBeGreaterThan(a.id);
    expect(store.list()).toEqual([]); expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).not.toContain('policy-'); expect(await readFile(join(dir, 'announcements.json'), 'utf8')).not.toContain('policy-');
    await writeFile(file, '[]'); await expect(new ProtocolNotices(file, () => store.allocateProtocolId()).restore()).rejects.toThrow('Invalid protocol');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
