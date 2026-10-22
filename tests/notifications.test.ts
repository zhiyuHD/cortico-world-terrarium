import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { NotificationPreferences, TERRARIUM_NOTIFICATION_CATEGORIES, TERRARIUM_NOTIFICATION_WARNING } from '../src/notifications.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { newState, saveState, sow } from '../src/state.ts';
import { newAquarium } from '../src/aquarium.ts';
import { installFacility, observeProgress, TERRARIUM_LEVELS, upgradeHabitat } from '../src/progression.ts';

it('persists independent habitat switches, restores defaults and rejects corrupt preferences', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-notifications-')), file = join(dir, 'preferences.json');
  try {
    let prefs = new NotificationPreferences(file); await prefs.restore();
    expect(Object.values(prefs.status('land')).every(Boolean)).toBe(true);
    await prefs.set(['land'], ['growth', 'care_dry'], false);
    prefs = new NotificationPreferences(file); await prefs.restore();
    expect(prefs.enabled('land', 'growth')).toBe(false); expect(prefs.enabled('land', 'hunt')).toBe(true); expect(prefs.enabled('water', 'growth')).toBe(true);
    await prefs.set(['water'], ['growth'], false); await prefs.set(['land'], ['growth'], true);
    expect(prefs.enabled('land', 'care_dry')).toBe(false); expect(prefs.enabled('water', 'growth')).toBe(false);
    await writeFile(file, JSON.stringify({ land: { unknown: false }, water: {} }));
    await expect(new NotificationPreferences(file).restore()).rejects.toThrow('Invalid notification preferences');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function fixture(dir: string, now: () => number) {
  const events: { type: string; text: string; senderKey?: string }[] = [];
  const host = { log: { warn() {} }, async pushEvent(event: typeof events[number]) { events.push(event); return event; } } as unknown as WorldHost;
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '', tickIntervalMs: 3_600_000 }, stateFile: join(dir, 'land', 'state.json'), waterStateFile: join(dir, 'water', 'state.json'), timezone: 'UTC', now };
  let world = new TerrariumWorld(options);
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(String(await world.tools().find(t => t.name === name)!.handler(args, {} as ToolCallContext)));
  return { events, host, options, get world() { return world; }, replace() { world = new TerrariumWorld(options); }, call };
}

it('configures both unclaimed habitats without creating saves and retains switches across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-notification-tool-')), f = fixture(dir, () => Date.parse('2026-06-01T08:00:00Z'));
  try {
    await f.world.start(f.host);
    const result = await f.call('terrarium_notifications', { habitat: 'both', categories: ['all'], enabled: false });
    expect(result.warning).toBe(TERRARIUM_NOTIFICATION_WARNING);
    for (const habitat of ['land', 'water']) expect(Object.values(result.notifications[habitat])).toEqual(TERRARIUM_NOTIFICATION_CATEGORIES.map(() => false));
    await expect(f.call('terrarium_notifications', { categories: ['unknown'], enabled: true })).rejects.toThrow('known notification');
    await expect(f.call('terrarium_notifications', { categories: [] })).rejects.toThrow();
    await f.world.stop(); f.replace(); await f.world.start(f.host);
    expect((await f.call('terrarium_notifications', {})).notifications.land.growth).toBe(false);
    expect((await f.call('terrarium_inspect', {})).land).toMatchObject({ claimed: false, mutedNotifications: [...TERRARIUM_NOTIFICATION_CATEGORIES] });
    await expect(readFile(f.options.stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(f.options.waterStateFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.events.some(e => e.type === 'terrarium.updated')).toBe(true);
  } finally { await f.world.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('filters individual care conditions before startup catch-up and rearms current muted problems once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-notification-care-'));
  let now = Date.parse('2026-06-01T08:00:00Z'); const f = fixture(dir, () => now), land = newState(now), water = newAquarium(now);
  land.plants[0].moisture = 1; land.soil[0].moisture = 1; land.plants[0].health = 10; water.oxygen = 20;
  const prefs = new NotificationPreferences(join(dir, 'land', 'notifications.json'));
  try {
    await saveState(f.options.stateFile, land); await saveState(f.options.waterStateFile, water);
    await prefs.set(['land'], ['care_dry'], false); await f.world.start(f.host);
    const care = f.events.filter(e => e.type === 'terrarium.care');
    expect(care.find(e => e.senderKey === 'terrarium')?.text).toContain('健康');
    expect(care.find(e => e.senderKey === 'terrarium')?.text).not.toContain('缺水');
    expect(care.find(e => e.senderKey === 'terrarium.water')?.text).toContain('含氧');
    f.events.length = 0;
    await f.call('terrarium_notifications', { categories: ['care_dry'], enabled: true });
    await f.call('terrarium_inspect', { habitat: 'land' });
    expect(f.events.filter(e => e.type === 'terrarium.care')).toHaveLength(1);
    expect(f.events[0].text).toContain('缺水'); expect(f.events[0].text).not.toContain('健康');
    f.events.length = 0;
    await f.call('terrarium_notifications', { categories: ['care_dry'], enabled: true });
    await f.call('terrarium_inspect', { habitat: 'land' }); expect(f.events).toEqual([]);
    await f.call('terrarium_notifications', { habitat: 'both', categories: ['all'], enabled: false });
    now += 24 * 3_600_000; await f.call('terrarium_inspect', { habitat: 'land' });
    expect(f.events).toEqual([]);
    await f.world.stop();
    const saved = JSON.parse(await readFile(f.options.stateFile, 'utf8'));
    expect(saved.plants.some((p: { id: string }) => p.id === land.plants[0].id)).toBe(false);
    expect(JSON.stringify(saved.deaths)).toContain(land.plants[0].id);
  } finally { await f.world.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('mutes fertilizer growth events without changing growth or inventory and resumes only new events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-notification-growth-')), now = Date.parse('2026-06-01T08:00:00Z'), f = fixture(dir, () => now), state = newState(now);
  observeProgress(state).peakScore = TERRARIUM_LEVELS[1].requiredScore; upgradeHabitat(state); installFacility(state, 'compost_bin', 1, 4);
  sow(state, 'sunflower', 5, 5); state.fertilizer = 20;
  try {
    await saveState(f.options.stateFile, state); await f.world.start(f.host); f.events.length = 0;
    await f.call('terrarium_notifications', { categories: ['growth'], enabled: false });
    const result = await f.call('terrarium_compost', { action: 'fertilize', x: 5, y: 5, portions: 10 });
    expect(result).toMatchObject({ fertilizer: 10, plant: { growthHours: 18 } }); expect(f.events).toEqual([]);
    await f.call('terrarium_notifications', { categories: ['growth'], enabled: true });
    expect(f.events).toEqual([]);
    await f.call('terrarium_sow', { species: 'basil', x: 4, y: 5 }); f.events.length = 0;
    await f.call('terrarium_compost', { action: 'fertilize', x: 4, y: 5, portions: 5 });
    expect(f.events.some(e => e.type === 'terrarium.stage' || e.type === 'terrarium.sprout')).toBe(true);
  } finally { await f.world.stop(); await rm(dir, { recursive: true, force: true }); }
});
