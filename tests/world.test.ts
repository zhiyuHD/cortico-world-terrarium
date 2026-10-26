import { operationTools } from './tool-operations.ts';
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { EventEnvelope, PushOptions, ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { expect, it, vi } from 'vitest';
import { start as startServer } from '../server/index.ts';
import { newAquarium, stockFish } from '../src/aquarium.ts';
import { TERRARIUM_MAX_HISTORY } from '../src/habitat.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { LeaderboardClient } from '../src/leaderboard.ts';
import { loadState, newState, saveState } from '../src/state.ts';
import { TerrariumWorld } from '../src/world.ts';
import { createReportProxy } from './report-service.ts';

async function settleScheduledUpdate(check: () => Promise<void>): Promise<void> {
  const deadline = performance.now() + 2_000;
  for (;;) {
    try {
      await check();
      // Disk and HTTP work must finish before advancing the next timer boundary.
      expect(vi.getTimerCount()).toBe(1);
      return;
    } catch (error) {
      if (performance.now() >= deadline) throw error;
      await nextTurn();
    }
  }
}

it('reports elapsed changes and keeps tool edits across restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-world-'));
  const file = join(dir, 'state.json');
  const start = Date.parse('2026-06-01T16:00:00Z');
  let now = start + 45 * 60 * 60_000;
  const events: Array<{ event: Omit<EventEnvelope, 'cursor'>; options?: PushOptions }> = [];
  const host = {
    log: { warn() {} },
    async pushEvent(event: Omit<EventEnvelope, 'cursor'>, options?: PushOptions) {
      events.push({ event, options });
      return { ...event, cursor: events.length } as EventEnvelope;
    },
  } as unknown as WorldHost;
  const callContext = {} as ToolCallContext;
  try {
    await saveState(file, newState(start));
    const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'Asia/Shanghai', stateFile: file, now: () => now });
    await world.start(host);
    expect(events.some(({ event }) => event.type === 'terrarium.phase')).toBe(true);
    expect(events.filter(({ event }) => event.type === 'terrarium.care' && event.text.includes('缺水'))).toHaveLength(1);
    expect(events.filter(({ event, options }) => event.type === 'terrarium.care' && event.text.includes('缺水') && options?.trigger === 'debounce')).toHaveLength(1);
    const tools = operationTools(world);
    const inspect = tools.find(tool => tool.name === 'terrarium_inspect')!;
    const water = tools.find(tool => tool.name === 'terrarium_water')!;
    const move = tools.find(tool => tool.name === 'terrarium_move')!;
    const sow = tools.find(tool => tool.name === 'terrarium_sow')!;
    const release = tools.find(tool => tool.name === 'terrarium_release_bug')!;
    const feed = tools.find(tool => tool.name === 'terrarium_feed_bug')!;
    const relocate = tools.find(tool => tool.name === 'terrarium_relocate_bug')!;
    const remove = tools.find(tool => tool.name === 'terrarium_remove')!;
    expect(JSON.parse(String(await inspect.handler({ habitat: 'land' }, callContext))).plants.every((plant: { dry: boolean }) => plant.dry)).toBe(true);
    await water.handler({ plant: 'fern' }, callContext);
    const watered = JSON.parse(String(await water.handler({ x: 2, y: 2 }, callContext)));
    expect(watered.soil).toMatchObject({ x: 2, y: 2 });
    await expect(water.handler({ plant: 'fern', x: 2, y: 2 }, callContext)).rejects.toThrow('OR');
    await move.handler({ item: 'coin', x: 0, y: 2 }, callContext);
    await sow.handler({ species: 'basil', x: 2, y: 2 }, callContext);
    const released = JSON.parse(String(await release.handler({ species: 'beetle', x: 1, y: 2 }, callContext)));
    await feed.handler({ bug: released.bug.id }, callContext);
    await relocate.handler({ bug: released.bug.id, x: 3, y: 3 }, callContext);
    const another = JSON.parse(String(await release.handler({ species: 'aphid', x: 1, y: 2 }, callContext)));
    await remove.handler({ id: another.bug.id }, callContext);
    await expect(move.handler({ item: 'coin', x: 0, y: 0 }, callContext)).rejects.toThrow('plant');
    await world.stop();
    const saved = await loadState(file, now);
    expect(saved.plants.find(plant => plant.id === 'fern')?.dry).toBe(false);
    expect(saved.items.find(item => item.id === 'coin')).toMatchObject({ x: 0, y: 2 });
    expect(saved.seeds).toHaveLength(1);
    expect(saved.bugs).toMatchObject([{ id: released.bug.id, x: 3, y: 3, energy: 95 }]);
    now += 60_000;
    const restarted = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'Asia/Shanghai', stateFile: file, now: () => now });
    await restarted.start(host);
    expect((await loadState(file, now)).items.find(item => item.id === 'coin')).toMatchObject({ x: 0, y: 2 });
    await restarted.stop();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('delivers birth and hunger events so the bot can inspect the changed state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-events-'));
  const file = join(dir, 'state.json');
  const start = Date.parse('2026-06-01T00:59:00Z');
  let now = start;
  const events: Array<{ event: Omit<EventEnvelope, 'cursor'>; options?: PushOptions }> = [];
  const host = {
    log: { warn() {} },
    async pushEvent(event: Omit<EventEnvelope, 'cursor'>, options?: PushOptions) {
      events.push({ event, options });
      return { ...event, cursor: events.length } as EventEnvelope;
    },
  } as unknown as WorldHost;
  try {
    const state = newState(start);
    state.bugs.push(
      { id: 'bug-1', species: 'aphid', x: 0, y: 0, ageHours: 24 - 1 / 60, energy: 75 },
      { id: 'bug-2', species: 'aphid', x: 0, y: 0, ageHours: 24 - 1 / 60, energy: 75 },
      { id: 'bug-3', species: 'ant', role: 'queen', x: 4, y: 4, ageHours: 0, energy: 21 },
    );
    state.nextId = 4;
    for (const cell of state.soil) cell.allowAntForaging = false;
    await saveState(file, state);
    const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'Asia/Shanghai', stateFile: file, now: () => now });
    await world.start(host);
    now += 60_000;
    const inspect = operationTools(world).find(tool => tool.name === 'terrarium_inspect')!;
    const observed = JSON.parse(String(await inspect.handler({ habitat: 'land' }, {} as ToolCallContext)));
    expect(observed.bugs).toHaveLength(4);
    const soil = JSON.parse(String(await inspect.handler({ habitat: 'land', section: 'soil' }, {} as ToolCallContext)));
    expect(soil.soil).toHaveLength(25);
    expect(soil.soil[0].light).toBe(soil.soil[0].daylight);
    expect(soil.requirements.moss.maxLight).toBeLessThan(soil.requirements.basil.minLight);
    expect(observed.history.samples).toBe(2);
    const history = operationTools(world).find(tool => tool.name === 'terrarium_history')!;
    const cellHistory = JSON.parse(String(await history.handler({ x: 0, y: 0, limit: 1 }, {} as ToolCallContext)));
    expect(cellHistory.samples).toEqual([{ recordedAtMs: now, x: 0, y: 0, moisture: expect.closeTo(soil.soil[0].moisture, 1) }]);
    await expect(history.handler({ plant: 'fern', x: 0, y: 0 }, {} as ToolCallContext)).rejects.toThrow('OR');
    await expect(history.handler({ x: 9, y: 0 }, {} as ToolCallContext)).rejects.toThrow('grid');
    await expect(history.handler({ plant: 'fern', limit: TERRARIUM_MAX_HISTORY + 1 }, {} as ToolCallContext)).rejects.toThrow('limit');
    const remove = operationTools(world).find(tool => tool.name === 'terrarium_remove')!;
    await remove.handler({ id: 'fern' }, {} as ToolCallContext);
    now += 60 * 60_000;
    const plantHistory = JSON.parse(String(await history.handler({ plant: 'fern' }, {} as ToolCallContext))).samples;
    expect(plantHistory[0].plant.id).toBe('fern');
    expect(plantHistory.at(-1)).toEqual({ recordedAtMs: now, plant: null });
    expect(events.filter(({ event }) => event.type === 'terrarium.birth')).toHaveLength(1);
    expect(events.some(({ event }) => event.type === 'terrarium.care' && event.text.includes('能量'))).toBe(true);
    expect(events.filter(({ event }) => event.type === 'terrarium.birth' || event.type === 'terrarium.care').every(({ options }) => options?.trigger === 'debounce')).toBe(true);
    await world.stop();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('advances ants every 10 seconds while reads preserve files and synchronize both boxes only at maintenance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-scheduled-'));
  const file = join(dir, 'land', 'state.json'), waterFile = join(dir, 'water', 'state.json');
  const serverFile = join(dir, 'service', 'leaderboard.json');
  const server = await startServer({ port: 0, dataFile: serverFile, credentialsFile: join(dir, 'service', 'credentials.json') });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const requests = { reports: 0, ranks: 0, announcements: 0 };
  const proxy = await createReportProxy(`http://127.0.0.1:${address.port}`, () => { requests.reports++; });
  const url = proxy.url;
  server.on('request', req => {
    if (req.method === 'PUT' && req.url === '/api/reports') requests.reports++;
    if (req.url?.includes('view=summary')) requests.ranks++;
    if (req.url?.startsWith('/api/announcements')) requests.announcements++;
  });
  const warnings: unknown[] = [], events: Array<{ type: string }> = [];
  const host = { log: { warn: (...args: unknown[]) => warnings.push(args) }, async pushEvent(event: { type: string }) { events.push(event); return event; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, tickIntervalMs: 60_000, leaderboardUrl: url }, timezone: 'UTC', stateFile: file, waterStateFile: waterFile, now: () => Date.now() });
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const start = Date.parse('2026-06-01T00:00:00Z');
  vi.setSystemTime(start);
  try {
    const state = newState(start), aquarium = newAquarium(start);
    state.bugs.push(
      { id: 'bug-1', species: 'ant', role: 'queen', x: 2, y: 2, inside: { nestId: 'nest-4', x: 2, y: 2 }, ageHours: 0, energy: 80 },
      { id: 'bug-2', species: 'ant', role: 'worker', x: 2, y: 2, inside: { nestId: 'nest-4', x: 0, y: 0 }, ageHours: 0, energy: 80 },
      { id: 'bug-3', species: 'aphid', x: 4, y: 4, ageHours: 0, energy: 80 },
    );
    state.nests = [{ id: 'nest-4', x: 2, y: 2, depth: 1, food: 0 }]; state.nextId = 5;
    stockFish(aquarium, 'guppy', 4, 4);
    await saveState(file, state); await saveState(waterFile, aquarium);
    const landClient = new LeaderboardClient({ url, id: '', credentialsFile: join(dir, 'land', 'report-credentials.json') });
    const waterClient = new LeaderboardClient({ url, id: '', kind: 'water', credentialsFile: join(dir, 'water', 'report-credentials.json') });
    await landClient.report(state, 'night'); await waterClient.report(aquarium, 'night');
    await world.start(host);
    await settleScheduledUpdate(async () => {
      expect(requests.ranks).toBe(2);
      expect(requests.announcements).toBe(2);
    });
    const baseline = { ...requests };
    const initialLand = await readFile(file, 'utf8'), initialWater = await readFile(waterFile, 'utf8');
    const initialLandTime = (await stat(file)).mtimeMs, initialWaterTime = (await stat(waterFile)).mtimeMs;
    const context = {} as ToolCallContext;
    const call = async (name: string, args: Record<string, unknown>) => JSON.parse(String(await operationTools(world).find(tool => tool.name === name)!.handler(args, context)));
    const panel = world.webUi();
    for (let step = 1; step <= 12; step++) {
      await vi.advanceTimersByTimeAsync(5_000);
      const view = await panel.invoke!('garden', 'state', []) as { state: ReturnType<typeof newState> };
      await panel.invoke!('water', 'state', []);
      expect(view.state.updatedAtMs).toBe(Date.now());
      expect(view.state.nests![0].depth).toBe(Math.min(5, 1 + Math.floor(step / 2)));
      expect(view.state.bugs.find(bug => bug.id === 'bug-3')).toMatchObject({ x: 4, y: step < 12 ? 4 : 3 });
      await call('terrarium_inspect', { habitat: 'land' });
      await call('terrarium_history', { plant: 'fern' });
      await call('terrarium_replay', { habitat: 'land' });
      await call('terrarium_replay', { habitat: 'water' });
      await call('terrarium_water_history', {});
      if (step < 12) {
        expect(await readFile(file, 'utf8')).toBe(initialLand);
        expect(await readFile(waterFile, 'utf8')).toBe(initialWater);
        expect((await stat(file)).mtimeMs).toBe(initialLandTime);
        expect((await stat(waterFile)).mtimeMs).toBe(initialWaterTime);
        expect(requests).toEqual({ ...baseline, ranks: baseline.ranks + (step >= 6 ? 2 : 0), announcements: baseline.announcements + (step >= 6 ? 2 : 0) });
      }
    }
    const uploaded = JSON.parse(await readFile(serverFile, 'utf8'));
    expect(uploaded[landClient.id!].state).toEqual(await loadState(file, Date.now()));
    expect(uploaded[landClient.id!].state.updatedAtMs).toBe(start + 60_000);
    expect(uploaded[waterClient.id!].state.updatedAtMs).toBe(start + 60_000);
    expect(uploaded[waterClient.id!].state.fish[0]).toMatchObject({ x: 4, y: 4 });
    expect(requests).toEqual({ reports: baseline.reports + 2, ranks: baseline.ranks + 2, announcements: baseline.announcements + 2 });
    expect(events.filter(event => event.type === 'terrarium.nest')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5_000);
    const beforeWrite = { ...requests };
    await call('terrarium_feed_bug', { bug: 'bug-2' });
    const written = await loadState(file, Date.now());
    expect(written.bugs.find(bug => bug.id === 'bug-2')?.energy).toBe(100);
    const afterWrite = JSON.parse(await readFile(serverFile, 'utf8'));
    expect(afterWrite[landClient.id!].state).toEqual(written);
    expect(requests).toEqual({ ...beforeWrite, reports: beforeWrite.reports + 1 });
    const beforeArea = { ...requests };
    const area = await call('terrarium_water_area', { x1: 0, y1: 0, x2: 4, y2: 4 });
    expect(area.soil).toHaveLength(25);
    expect(area.plants).toHaveLength(written.plants.length);
    expect(area.plants.find((plant: { id: string }) => plant.id === 'fern')).toMatchObject({ minMoisture: 30, maxMoisture: 85, moistureStatus: 'suitable' });
    expect(area.warnings).toHaveLength(1);
    expect(area.warnings[0]).toContain('clover');
    expect(requests).toEqual({ ...beforeArea, reports: beforeArea.reports + 1 });
    const areaSaved = await loadState(file, Date.now());
    expect(JSON.parse(await readFile(serverFile, 'utf8'))[landClient.id!].state).toEqual(areaSaved);
    const beforePanel = { ...requests };
    const panelWatered = await panel.invoke!('garden', 'water', [{ x1: 0, y1: 0, x2: 1, y2: 1 }]) as { watering: { plants: Array<{ id: string }>; warnings: string[] } };
    expect(panelWatered.watering.plants.map(plant => plant.id)).toEqual(['fern']);
    expect(panelWatered.watering.warnings.join(' ')).toContain('fern');
    expect(panelWatered.watering.warnings.join(' ')).not.toContain('clover');
    expect(requests).toEqual({ ...beforePanel, reports: beforePanel.reports + 1 });
    const panelSaved = await loadState(file, Date.now());
    expect(panelSaved.soil[0].moisture).toBe(Math.min(100, areaSaved.soil[0].moisture + 35));
    expect(panelSaved.soil[4]).toEqual(areaSaved.soil[4]);
    expect(JSON.parse(await readFile(serverFile, 'utf8'))[landClient.id!].state).toEqual(panelSaved);
    await expect(call('terrarium_water_area', { x1: 0, y1: 0, x2: 9, y2: 4 })).rejects.toThrow('corners');
    await expect(panel.invoke!('water', 'water', [{ x1: 0, y1: 0, x2: 4, y2: 4 }])).rejects.toThrow('Unknown');
    expect(await loadState(file, Date.now())).toEqual(panelSaved);
    const beforeInvalid = { ...requests };
    await expect(call('terrarium_release_bug', { species: 'missing', x: 0, y: 0 })).rejects.toThrow('Unknown bug species');
    expect(requests).toEqual(beforeInvalid);

    await world.stop();
    const stoppedRequests = { ...requests }, stoppedLand = await stat(file), stoppedWater = await stat(waterFile);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(requests).toEqual(stoppedRequests);
    expect((await stat(file)).mtimeMs).toBe(stoppedLand.mtimeMs);
    expect((await stat(waterFile)).mtimeMs).toBe(stoppedWater.mtimeMs);
    expect(warnings).toEqual([]);
  } finally {
    await world.stop(); vi.useRealTimers();
    await proxy.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

it('runs a newly claimed ant without reads and saves its unsynchronized state on stop before restarting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-new-scheduled-'));
  const file = join(dir, 'land', 'state.json'), serverFile = join(dir, 'service', 'leaderboard.json');
  const server = await startServer({ port: 0, dataFile: serverFile, credentialsFile: join(dir, 'service', 'credentials.json') });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  let reports = 0;
  const proxy = await createReportProxy(`http://127.0.0.1:${address.port}`, () => { reports++; });
  const url = proxy.url;
  server.on('request', req => { if (req.method === 'PUT' && req.url === '/api/reports') reports++; });
  const warnings: unknown[] = [], events: Array<{ type: string }> = [];
  const host = { log: { warn: (...args: unknown[]) => warnings.push(args) }, async pushEvent(event: { type: string }) { events.push(event); return event; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, tickIntervalMs: 60_000, leaderboardUrl: url }, timezone: 'UTC', stateFile: file, now: () => Date.now() });
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const start = Date.parse('2026-06-01T00:00:00Z');
  vi.setSystemTime(start);
  try {
    await world.start(host);
    await vi.advanceTimersByTimeAsync(10_000);
    await settleScheduledUpdate(async () => { await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' }); });
    const context = {} as ToolCallContext;
    const call = async (name: string, args: Record<string, unknown>) => JSON.parse(String(await operationTools(world).find(tool => tool.name === name)!.handler(args, context)));
    const box = await call('terrarium_claim', { habitat: 'land' });
    const released = await call('terrarium_release_bug', { species: 'ant', x: 2, y: 2 });
    const initial = await readFile(file, 'utf8'), initialTime = (await stat(file)).mtimeMs, initialReports = reports;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(events.filter(event => event.type === 'terrarium.nest')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await settleScheduledUpdate(async () => { expect(events.filter(event => event.type === 'terrarium.nest')).toHaveLength(1); });
    expect(await readFile(file, 'utf8')).toBe(initial);
    expect((await stat(file)).mtimeMs).toBe(initialTime);
    expect(reports).toBe(initialReports);
    expect(JSON.parse(await readFile(serverFile, 'utf8'))[box.id].state.nests ?? []).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);
    await world.stop();
    const stopped = await loadState(file, Date.now());
    expect(stopped.updatedAtMs).toBe(start + 30_000);
    expect(stopped.nests).toMatchObject([{ x: 2, y: 2, depth: 1 }]);
    const queen = stopped.bugs.find(bug => bug.id === released.bug.id)!;
    expect(queen).toMatchObject({ role: 'queen', x: 2, y: 2 });
    expect(queen.inside).toBeUndefined();
    expect(reports).toBe(initialReports);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await readFile(file, 'utf8')).toBe(JSON.stringify(stopped, null, 2));
    expect(reports).toBe(initialReports);
    await world.start(host);
    const restarted = await world.webUi().invoke!('garden', 'state', []) as { state: ReturnType<typeof newState> };
    expect(restarted.state.bugs.find(bug => bug.id === queen.id)).toMatchObject({ role: 'queen', x: queen.x, y: queen.y });
    expect(restarted.state.bugs.find(bug => bug.id === queen.id)!.inside).toEqual(queen.inside);
    expect(restarted.state.nests).toEqual(stopped.nests);
    expect(events.filter(event => event.type === 'terrarium.nest')).toHaveLength(1);
    expect(warnings).toEqual([]);
  } finally {
    await world.stop(); vi.useRealTimers();
    await proxy.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

it('retries a failed background save on the next maintenance cycle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-save-retry-'));
  const file = join(dir, 'state.json'), backup = join(dir, 'previous.json');
  const warnings: unknown[] = [];
  const host = { log: { warn: (...args: unknown[]) => warnings.push(args) }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => Date.now() });
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const start = Date.parse('2026-06-01T00:00:00Z');
  vi.setSystemTime(start);
  let blocked = false;
  try {
    await saveState(file, newState(start));
    await world.start(host);
    await rename(file, backup); await mkdir(file); blocked = true;
    await vi.advanceTimersByTimeAsync(TERRARIUM_DEFAULTS.tickIntervalMs);
    await settleScheduledUpdate(async () => { expect(warnings).toHaveLength(1); });
    expect((await loadState(backup, Date.now())).updatedAtMs).toBe(start);
    const view = await world.webUi().invoke!('garden', 'state', []) as { state: ReturnType<typeof newState> };
    expect(view.state.updatedAtMs).toBe(Date.now());
    await rm(file, { recursive: true }); await rename(backup, file); blocked = false;
    await vi.advanceTimersByTimeAsync(TERRARIUM_DEFAULTS.tickIntervalMs);
    await settleScheduledUpdate(async () => { expect((await loadState(file, Date.now())).updatedAtMs).toBe(Date.now()); });
    expect(warnings).toHaveLength(1);
  } finally {
    if (blocked) { await rm(file, { recursive: true, force: true }); await rename(backup, file); }
    await world.stop(); vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  }
});

it('delivers critical plant events once across a restart and keeps unclaimed watering unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-critical-world-')), file = join(dir, 'state.json');
  const start = Date.parse('2026-06-01T06:00:00Z'); let now = start;
  const events: Array<{ event: Omit<EventEnvelope, 'cursor'>; options?: PushOptions }> = [];
  const host = { log: { warn() {} }, async pushEvent(event: Omit<EventEnvelope, 'cursor'>, options?: PushOptions) { events.push({ event, options }); return { ...event, cursor: events.length }; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => now });
  const context = {} as ToolCallContext;
  const area = operationTools(world).find(tool => tool.name === 'terrarium_water_area')!;
  try {
    await world.start(host);
    await expect(area.handler({ x1: 0, y1: 0, x2: 4, y2: 4 }, context)).rejects.toThrow('not claimed');
    await expect(world.webUi().invoke!('garden', 'water', [{ x1: 0, y1: 0, x2: 4, y2: 4 }])).rejects.toThrow('not claimed');
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await world.stop();
    const state = newState(start); state.plants[0].health = 10;
    await saveState(file, state); now += 60_000;
    await world.start(host);
    const critical = events.filter(({ event }) => event.type === 'terrarium.care' && event.text.includes('健康'));
    expect(critical).toHaveLength(1);
    expect(critical[0]).toMatchObject({ event: { source: 'terrarium', origin: 'internal', senderKey: 'terrarium' }, options: { trigger: 'debounce' } });
    await world.stop(); now += 60_000;
    await world.start(host);
    expect(events.filter(({ event }) => event.type === 'terrarium.care' && event.text.includes('健康'))).toHaveLength(1);
    await area.handler({ x1: 0, y1: 0, x2: 4, y2: 4 }, context);
    expect((await loadState(file, now)).plants[0].healthWarning).toBe(true);
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('persists care settings and collections, waters once after offline catch-up and supports draining and water reuse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-care-world-')), file = join(dir, 'state.json');
  let now = Date.parse('2026-06-01T00:00:00Z');
  const host = { log: { warn() {} }, async pushEvent(event: Omit<EventEnvelope, 'cursor'>) { return { ...event, cursor: 1 }; } } as unknown as WorldHost;
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'Asia/Shanghai', stateFile: file, now: () => now };
  let world = new TerrariumWorld(options);
  const invoke = async (name: string, args: Record<string, unknown>) => JSON.parse(String(await operationTools(world).find(t => t.name === name)!.handler(args, {} as ToolCallContext)));
  try {
    await world.start(host);
    await invoke('terrarium_claim', { habitat: 'land' }); await invoke('terrarium_claim', { habitat: 'water' });
    await invoke('terrarium_collection', { action: 'collect', id: 'fern' });
    await invoke('terrarium_set_irrigation', { x: 2, y: 2, enabled: true, targetMoisture: 60, intervalMinutes: 60 });
    await world.stop(); now += 3_600_000;
    world = new TerrariumWorld(options); await world.start(host);
    const observed = await invoke('terrarium_inspect', { habitat: 'land' });
    expect(observed.collection.count).toBe(1);
    expect((await invoke('terrarium_collection', { action: 'list' })).collection[0].specimen.id).toBe('fern');
    expect((await invoke('terrarium_inspect', { habitat: 'land', section: 'objects' })).irrigation.items[0].lastWateredAtMs).toBe(now);
    expect(observed.soil.moistureRows[2][2]).toBe(60);
    await invoke('terrarium_collection', { action: 'restore', id: 'fern', x: 1, y: 1 });
    const drained = await invoke('terrarium_drain', { x: 2, y: 2, amount: 10 }); expect(drained.soil.moisture).toBe(50);
    const reused = await invoke('terrarium_reuse_water', { percent: 10, x1: 2, y1: 2, x2: 2, y2: 2 }); expect(reused.soil[0].moisture).toBe(100);
    await invoke('terrarium_set_irrigation', { x: 2, y: 2, enabled: false });
    await world.stop(); const saved = await loadState(file, now);
    expect(saved.irrigation).toEqual([]); expect(saved.collection).toEqual([]); expect(saved.plants.some(p => p.id === 'fern')).toBe(true);
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('exposes retained deaths through a read tool and keeps inspect bounded across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-death-world-')), file = join(dir, 'state.json');
  const start = Date.parse('2026-06-01T06:00:00Z'); let now = start + 60_000;
  const s = newState(start); s.plants = [];
  s.bugs = [{ id: 'bug-fixture', species: 'beetle', x: 2, y: 2, ageHours: 5, energy: 40, hunger: 99.99 }];
  const host = { log: { warn() {} }, async pushEvent(event: Omit<EventEnvelope, 'cursor'>) { return { ...event, cursor: 1 }; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => now });
  const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await operationTools(world).find(t => t.name === name)!.handler(args, {} as ToolCallContext)));
  try {
    await saveState(file, s); await world.start(host);
    const result = await call('terrarium_deaths');
    expect(result).toMatchObject({ habitat: 'land', records: [{ organism: { id: 'bug-fixture' }, cause: '饥饿值达到 100' }] });
    expect((await call('terrarium_inspect', { habitat: 'land' })).deaths).toMatchObject({ count: 1, tool: 'terrarium_deaths' });
    const view = await world.webUi().invoke!('garden', 'state', []) as { state: { deaths: unknown[] } };
    expect(view.state.deaths).toEqual(result.records);
    await expect(call('terrarium_deaths', { limit: 49 })).rejects.toThrow('limit');
    await expect(call('terrarium_deaths', { habitat: 'water' })).rejects.toThrow('not claimed');
    await world.stop(); now += 60_000; await world.start(host);
    expect(await call('terrarium_deaths')).toEqual(result);
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('returns changed IDs for collection operations and pages listings without returning frozen state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-receipts-')), file = join(dir, 'state.json');
  const now = Date.parse('2026-06-01T06:00:00Z'), s = newState(now);
  s.collection = Array.from({ length: 47 }, (_, i) => ({ kind: 'plant', specimen: { ...s.plants[0], id: `stored-${i}` } }));
  const host = { log: { warn() {} }, async pushEvent(event: object) { return { ...event, cursor: 1 }; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '' }, timezone: 'UTC', stateFile: file, now: () => now });
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(String(await operationTools(world).find(t => t.name === name)!.handler(args, {} as ToolCallContext)));
  try {
    await saveState(file, s); await world.start(host);
    const collected = await call('terrarium_collection', { action: 'collect', id: 'fern' });
    expect(collected).toMatchObject({ habitat: 'land', action: 'collect', id: 'fern', collectionCount: 48 });
    expect(collected.guide).toMatchObject({ step: 0, ready: false });
    expect(JSON.stringify(collected).length).toBeLessThan(700);
    const page = await call('terrarium_collection', { action: 'list' });
    expect(page.total).toBe(48); expect(page.collection).toHaveLength(5); expect(page.nextOffset).toBe(5);
    expect(page.collection[0].specimen.health).toBeUndefined();
    expect((await call('terrarium_collection', { action: 'list', id: 'fern' })).entry.specimen.health).toBe(100);
    expect(await call('terrarium_collection', { action: 'restore', id: 'fern', x: 0, y: 0 })).toMatchObject({ collectionCount: 47, id: 'fern' });
    const noop = await call('terrarium_water_area', { x1: 0, y1: 0, x2: 4, y2: 4, targetMoisture: 0 });
    expect(noop.soil).toEqual([]); expect(noop.plants).toEqual([]);
    const view = await world.webUi().invoke!('garden', 'state', []) as { state: { collection: unknown[] } };
    expect(view.state.collection).toHaveLength(47);
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});
