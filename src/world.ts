import { colonySnapshot } from './colony.ts';
import { AnnouncementInbox } from './announcement-inbox.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RankAlerts } from './rank-alerts.ts';
import { LeaderboardClient } from './leaderboard.ts';
import type { ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { daylight, TERRARIUM_MAX_HISTORY, TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';
import { nowIso } from 'cortico/core/util.ts';
import { TERRARIUM_CONFIG_GROUP, type TerrariumConfigSection } from './config.ts';
import { TERRARIUM_ANT_ACTION_INTERVAL_MS, TERRARIUM_MAX_NAME_LENGTH, renameBox, dropLandFood, newState, migrateState, advance, feedBug, move, phase, releaseBug, relocateBug, removeOrganism, saveState, sow, water, waterSoil, type BugSpecies, type ItemId, type SeedSpecies, type TerrariumState } from './state.ts';

import { TERRARIUM_MAX_REPLAYS } from './replay.ts';

import { advanceAquarium, changeWater, dropFishFood, newAquarium, plantAquatic, relocateFish, removeAquatic, stockFish, validAquarium, type AquariumState } from './aquarium.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

export const TERRARIUM_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  { name: 'terrarium_inspect', description: 'Without habitat, list claimed/unclaimed land and water boxes with their server IDs and names. Supply habitat to inspect that box: land has soil, light, plants, bugs and colonies (4x4 cells, resident ants/eggs, queen and stored food); water has oxygen, cleanliness, fish, aquatic plants and food. Inspection never claims a box.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] } } } },
  { name: 'terrarium_water', description: 'Water soil by plant id OR x and y, including seed and empty plots. Adds 35 moisture points up to 100. Water diffuses to adjacent cells over time.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { plant: { type: 'string' }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, oneOf: [{ required: ['plant'], not: { anyOf: [{ required: ['x'] }, { required: ['y'] }] } }, { required: ['x', 'y'], not: { required: ['plant'] } }] } },
  { name: 'terrarium_move', description: 'Move the coin or pebble on the 5×5 grid. The pebble shades its cell and orthogonal neighbors, reducing daylight to 35% and slowing daytime evaporation. x and y are 0..4.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { item: { type: 'string', enum: ['coin', 'pebble'] }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['item', 'x', 'y'] } },
  { name: 'terrarium_sow', description: 'Sow moss, basil or bean in a free plot of the 5×5 grid. Seeds sprout after two daylight hours with enough soil moisture. Plants grow within their species moisture and light ranges; inspect returns those ranges. At most 12 plants and seeds.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['moss', 'basil', 'bean'] }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_release_bug', description: 'Release an aphid, beetle, spider or ant into the 5×5 grid. Ants act every ten seconds; one existing ant becomes the saved queen, workers dig a nest, collect food, enter it and store food; other bugs act every minute. Aphids eat plants, beetles hunt aphids, spiders hunt other bugs. At most 12 bugs and eggs combined.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['aphid', 'beetle', 'spider', 'ant'] }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_feed_bug', description: 'Feed one bug by id, restoring 35 energy up to 100.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { bug: { type: 'string' } }, required: ['bug'] } },
  { name: 'terrarium_relocate_bug', description: 'Move one bug by id to a grid cell. Bugs may share cells; predators move and hunt every minute.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { bug: { type: 'string' }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['bug', 'x', 'y'] } },
  { name: 'terrarium_remove', description: 'Remove a plant, seed, bug, egg, food pile or ant nest by ID from the land terrarium.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'terrarium_history', description: 'Read hourly history for one plant (including removed or dead plants) or one soil cell. Supply plant OR x and y. Returns the latest limit samples, default 24, maximum 168. Missing plants have null values.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { plant: { type: 'string' }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 }, limit: { type: 'integer', minimum: 1, maximum: TERRARIUM_MAX_HISTORY } }, oneOf: [{ required: ['plant'], not: { anyOf: [{ required: ['x'] }, { required: ['y'] }] } }, { required: ['x', 'y'], not: { required: ['plant'] } }] } },
  { name: 'terrarium_rename', description: 'Rename your terrarium. The name is persisted and shown in the WebUI and public leaderboard when reporting is enabled. Names may repeat and do not change the box ID or credentials. Leading and trailing whitespace is removed; use 1..64 characters without control characters.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, name: { type: 'string', minLength: 1, maxLength: TERRARIUM_MAX_NAME_LENGTH } }, required: ['name'] } },
  { name: 'terrarium_replay', description: 'List saved hunts with timestamps and replay IDs, or supply id to read the three recorded scene frames (before movement, contact, after capture). Keeps up to 16 hunts from the last seven days. Earlier unrecorded hunts cannot be replayed.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, id: { type: 'string' } } } },
  { name: 'terrarium_leaderboard', description: 'Read the public land or water ranking, default land. Returns the top limit boxes (default 20, maximum 100), names, scores, score parts and last report times, plus your box rank even outside that limit. Reading requires no claim or token and never registers a box. Rankings use last uploaded states; land and water are separate.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  { name: 'terrarium_set_rank_alerts', description: 'Enable or disable rank-drop events for your land or water box, default land. Alerts default to enabled, persist across restarts and include instructions for disabling them. Re-enabling starts a fresh baseline without alerts for changes while disabled. This tool never claims a box or changes reporting.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, enabled: { type: 'boolean' } }, required: ['enabled'] } },
  { name: 'terrarium_drop_food', description: 'Drop 1..10 portions of land food at x,y for ants to collect and carry to their nest. At most 20 piles; food outside the nest expires after 48 hours. Ants can also gather from plants, costing one plant health per portion. Nest storage holds 20 portions per depth level, up to five levels.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 }, portions: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['x', 'y', 'portions'] } },
];

const SYNC_TOOL: Omit<ToolDef, 'handler'> = { name: 'terrarium_sync', description: 'Immediately upload a full snapshot of your claimed land or water box, default land. Returns sync status, last server acknowledgement time and any upload error. Does not claim a box, change credentials, or enable reporting when disabled. Sync status is local transport metadata; server error text is external data.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] } } } };

const positionProperties = { x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } };
export const TERRARIUM_AQUATIC_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  SYNC_TOOL,
  { name: 'terrarium_claim', description: 'Claim your own land terrarium or water aquarium. Each habitat can be claimed once; repeated calls return the existing box and reuse its persisted server ID/token. No box exists before claiming. Optional name is public when reporting is enabled.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, name: { type: 'string', minLength: 1, maxLength: TERRARIUM_MAX_NAME_LENGTH } }, required: ['habitat'] } },
  { name: 'terrarium_stock_fish', description: 'Add guppy, goldfish or perch to your claimed water aquarium. Perch hunt guppies; goldfish also graze algae. Fish swim and feed every ten minutes. At most 12 fish.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['guppy', 'goldfish', 'perch'] }, ...positionProperties }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_plant_aquatic', description: 'Plant waterweed, waterlily or algae in a free water plot. Daylight plants produce oxygen; plants consume oxygen at night. At most 12 aquatic plants.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['waterweed', 'waterlily', 'algae'] }, ...positionProperties }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_feed_fish', description: 'Drop 1..10 fish food portions at a water grid cell. Fish swim toward food and gain 20 energy per portion. Food pollutes water and expires after six hours. At most 20 piles.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...positionProperties, portions: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['x', 'y', 'portions'] } },
  { name: 'terrarium_change_water', description: 'Replace 1..100 percent of aquarium water. Fresh water has cleanliness 100 and oxygen 90; remaining food portions are reduced in the same proportion. Fish lose health below oxygen 25 or cleanliness 30.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { percent: { type: 'number', minimum: 1, maximum: 100 } }, required: ['percent'] } },
  { name: 'terrarium_relocate_fish', description: 'Move one fish to another water grid cell.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { fish: { type: 'string' }, ...positionProperties }, required: ['fish', 'x', 'y'] } },
  { name: 'terrarium_remove_aquatic', description: 'Remove one fish, aquatic plant or food pile by ID from the water aquarium.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'terrarium_water_history', description: 'Read the last 24 hourly water quality and fish samples, or up to 168 using limit. This tool applies to the water aquarium; terrarium_history applies to land.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 168 } } } },
];

export interface TerrariumWorldOptions { cfg: TerrariumConfigSection; timezone: string; stateFile: string; reportToken?: string; waterStateFile?: string; now?: () => number }

export class TerrariumWorld implements World {
  readonly id = 'terrarium';
  private state: TerrariumState | null = null;
  private waterState: AquariumState | null = null;
  private readonly waterLeaderboard: LeaderboardClient;
  private readonly waterFile: string;
  private readonly rankAlerts: Record<'land' | 'water', RankAlerts>;
  private readonly lastRankCheck = { land: -Infinity, water: -Infinity };
  private readonly inbox: AnnouncementInbox;
  private lastAnnouncementCheck = -Infinity;
  private host: WorldHost | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextCheckAtMs = 0;
  private readonly now: () => number;
  private readonly leaderboard: LeaderboardClient;

  constructor(private readonly opts: TerrariumWorldOptions) {
    this.now = opts.now ?? Date.now;
    this.inbox = new AnnouncementInbox(join(dirname(opts.stateFile), 'announcement-inbox.json'), opts.cfg.leaderboardUrl ? new URL(opts.cfg.leaderboardUrl).origin : 'disabled');
    this.waterFile = opts.waterStateFile ?? join(dirname(opts.stateFile), 'water', 'state.json');
    this.rankAlerts = { land: new RankAlerts(join(dirname(opts.stateFile), 'rank-alerts.json')), water: new RankAlerts(join(dirname(this.waterFile), 'rank-alerts.json')) };
    this.waterLeaderboard = new LeaderboardClient({ url: opts.cfg.leaderboardUrl, id: '', kind: 'water', credentialsFile: join(dirname(this.waterFile), 'report-credentials.json'), incrementalReports: opts.cfg.incrementalReports });
    this.leaderboard = new LeaderboardClient({ url: opts.cfg.leaderboardUrl, id: opts.cfg.leaderboardId, token: opts.reportToken, credentialsFile: join(dirname(opts.stateFile), 'report-credentials.json'), incrementalReports: opts.cfg.incrementalReports });
  }
  envPromptVars(): Record<string, string> { return {}; }

  webUi(): WorldWebUiDecl {
    return {
      panels: [{ id: 'garden', title: '生态箱·地' }, { id: 'water', title: '生态箱·水' }],
      invoke: async (panel, method) => {
        if (!['garden', 'water'].includes(panel) || !['state', 'sync'].includes(method)) throw new Error('Unknown terrarium panel method');
        return this.serial(async () => {
          const habitat = panel === 'water' ? 'water' : 'land';
          if (method === 'sync') await this.reportNow(habitat);
          else await this.update();
          return this.view(habitat);
        });
      },
      config: [TERRARIUM_CONFIG_GROUP],
      promptDocs: [{ key: 'worlds.terrarium.envPrompt', title: '生态箱 · 环境提示词', description: '生态箱 World 提供给 bot 的环境说明。', path: ENV_PROMPT_FILE, role: 'envPrompt' }],
    };
  }

  tools(): ToolDef[] {
    return [
      { ...TERRARIUM_TOOL_DECLS[13], handler: async args => this.serial(async () => {
        await this.update();
        const food = dropLandFood(this.current(), Number(args.x), Number(args.y), Number(args.portions));
        await this.persist(); return JSON.stringify({ food });
      }) },
      { ...TERRARIUM_TOOL_DECLS[12], handler: async args => this.serial(async () => {
        if (!this.host) throw new Error('Terrarium is not running');
        const habitat = this.habitat(args.habitat ?? 'land');
        if (typeof args.enabled !== 'boolean') throw new Error('enabled must be a boolean');
        await this.rankAlerts[habitat].setEnabled(args.enabled);
        return JSON.stringify({ habitat, enabled: this.rankAlerts[habitat].enabled });
      }) },
      { ...TERRARIUM_TOOL_DECLS[11], handler: async args => this.serial(async () => {
        if (!this.host) throw new Error('Terrarium is not running');
        const habitat = this.habitat(args.habitat ?? 'land'), limit = args.limit ?? 20;
        if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error('Leaderboard limit must be 1..100');
        return JSON.stringify(await (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).leaderboard(Number(limit)));
      }) },
      { ...TERRARIUM_TOOL_DECLS[0], handler: async args => this.serial(async () => {
        await this.update();
        if (args.habitat === undefined) return JSON.stringify({ land: this.ownership('land'), water: this.ownership('water') });
        const habitat = this.habitat(args.habitat);
        const view = this.view(habitat);
        if (!view.claimed) return JSON.stringify(view);
        const { history, replays, ...snapshot } = view.state;
        return JSON.stringify({ ...snapshot, id: view.id, sync: view.sync, claimed: true, replays: { count: replays?.length ?? 0, latestId: replays?.at(-1)?.id }, history: { samples: history.length, fromAtMs: history[0]?.recordedAtMs, toAtMs: history.at(-1)?.recordedAtMs } });
      }) },
      { ...TERRARIUM_TOOL_DECLS[1], handler: async args => this.serial(async () => {
        if (args.plant !== undefined) {
          if (typeof args.plant !== 'string' || args.x !== undefined || args.y !== undefined) throw new Error('Supply plant OR x and y');
        } else if (!Number.isInteger(args.x) || !Number.isInteger(args.y) || Number(args.x) < 0 || Number(args.x) > 4 || Number(args.y) < 0 || Number(args.y) > 4) throw new Error('Position must be in the 5×5 grid');
        await this.update();
        const changed = args.plant !== undefined ? { plant: water(this.current(), String(args.plant)) } : { soil: waterSoil(this.current(), Number(args.x), Number(args.y)) };
        await this.persist();
        return JSON.stringify(changed);
      }) },
      { ...TERRARIUM_TOOL_DECLS[3], handler: async args => this.serial(async () => {
        await this.update();
        const changed = sow(this.current(), args.species as SeedSpecies, Number(args.x), Number(args.y));
        await this.persist(); return JSON.stringify({ seed: changed });
      }) },
      { ...TERRARIUM_TOOL_DECLS[4], handler: async args => this.serial(async () => {
        await this.update();
        const changed = releaseBug(this.current(), args.species as BugSpecies, Number(args.x), Number(args.y));
        await this.persist(); return JSON.stringify({ bug: changed });
      }) },
      { ...TERRARIUM_TOOL_DECLS[2], handler: async args => this.serial(async () => {
        if (args.item !== 'coin' && args.item !== 'pebble') throw new Error('Unknown item');
        await this.update();
        const changed = move(this.current(), args.item as ItemId, Number(args.x), Number(args.y));
        await this.persist();
        return JSON.stringify({ item: changed });
      }) },
      { ...TERRARIUM_TOOL_DECLS[5], handler: async args => this.serial(async () => {
        if (typeof args.bug !== 'string') throw new Error('Unknown bug');
        await this.update();
        const changed = feedBug(this.current(), args.bug);
        await this.persist(); return JSON.stringify({ bug: changed });
      }) },
      { ...TERRARIUM_TOOL_DECLS[6], handler: async args => this.serial(async () => {
        if (typeof args.bug !== 'string') throw new Error('Unknown bug');
        await this.update();
        const changed = relocateBug(this.current(), args.bug, Number(args.x), Number(args.y));
        await this.persist(); return JSON.stringify({ bug: changed });
      }) },
      { ...TERRARIUM_TOOL_DECLS[7], handler: async args => this.serial(async () => {
        if (typeof args.id !== 'string') throw new Error('Unknown organism');
        await this.update();
        const removed = removeOrganism(this.current(), args.id);
        await this.persist(); return JSON.stringify({ removed });
      }) },
      { ...TERRARIUM_TOOL_DECLS[8], handler: async args => this.serial(async () => {
        const limit = args.limit ?? 24;
        if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > TERRARIUM_MAX_HISTORY) throw new Error('History limit must be 1..168');
        const plant = args.plant;
        if (plant !== undefined) {
          if (typeof plant !== 'string' || args.x !== undefined || args.y !== undefined) throw new Error('Supply plant OR x and y');
        } else if (!Number.isInteger(args.x) || !Number.isInteger(args.y) || Number(args.x) < 0 || Number(args.x) > 4 || Number(args.y) < 0 || Number(args.y) > 4) throw new Error('Position must be in the 5×5 grid');
        await this.update();
        const state = this.current();
        if (plant !== undefined && !state.plants.some(p => p.id === plant) && !state.history.some(sample => sample.plants.some(p => p.id === plant))) throw new Error('Unknown plant');
        return JSON.stringify(state.history.slice(-Number(limit)).map(sample => plant !== undefined
          ? { recordedAtMs: sample.recordedAtMs, plant: sample.plants.find(p => p.id === plant) ?? null }
          : { recordedAtMs: sample.recordedAtMs, x: args.x, y: args.y, moisture: sample.soilMoisture[Number(args.y) * 5 + Number(args.x)] }));
      }) },
      { ...TERRARIUM_TOOL_DECLS[9], handler: async args => this.serial(async () => {
        const habitat = this.habitat(args.habitat ?? 'land');
        await this.update();
        const name = renameBox(habitat === 'land' ? this.current() : this.currentWater(), args.name);
        if (habitat === 'land') await this.persist(); else await this.persistWater();
        return JSON.stringify({ name });
      }) },
      { ...TERRARIUM_TOOL_DECLS[10], handler: async args => this.serial(async () => {
        if (args.id !== undefined && typeof args.id !== 'string') throw new Error('Replay ID must be a string');
        await this.update();
        const habitat = this.habitat(args.habitat ?? 'land');
        const replays = (habitat === 'land' ? this.current() : this.currentWater()).replays ?? [];
        if (args.id !== undefined) {
          const replay = replays.find(replay => replay.id === args.id);
          if (!replay) throw new Error('Unknown or expired replay');
          return JSON.stringify(replay);
        }
        return JSON.stringify(replays.slice(-TERRARIUM_MAX_REPLAYS).reverse().map(({ frames, ...summary }) => summary));
      }) },
      ...TERRARIUM_AQUATIC_TOOL_DECLS.map(decl => ({ ...decl, handler: async (args: Record<string, unknown>) => this.serial(async () => this.aquaticTool(decl.name, args)) })),
    ];
  }

  async start(host: WorldHost): Promise<void> {
    const read = async (file: string): Promise<unknown | null> => {
      try { return JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    };
    const land = await read(this.opts.stateFile), water = await read(this.waterFile);
    this.state = land === null ? null : migrateState(land);
    if (water !== null && !validAquarium(water)) throw new Error('Invalid aquarium state file');
    this.waterState = water;
    await this.leaderboard.restore(); await this.waterLeaderboard.restore();
    await this.inbox.restore();
    this.lastAnnouncementCheck = -Infinity;
    await this.rankAlerts.land.restore(); await this.rankAlerts.water.restore();
    this.lastRankCheck.land = this.lastRankCheck.water = -Infinity;
    this.host = host;
    try { await this.serial(() => this.synchronize()); }
    catch (error) { this.leaderboard.close(); this.waterLeaderboard.close(); this.host = null; this.state = null; this.waterState = null; throw error; }
    this.nextCheckAtMs = this.now() + this.opts.cfg.tickIntervalMs;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.host = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.queue;
    this.leaderboard.close(); this.waterLeaderboard.close();
    if (this.state) await saveState(this.opts.stateFile, this.state);
    if (this.waterState) await saveState(this.waterFile, this.waterState);
    this.state = null; this.waterState = null;
  }

  private schedule(): void {
    if (!this.host) return;
    const now = this.now();
    const nextActionAtMs = (Math.floor(now / TERRARIUM_ANT_ACTION_INTERVAL_MS) + 1) * TERRARIUM_ANT_ACTION_INTERVAL_MS;
    this.timer = setTimeout(() => {
      void this.serial(async () => {
        if (this.now() < this.nextCheckAtMs) { await this.updateLand(); return; }
        try { await this.synchronize(); }
        finally { this.nextCheckAtMs = this.now() + this.opts.cfg.tickIntervalMs; }
      }).catch(error => this.host?.log.warn('terrarium.tick.failed', { error: String(error) })).finally(() => this.schedule());
    }, Math.max(0, Math.min(nextActionAtMs, this.nextCheckAtMs) - now));
    this.timer.unref();
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  private current(): TerrariumState {
    if (!this.host) throw new Error('Terrarium is not running');
    if (!this.state) throw new Error('Land terrarium is not claimed; use terrarium_claim with habitat land');
    return this.state;
  }

  private snapshot() {
    const state = structuredClone(this.current());
    const currentPhase = phase(this.now(), this.opts.timezone);
    return { habitat: 'land' as const, phase: currentPhase, ...state, colonies: (state.nests ?? []).map(nest => colonySnapshot(state, nest)), requirements: TERRARIUM_PLANT_REQUIREMENTS, soil: state.soil.map(cell => ({ ...cell, daylight: daylight(state, cell.x, cell.y), light: currentPhase === 'day' ? daylight(state, cell.x, cell.y) : 0 })) };
  }

  private habitat(value: unknown): 'land' | 'water' {
    if (value !== 'land' && value !== 'water') throw new Error('Habitat must be land or water');
    return value;
  }
  private currentWater(): AquariumState {
    if (!this.host) throw new Error('Terrarium is not running');
    if (!this.waterState) throw new Error('Water aquarium is not claimed; use terrarium_claim with habitat water');
    return this.waterState;
  }
  private ownership(habitat: 'land' | 'water') {
    const state = habitat === 'land' ? this.state : this.waterState;
    return { habitat, claimed: !!state, name: state?.name, id: (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).id, sync: (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).status() };
  }
  private view(habitat: 'land' | 'water') {
    const status = this.ownership(habitat);
    if (!status.claimed) return { ...status, claimed: false as const };
    return { ...status, claimed: true as const, state: habitat === 'land' ? this.snapshot() : { ...structuredClone(this.currentWater()), habitat: 'water' as const, phase: phase(this.now(), this.opts.timezone) } };
  }
  private async reportNow(habitat: 'land' | 'water'): Promise<void> {
    await this.update();
    const state = habitat === 'land' ? this.current() : this.currentWater();
    const client = habitat === 'land' ? this.leaderboard : this.waterLeaderboard;
    try { await client.report(state, phase(this.now(), this.opts.timezone), true); }
    catch (error) { this.host?.log.warn('terrarium.report.failed', { habitat, error: String(error) }); }
  }

  private async persistWater(): Promise<void> {
    const state = this.currentWater();
    await saveState(this.waterFile, state);
    await this.reportWater();
  }
  private async reportWater(): Promise<void> {
    try { await this.waterLeaderboard.report(this.currentWater(), phase(this.now(), this.opts.timezone)); }
    catch (error) { this.host?.log.warn('terrarium.report.failed', { habitat: 'water', error: String(error) }); }
  }
  private async aquaticTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.host) throw new Error('Terrarium is not running');
    if (name === 'terrarium_sync') {
      const habitat = this.habitat(args.habitat ?? 'land');
      await this.reportNow(habitat);
      return JSON.stringify(this.ownership(habitat));
    }
    if (name === 'terrarium_claim') {
      const habitat = this.habitat(args.habitat);
      if ((habitat === 'land' ? this.state : this.waterState) !== null) return JSON.stringify(this.ownership(habitat));
      const state = habitat === 'land' ? newState(this.now()) : newAquarium(this.now());
      if (args.name !== undefined) renameBox(state, args.name);
      await (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).claim();
      await saveState(habitat === 'land' ? this.opts.stateFile : this.waterFile, state);
      if (habitat === 'land') { this.state = state as TerrariumState; await this.report(); }
      else { this.waterState = state as AquariumState; await this.reportWater(); }
      await this.checkRank(habitat, true);
      await this.checkAnnouncements(true);
      return JSON.stringify(this.ownership(habitat));
    }
    await this.update();
    const state = this.currentWater();
    let result: unknown;
    switch (name) {
      case 'terrarium_stock_fish': result = stockFish(state, args.species, Number(args.x), Number(args.y)); break;
      case 'terrarium_plant_aquatic': result = plantAquatic(state, args.species, Number(args.x), Number(args.y)); break;
      case 'terrarium_feed_fish': result = dropFishFood(state, Number(args.x), Number(args.y), Number(args.portions)); break;
      case 'terrarium_change_water': changeWater(state, Number(args.percent)); result = { oxygen: state.oxygen, cleanliness: state.cleanliness }; break;
      case 'terrarium_relocate_fish': result = relocateFish(state, String(args.fish), Number(args.x), Number(args.y)); break;
      case 'terrarium_remove_aquatic': removeAquatic(state, String(args.id)); result = { removed: args.id }; break;
      case 'terrarium_water_history': {
        const limit = args.limit ?? 24;
        if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 168) throw new Error('History limit must be 1..168');
        return JSON.stringify(state.history.slice(-Number(limit)));
      }
      default: throw new Error('Unknown aquatic tool');
    }
    await this.persistWater();
    return JSON.stringify(result);
  }

  private async persist(): Promise<void> { await saveState(this.opts.stateFile, this.current()); await this.report(); }

  private async report(): Promise<void> {
    try {
      await this.leaderboard.report(this.current(), phase(this.now(), this.opts.timezone));
    } catch (error) { this.host?.log.warn('terrarium.report.failed', { error: String(error) }); }
  }

  private async checkRank(habitat: 'land' | 'water', force = false): Promise<void> {
    const alerts = this.rankAlerts[habitat], client = habitat === 'land' ? this.leaderboard : this.waterLeaderboard;
    if (!(habitat === 'land' ? this.state : this.waterState) || !alerts.enabled || !this.opts.cfg.leaderboardUrl || !client.id) return;
    const now = this.now();
    if (!force && now - this.lastRankCheck[habitat] < this.opts.cfg.tickIntervalMs) return;
    this.lastRankCheck[habitat] = now;
    try {
      const { own } = await client.leaderboard(1);
      const previous = await alerts.observe(`${new URL(this.opts.cfg.leaderboardUrl).origin}|${client.id}`, own?.rank ?? null);
      if (previous !== undefined && own && this.host) await this.host.pushEvent({
        type: 'terrarium.overtaken', source: this.id, senderKey: habitat === 'land' ? this.id : 'terrarium.water', origin: 'internal', ts: nowIso(this.opts.timezone),
        text: `生态箱·${habitat === 'land' ? '地' : '水'}：排行榜名次从第 ${previous} 名降至第 ${own.rank} 名，当前 ${own.score} 分（按最后上报状态排名，同分按 ID 排序）。可以用 terrarium_leaderboard 查看榜单；如果不想打榜，可以调用 terrarium_set_rank_alerts({"habitat":"${habitat}","enabled":false}) 关闭这个箱子的排名提醒，enabled:true 可重新开启。`,
      }, { trigger: 'debounce' });
    } catch (error) { this.host?.log.warn('terrarium.rank.failed', { habitat, error: String(error) }); }
  }

  private async checkAnnouncements(force = false): Promise<void> {
    if (!this.opts.cfg.leaderboardUrl || (!force && this.now() - this.lastAnnouncementCheck < this.opts.cfg.tickIntervalMs)) return;
    this.lastAnnouncementCheck = this.now();
    const clients = [this.leaderboard, this.waterLeaderboard].filter(client => client.id);
    if (!clients.length) clients.push(this.leaderboard);
    for (const client of clients) {
      const id = client.id ?? 'public';
      try {
        const page = await client.announcements(this.inbox.cursor(id));
        await this.inbox.receive(id, page, async notice => {
          const host = this.host;
          if (!host) throw new Error('Terrarium is not running');
          await host.pushEvent({ type: 'terrarium.announcement', source: this.id, senderKey: 'terrarium.announcements', origin: 'external', ts: nowIso(this.opts.timezone), text: `服务端公告 #${notice.id}${notice.title ? ` · ${notice.title}` : ''}（${notice.createdAt}）\n${notice.text}` }, { trigger: 'debounce' });
        });
      } catch (error) { this.host?.log.warn('terrarium.announcements.failed', { error: String(error) }); }
    }
  }

  private async updateLand(): Promise<void> {
    if (!this.host) throw new Error('Terrarium is not running');
    if (this.state) {
      const state = this.state;
      const changes = advance(state, this.now(), this.opts.timezone);
      const host = this.host;
      if (!host) return;
      for (const change of changes) await host.pushEvent({
        type: change.kind === 'egg' ? 'terrarium.egg' : change.kind === 'nest' ? 'terrarium.nest' : change.kind === 'phase' ? 'terrarium.phase' : change.kind === 'stage' || change.kind === 'dry' ? 'terrarium.plant' : change.kind === 'hunt' ? 'terrarium.hunt' : change.kind === 'birth' ? 'terrarium.birth' : change.kind === 'hungry' ? 'terrarium.hungry' : 'terrarium.ecosystem',
        source: this.id, senderKey: this.id, origin: 'internal', ts: nowIso(this.opts.timezone), text: `生态箱·地：${change.text}`,
      }, { trigger: change.kind === 'phase' ? 'piggyback' : 'debounce' });
    }
  }

  private async update(): Promise<void> {
    if (!this.host) throw new Error('Terrarium is not running');
    if (this.waterState) {
      const changes = advanceAquarium(this.waterState, this.now(), this.opts.timezone);
      for (const change of changes) await this.host.pushEvent({ type: `terrarium.${change.kind}`, source: this.id, senderKey: 'terrarium.water', origin: 'internal', ts: nowIso(this.opts.timezone), text: `生态箱·水：${change.text}` }, { trigger: 'debounce' });
    }
    await this.updateLand();
  }

  private async synchronize(): Promise<void> {
    await this.update();
    if (this.state) await this.persist();
    if (this.waterState) await this.persistWater();
    await this.checkRank('land');
    await this.checkRank('water');
    await this.checkAnnouncements();
  }
}
