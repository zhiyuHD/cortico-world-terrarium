import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { WorldHost } from 'cortico/core/types.ts';
import { deliverVersionNotice, TERRARIUM_VERSION_NOTICE } from '../src/version-notice.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';

it('delivers each version once across restarts and rollbacks and retries failed event delivery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-version-')), file = join(dir, 'seen.json');
  const delivered: string[] = [];
  try {
    const send = (version: string) => deliverVersionNotice(file, version, async () => { delivered.push(version); });
    await send('0.8.5'); await send('0.8.5'); await send('0.8.6'); await send('0.8.5');
    expect(delivered).toEqual(['0.8.5', '0.8.6']);
    await expect(deliverVersionNotice(file, '0.8.7', async () => { throw Error('Event store unavailable'); })).rejects.toThrow('Event store');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(delivered);
    await send('0.8.7'); expect(delivered).toEqual(['0.8.5', '0.8.6', '0.8.7']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('notifies an unclaimed deployment once with piggyback delivery across fresh World instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-start-version-'));
  const events: { type: string; text: string; trigger?: string }[] = [];
  const host = { log: { warn() {} }, async pushEvent(event: { type: string; text: string }, options: { trigger?: string }) { events.push({ ...event, ...options }); return { ...event, cursor: events.length }; } } as unknown as WorldHost;
  try {
    for (let i = 0; i < 2; i++) {
      const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, stateFile: join(dir, 'land', 'state.json'), timezone: 'UTC' });
      try { await world.start(host); } finally { await world.stop(); }
    }
    const notices = events.filter(event => event.type === 'terrarium.updated');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ trigger: 'piggyback' });
    expect(notices[0].text).toContain(TERRARIUM_VERSION_NOTICE.version);
    if (TERRARIUM_VERSION_NOTICE.theme) expect(notices[0].text).toContain(TERRARIUM_VERSION_NOTICE.theme);
    else expect(notices[0].text).toContain(`已更新到 ${TERRARIUM_VERSION_NOTICE.version}。本版改进：`);
    for (const improvement of TERRARIUM_VERSION_NOTICE.improvements) expect(notices[0].text).toContain(improvement);
    await expect(readFile(join(dir, 'land', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
