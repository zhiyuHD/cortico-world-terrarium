import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TerrariumWorld } from '../src/world.ts';
import { newState, saveState, sow } from '../src/state.ts';
import { installFacility, observeProgress, upgradeHabitat, TERRARIUM_LEVELS } from '../src/progression.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
it('persists compost tools, emits fertilizer growth events and exposes inventory after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-compost-'));
  const now = Date.parse('2026-06-01T08:00:00Z'), state = newState(now);
  observeProgress(state).peakScore = TERRARIUM_LEVELS[1].requiredScore; upgradeHabitat(state); installFacility(state, 'compost_bin', 1, 4);
  const seed = sow(state, 'sunflower', 5, 5); state.fertilizer = 10;
  const stateFile = join(dir, 'land', 'state.json'); await saveState(stateFile, state);
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '', tickIntervalMs: 3_600_000 }, stateFile, timezone: 'UTC', now: () => now };
  const events: { text: string }[] = [];
  const host = { log: { warn() {} }, async pushEvent(event: { text: string }) { events.push(event); return event; } } as unknown as WorldHost;
  let world = new TerrariumWorld(options);
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(String(await world.tools().find(t => t.name === name)!.handler(args, {} as ToolCallContext)));
  try {
    await world.start(host);
    expect(await call('terrarium_compost', { action: 'compost', id: 'fern' })).toMatchObject({ fertilizer: 11 });
    expect(await call('terrarium_compost', { action: 'fertilize', x: 5, y: 5, portions: 10 })).toMatchObject({ fertilizer: 1, plant: { id: seed.id, growthHours: 18 } });
    expect(events.some(e => e.text.includes('开花'))).toBe(true);
    expect(JSON.parse(await readFile(stateFile, 'utf8')).fertilizer).toBe(1);
    await world.stop(); world = new TerrariumWorld(options); await world.start(host);
    expect(await call('terrarium_compost', {})).toMatchObject({ fertilizer: 1, installed: true });
    expect(await call('terrarium_inspect', { habitat: 'land', section: 'objects' })).toMatchObject({ compost: { fertilizer: 1 } });
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});
