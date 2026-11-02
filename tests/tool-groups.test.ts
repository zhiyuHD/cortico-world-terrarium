import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, WorldHost } from 'cortico/core/types.ts';
import { expect, it } from 'vitest';
import { start } from '../server/index.ts';
import { TERRARIUM_AQUATIC_PLANTS, TERRARIUM_FISH_SPECIES } from '../src/aquatic-habitat.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { TERRARIUM_TOOL_GROUPS } from '../src/tool-groups.ts';
import { TerrariumWorld } from '../src/world.ts';

/** The aquarium group merges fish and aquatic plant names into one species property. */
function speciesEnum(world: TerrariumWorld): string[] {
  const properties = world.tools().find(tool => tool.name === 'terrarium_aquarium')!.parameters.properties as Record<string, { enum?: string[] }>;
  return properties.species.enum ?? [];
}

function worldAt(dir: string, leaderboardUrl = '') {
  const now = Date.now() - 1_200_000;
  return new TerrariumWorld({
    cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl, tickIntervalMs: 24 * 60 * 60_000 },
    stateFile: join(dir, 'local', 'land', 'state.json'), waterStateFile: join(dir, 'local', 'water', 'state.json'),
    timezone: 'Asia/Shanghai', now: () => now,
  });
}

it('advertises only operations that resolve to a tool', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-groups-'));
  try {
    const context = {} as ToolCallContext;
    const groups = worldAt(dir).tools();
    for (const [name, operations] of Object.entries(TERRARIUM_TOOL_GROUPS)) {
      const group = groups.find(tool => tool.name === name);
      expect(group, name).toBeDefined();
      if (operations.length === 1) continue;
      expect(group!.parameters.required, name).toEqual(['operation']);
      for (const operation of operations) {
        const failure = await group!.handler({ operation }, context).then(() => '', (error: Error) => error.message);
        expect(failure, `${name} advertising ${operation}`).not.toMatch(/Unavailable operation/);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('merges one property name that means different species per operation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-groups-'));
  try {
    expect(new Set(speciesEnum(worldAt(dir)))).toEqual(new Set([...TERRARIUM_FISH_SPECIES, ...Object.keys(TERRARIUM_AQUATIC_PLANTS)]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('stocks a fish through the model-facing aquarium tool', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-groups-'));
  const server = await start({ port: 0, dataFile: join(dir, 'server', 'leaderboard.json'), credentialsFile: join(dir, 'server', 'credentials.json') });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  const world = worldAt(dir, `http://127.0.0.1:${address.port}`);
  const host = { log: { warn() {} }, async pushEvent(event: unknown) { return event; } } as unknown as WorldHost;
  const context = {} as ToolCallContext;
  try {
    await world.start(host);
    const groups = world.tools();
    const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(String(await groups.find(tool => tool.name === name)!.handler(args, context)));
    await call('terrarium_manage', { operation: 'claim', habitat: 'water' });
    const allowed = speciesEnum(world);
    const species = TERRARIUM_FISH_SPECIES.find(value => allowed.includes(value))!;
    const stocked = await call('terrarium_aquarium', { operation: 'stock_fish', species, x: 1, y: 1 });
    expect(stocked.species).toBe(species);
    expect((await call('terrarium_inspect', { habitat: 'water' })).fish[0].species).toBe(species);
  } finally {
    await world.stop();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
