import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { RankAlerts } from '../src/rank-alerts.ts';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-alerts-')); dirs.push(dir);
  const file = join(dir, 'rank-alerts.json'), alerts = new RankAlerts(file, { minDrop: 1, cooldownMinutes: 0 });
  await alerts.restore(); return { file, alerts };
}

it('replaces baselines when the server, box identity or own listing changes', async () => {
  const { alerts, file } = await fixture();
  expect(alerts.enabled).toBe(true);
  expect(await alerts.observe('server-a|box-a', 1)).toBeUndefined();
  expect(await alerts.observe('server-b|box-a', 5)).toBeUndefined();
  expect(await alerts.observe('server-b|box-b', 10)).toBeUndefined();
  expect(await alerts.observe('server-b|box-b', 11)).toMatchObject({ rank: 10 });
  const restarted = new RankAlerts(file, { minDrop: 1, cooldownMinutes: 0 }); await restarted.restore();
  expect(await restarted.observe('server-b|box-b', 11)).toBeUndefined();
  expect(await restarted.observe('server-b|box-b', null)).toBeUndefined();
  expect(await restarted.observe('server-b|box-b', 20)).toBeUndefined();
  expect(await restarted.observe('server-b|box-b', 21)).toMatchObject({ rank: 20 });
});

it('rejects malformed persisted preferences at the file boundary', async () => {
  const { file } = await fixture();
  for (const value of [null, {}, { enabled: 'false' }, { enabled: true, baseline: { identity: 'a', rank: 0 } }, { enabled: true, baseline: { rank: 1 } }]) {
    await writeFile(file, JSON.stringify(value));
    await expect(new RankAlerts(file).restore()).rejects.toThrow('Invalid rank alerts file');
  }
});

it('accumulates small drops, ignores tied-score ordering and persists the cooldown across restarts', async () => {
  const { file, alerts } = await fixture();
  const prefs = new RankAlerts(file); await prefs.restore();
  expect(await prefs.observe('a', 1, 0, { competitiveRank: 1 })).toBeUndefined();
  expect(await prefs.observe('a', 4, 1000, { competitiveRank: 1 })).toBeUndefined();
  expect(await prefs.observe('a', 4, 2000, { competitiveRank: 3 })).toBeUndefined();
  expect(await prefs.observe('a', 5, 3000, { competitiveRank: 4 })).toMatchObject({ rank: 1 });
  expect(await prefs.observe('a', 8, 4000, { competitiveRank: 7 })).toBeUndefined();
  const restarted = new RankAlerts(file); await restarted.restore();
  expect(await restarted.observe('a', 9, TERRARIUM_DEFAULTS.rankAlertCooldownMinutes! * 60_000 + 3000, { competitiveRank: 8 })).toMatchObject({ rank: 5 });
  await restarted.setEnabled(false); await restarted.setEnabled(true);
  expect(await restarted.observe('a', 20, 40 * 60_000, { competitiveRank: 20 })).toBeUndefined();
});
