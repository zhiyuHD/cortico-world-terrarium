import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { expect, it, vi } from 'vitest';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { newAquarium } from '../src/aquarium.ts';
import { newState, saveState } from '../src/state.ts';
import { TerrariumWorld } from '../src/world.ts';
import { start as startServer } from '../server/index.ts';
import { createReportProxy } from './report-service.ts';

it.each(['/api/registrations', '/api/leaderboard', '/api/announcements'])('starts and inspects locally while %s is pending, cancels on stop and restarts', async blocked => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-startup-'));
  const file = join(dir, 'land', 'state.json');
  const events: { type: string }[] = [];
  let hold = true, registrations = 0;
  const held: ServerResponse[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    req.resume();
    if (hold && url.pathname === blocked) { held.push(res); return; }
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/registrations') {
      registrations++;
      res.writeHead(201); res.end(JSON.stringify({ id: 'startup-box', token: 'a'.repeat(64) }));
    } else if (url.pathname === '/api/leaderboard') {
      res.end(JSON.stringify({ habitat: 'land', total: 0, entries: [], own: null }));
    } else if (url.pathname === '/api/announcements') {
      res.end(JSON.stringify({ announcements: [{ id: 1, title: 'Startup notice', text: 'Delivered after restart', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), targets: ['startup-box'] }], nextCursor: 1 }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing test port');
  const host = { log: { warn() {} }, async pushEvent(event: { type: string }) { events.push(event); return event; } } as unknown as WorldHost;
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: `http://127.0.0.1:${address.port}`, requestTimeoutMs: 60_000 }, stateFile: file, timezone: 'UTC' });
  try {
    await saveState(file, newState(Date.now() - 60_000));
    await world.start(host);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    const inspect = world.tools().find(tool => tool.name === 'terrarium_inspect')!;
    const result = JSON.parse(String(await inspect.handler({ habitat: 'land' }, {} as ToolCallContext)));
    expect(result.habitat).toBe('land');
    expect(result.plants.length).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(file, 'utf8')).updatedAtMs).toBeGreaterThan(Date.now() - 60_000);
    expect(events.some(event => event.type === 'terrarium.return')).toBe(true);
    await world.stop();
    await vi.waitFor(() => expect(held[0].destroyed).toBe(true));
    expect(events.filter(event => event.type === 'terrarium.announcement')).toHaveLength(0);
    hold = false;
    await world.start(host);
    await vi.waitFor(() => expect(events.filter(event => event.type === 'terrarium.announcement')).toHaveLength(1));
    expect(registrations).toBe(1);
    expect(events.filter(event => event.type === 'terrarium.updated')).toHaveLength(1);
  } finally {
    await world.stop();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

it('synchronizes water while land awaits its first WS acknowledgement and cancels the pending report on stop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-startup-ws-'));
  const file = join(dir, 'land', 'state.json'), waterFile = join(dir, 'water', 'state.json');
  const server = await startServer({ port: 0, dataFile: join(dir, 'service', 'leaderboard.json'), credentialsFile: join(dir, 'service', 'credentials.json') });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing test port');
  let holdLand = true;
  const proxy = await createReportProxy(`http://127.0.0.1:${address.port}`, message => {
    if (holdLand && message.kind === 'full' && (message.state as { kind?: string }).kind !== 'water') {
      holdLand = false;
      proxy.skipNextReply();
    }
  });
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: proxy.url, requestTimeoutMs: 60_000 }, stateFile: file, waterStateFile: waterFile, timezone: 'UTC' });
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  try {
    await saveState(file, newState(Date.now())); await saveState(waterFile, newAquarium(Date.now()));
    await world.start(host);
    const statuses = async () => {
      const panel = world.webUi();
      const land = await panel.invoke!('garden', 'state', []) as { sync: { state: string } };
      const water = await panel.invoke!('water', 'state', []) as { sync: { state: string } };
      return [land.sync.state, water.sync.state];
    };
    await vi.waitFor(async () => expect(await statuses()).toEqual(['syncing', 'synced']));
    const connections = proxy.upgrades.length;
    await world.stop();
    expect(proxy.upgrades).toHaveLength(connections);
    const credentials = await readFile(join(dir, 'land', 'report-credentials.json'), 'utf8');
    await world.start(host);
    await vi.waitFor(async () => expect(await statuses()).toEqual(['synced', 'synced']));
    expect(await readFile(join(dir, 'land', 'report-credentials.json'), 'utf8')).toBe(credentials);
  } finally {
    await world.stop(); await proxy.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
