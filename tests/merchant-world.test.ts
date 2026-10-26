import { operationTools } from './tool-operations.ts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { newState, saveState } from '../src/state.ts';
import { TerrariumWorld } from '../src/world.ts';

it('shares persisted merchant transactions between the AI tool and WebUI and restores pots after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-merchant-world-'));
  const now = Date.parse('2026-06-01T08:00:00Z'), stateFile = join(dir, 'land', 'state.json'), state = newState(now);
  state.plants[0].growthHours = state.plants[0].naturalGrowthHours = 48; state.plants[0].stage = 3;
  await saveState(stateFile, state);
  const options = { cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: '', tickIntervalMs: 3_600_000 }, stateFile, timezone: 'UTC', now: () => now };
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  let world = new TerrariumWorld(options);
  const call = async (args: Record<string, unknown>) => JSON.parse(String(await operationTools(world).find(t => t.name === 'terrarium_merchant')!.handler(args, {} as ToolCallContext)));
  try {
    await world.start(host);
    expect(await call({ action: 'sell', id: 'fern' })).toMatchObject({ coins: 48 });
    await world.webUi().invoke!('garden', 'care', [{ tool: 'terrarium_merchant', action: 'buy', pot: 'clay' }]);
    expect(await call({ action: 'place', pot: 'clay', x: 0, y: 0 })).toMatchObject({ coins: 24, pots: [{ kind: 'clay', x: 0, y: 0 }] });
    expect(JSON.parse(await readFile(stateFile, 'utf8')).economy).toMatchObject({ earned: 48, spent: 24 });
    await expect(world.webUi().invoke!('water', 'care', [{ tool: 'terrarium_merchant' }])).rejects.toThrow('land');
    await world.stop(); world = new TerrariumWorld(options); await world.start(host);
    expect(await call({})).toMatchObject({ coins: 24, pots: [{ kind: 'clay', x: 0, y: 0 }] });
    expect(await call({ action: 'remove', x: 0, y: 0 })).toMatchObject({ coins: 24, pots: [], inventory: { clay: 1 } });
  } finally { await world.stop(); await rm(dir, { recursive: true, force: true }); }
});
