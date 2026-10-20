import { collect, restoreCollected } from './collection.ts';
import { captureConditions, createReturnReport, recentScores, type ReturnReport } from './return-report.ts';
import { landCare, waterCare } from './care.ts';
import type { Announcement } from './announcements.ts';
import { colonySnapshot } from './colony.ts';
import { AnnouncementInbox } from './announcement-inbox.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RankAlerts } from './rank-alerts.ts';
import { LeaderboardClient } from './leaderboard.ts';
import type { ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { validateWatering, type WateringOptions, daylight, wateringReport, TERRARIUM_MAX_HISTORY, TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';
import { nowIso } from 'cortico/core/util.ts';
import { TERRARIUM_CONFIG_GROUP, type TerrariumConfigSection } from './config.ts';
import { TERRARIUM_ANT_ACTION_INTERVAL_MS, TERRARIUM_MAX_NAME_LENGTH, renameBox, dropLandFood, newState, migrateState, advance, feedBug, move, phase, releaseBug, relocateBug, removeOrganism, saveState, sow, water, waterSoil, waterArea, type BugSpecies, type ItemId, type SeedSpecies, type TerrariumState } from './state.ts';

import { TERRARIUM_MAX_REPLAYS } from './replay.ts';

import { advanceAquarium, changeWater, dropFishFood, newAquarium, plantAquatic, relocateFish, removeAquatic, stockFish, validAquarium, type AquariumState } from './aquarium.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

const wateringProperties = { amount: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'Moisture to add; default 35. Cannot be combined with targetMoisture.' }, targetMoisture: { type: 'number', minimum: 0, maximum: 100, description: 'Only add enough water to reach this moisture; never drains.' }, onlyDry: { type: 'boolean', description: 'Only water cells below the occupant species minimum (30 for empty soil).' } };

export const TERRARIUM_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  { name: 'terrarium_inspect', description: 'Without habitat, list claimed/unclaimed land and water boxes with their server IDs and names. Supply habitat to inspect that box: land has soil, light, plants, bugs and colonies (4x4 cells, resident ants/eggs, queen and stored food); water has oxygen, cleanliness, fish, aquatic plants and food. Includes care diagnostics, growth progress and conditional oxygen forecast. Without habitat returns both box summaries and actionable warnings. Inspection never claims a box.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] } } } },
  { name: 'terrarium_water', description: 'Water soil by plant id OR x and y, including seed and empty plots. Defaults to +35 moisture. Supply amount for a smaller dose, or targetMoisture to reach a target without draining. onlyDry skips cells already above their species minimum. Water diffuses to adjacent cells over time. Returns plant moisture ranges and explicit overwatering warnings; actual water additions restore 5 health and do not instantly damage plants.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...wateringProperties, plant: { type: 'string' }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, oneOf: [{ required: ['plant'], not: { anyOf: [{ required: ['x'] }, { required: ['y'] }] } }, { required: ['x', 'y'], not: { required: ['plant'] } }] } },
  { name: 'terrarium_move', description: 'Move the coin or pebble on the 5×5 grid. The pebble shades its cell and orthogonal neighbors, reducing daylight to 35% and slowing daytime evaporation. x and y are 0..4.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { item: { type: 'string', enum: ['coin', 'pebble'] }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['item', 'x', 'y'] } },
  { name: 'terrarium_sow', description: 'Sow fern, clover, moss, basil or bean in a free plot of the 5×5 grid. Seeds sprout after two daylight hours with enough soil moisture. Plants grow within their species moisture and light ranges; inspect returns those ranges. At most 12 plants and seeds.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['fern', 'clover', 'moss', 'basil', 'bean'] }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_release_bug', description: 'Release aphid, beetle, spider, ant, fruit_fly, mosquito or moth into the 5×5 grid. Flying bugs act every ten seconds: 75% chance to move, 25% stay. They eat flower nectar and are caught by spider webs. Ants act every ten seconds; one existing ant becomes the saved queen, workers dig a nest, collect food, enter it and store food; aphids, beetles and spiders act every minute. Aphids eat plants, beetles hunt aphids, spiders hunt ground bugs and weave webs to catch flying bugs. At most 12 bugs and eggs combined.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['aphid', 'beetle', 'spider', 'ant', 'fruit_fly', 'mosquito', 'moth'] }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_feed_bug', description: 'Restore 35 energy (maximum 100) to one bug. Does not reduce hunger or prevent starvation; bugs must eat plants, prey or stored ant food.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { bug: { type: 'string' } }, required: ['bug'] } },
  { name: 'terrarium_relocate_bug', description: 'Move one bug by id to a grid cell. Bugs may share cells; predators move and hunt every minute.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { bug: { type: 'string' }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['bug', 'x', 'y'] } },
  { name: 'terrarium_remove', description: 'Remove a plant, seed, bug, egg, food pile, spider web or ant nest by ID from the land terrarium.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'terrarium_history', description: 'Read hourly history for one plant (including removed or dead plants) or one soil cell. Supply plant OR x and y. Returns the latest limit samples, default 24, maximum 168. Missing plants have null values.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { plant: { type: 'string' }, x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 }, limit: { type: 'integer', minimum: 1, maximum: TERRARIUM_MAX_HISTORY } }, oneOf: [{ required: ['plant'], not: { anyOf: [{ required: ['x'] }, { required: ['y'] }] } }, { required: ['x', 'y'], not: { required: ['plant'] } }] } },
  { name: 'terrarium_rename', description: 'Rename your terrarium. The name is persisted and shown in the WebUI and public leaderboard when reporting is enabled. Names may repeat and do not change the box ID or credentials. Leading and trailing whitespace is removed; use 1..64 characters without control characters.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, name: { type: 'string', minLength: 1, maxLength: TERRARIUM_MAX_NAME_LENGTH } }, required: ['name'] } },
  { name: 'terrarium_replay', description: 'List saved hunts with timestamps and replay IDs, or supply id to read the three recorded scene frames (before movement, contact, after capture). Keeps up to 16 hunts from the last seven days. Earlier unrecorded hunts cannot be replayed.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, id: { type: 'string' } } } },
  { name: 'terrarium_leaderboard', description: 'Read the public land or water ranking, default land. Returns the top limit boxes (default 20, maximum 100), names, scores, score parts and last report times, plus your box rank even outside that limit. Reading requires no claim or token and never registers a box. Rankings use last uploaded states; land and water are separate.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  { name: 'terrarium_set_rank_alerts', description: 'Enable or disable rank-drop events for your land or water box, default land. Alerts default to enabled with a 3-place cumulative drop and 30-minute cooldown; tied-score ID ordering is ignored when supported by the server. Preferences persist across restarts and include instructions for disabling them. Re-enabling starts a fresh baseline without alerts for changes while disabled. This tool never claims a box or changes reporting.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, enabled: { type: 'boolean' } }, required: ['enabled'] } },
  { name: 'terrarium_drop_food', description: 'Drop 1..10 portions of land food at x,y for ants to collect and carry to their nest. At most 20 piles; food outside the nest expires after 48 hours. Ants can also gather from plants, costing one plant health per portion. Nest storage holds 20 portions per depth level, up to five levels.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 }, portions: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['x', 'y', 'portions'] } },
  { name: 'terrarium_water_area', description: 'Water an inclusive rectangle of land cells from top-left (x1,y1) to bottom-right (x2,y2), coordinates 0..4. Defaults to +35 moisture per cell. Optional amount OR targetMoisture controls the dose; onlyDry skips sufficiently moist cells. Each actually watered plant gains 5 health once. Includes seed and empty plots; saves and reports once. Use (0,0)-(4,4) for all 25 cells. Returns each watered plant, its moisture range and overwatering warnings. Excess moisture costs 0.5 health per hour; watering restores 5 health immediately.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...wateringProperties, x1: { type: 'integer', minimum: 0, maximum: 4 }, y1: { type: 'integer', minimum: 0, maximum: 4 }, x2: { type: 'integer', minimum: 0, maximum: 4 }, y2: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['x1', 'y1', 'x2', 'y2'] } },
];

const SYNC_TOOL: Omit<ToolDef, 'handler'> = { name: 'terrarium_sync', description: 'Immediately upload a full snapshot of your claimed land or water box, default land. Returns sync status, last server acknowledgement time and any upload error. Does not claim a box, change credentials, or enable reporting when disabled. Sync status is local transport metadata; server error text is external data.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] } } } };

const positionProperties = { x: { type: 'integer', minimum: 0, maximum: 4 }, y: { type: 'integer', minimum: 0, maximum: 4 } };
const careProperties = { habitat: { type: 'string', enum: ['land', 'water'] }, ...positionProperties, id: { type: 'string' }, x1: { type: 'integer', minimum: 0, maximum: 4 }, y1: { type: 'integer', minimum: 0, maximum: 4 }, x2: { type: 'integer', minimum: 0, maximum: 4 }, y2: { type: 'integer', minimum: 0, maximum: 4 } };
const CARE_TOOLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  { name: 'terrarium_score_history', description: 'Read your own local score samples for the last 24 hours, default habitat land. Earlier samples without a recorded score are null; the public leaderboard can lag behind local simulation.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] } } } },
  { name: 'terrarium_set_ant_foraging', description: 'Allow or forbid ant harvesting of plants in one land cell x,y. enabled:false protects that cell; food piles remain accessible. Does not block aphids.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...positionProperties, enabled: { type: 'boolean' } }, required: ['x', 'y', 'enabled'] } },
  { name: 'terrarium_feed_nest', description: 'Place 1..100 portions directly into an existing ant nest by id. Clamps to nest capacity and returns the actual amount added. Queen and workers can eat the stored food.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, portions: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['id', 'portions'] } },
  { name: 'terrarium_collection', description: 'List frozen collected organisms, collect an active plant, seed, bug or fish by id, or restore one to x,y within normal habitat capacity. Default habitat land. Collection holds 48 per box; collected organisms do not simulate or score. Ants return without their former queen role or nest location.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...careProperties, action: { type: 'string', enum: ['list', 'collect', 'restore'] } }, required: ['action'] } },
  { name: 'terrarium_drain', description: 'Drain amount moisture (1..100) from one land cell x,y without healing plants. Use to correct overwatering.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...positionProperties, amount: { type: 'number', minimum: 1, maximum: 100 } }, required: ['x', 'y', 'amount'] } },
  { name: 'terrarium_set_irrigation', description: 'Enable/replace or disable scheduled watering for one land cell x,y. targetMoisture 0..100, intervalMinutes 1..1440 (default 60). Adds water up to target in chronological simulation order, including offline catch-up up to 30 days. Does not call a model.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...positionProperties, enabled: { type: 'boolean' }, targetMoisture: { type: 'number', minimum: 0, maximum: 100 }, intervalMinutes: { type: 'number', minimum: 1, maximum: 1440 } }, required: ['x', 'y', 'enabled'] } },
  { name: 'terrarium_plant_aquatic_area', description: 'Plant one aquatic species in every free cell of an inclusive rectangle, skipping occupied cells. Refuses the entire operation if it would exceed 12 aquatic plants.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...careProperties, species: { type: 'string', enum: ['waterweed', 'waterlily', 'algae'] } }, required: ['species', 'x1', 'y1', 'x2', 'y2'] } },
  { name: 'terrarium_reuse_water', description: 'Change percent (1..100) aquarium water and reuse the replaced water on a land rectangle. Both boxes must be claimed. Total moisture points are percent*5 divided among selected cells, capped at 100 per cell. Uses the normal freshwater refill and watering rules.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...careProperties, percent: { type: 'number', minimum: 1, maximum: 100 } }, required: ['percent', 'x1', 'y1', 'x2', 'y2'] } },
];

export const TERRARIUM_AQUATIC_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  ...CARE_TOOLS,
  SYNC_TOOL,
  { name: 'terrarium_feedback', description: 'Submit feedback to the terrarium service administrator, not publicly. text is 1..2000 characters; contact is optional, at most 200 characters. Optional habitat selects an existing box identity, default land. Works without claiming and never registers a box or changes ecosystem state. Returns a stored receipt, not a promise of a reply. Feedback text is user supplied data.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', minLength: 1, maxLength: 2000 }, contact: { type: 'string', maxLength: 200 }, habitat: { type: 'string', enum: ['land', 'water'] } }, required: ['text'] } },
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
  private returnReports: Partial<Record<'land' | 'water', ReturnReport>> = {};
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
  private nextMaintenanceAtMs = 0;
  private readonly now: () => number;
  private readonly leaderboard: LeaderboardClient;

  constructor(private readonly opts: TerrariumWorldOptions) {
    this.now = opts.now ?? Date.now;
    this.inbox = new AnnouncementInbox(join(dirname(opts.stateFile), 'announcement-inbox.json'), opts.cfg.leaderboardUrl ? new URL(opts.cfg.leaderboardUrl).origin : 'disabled');
    this.waterFile = opts.waterStateFile ?? join(dirname(opts.stateFile), 'water', 'state.json');
    this.rankAlerts = { land: new RankAlerts(join(dirname(opts.stateFile), 'rank-alerts.json'), { minDrop: opts.cfg.rankAlertMinDrop, cooldownMinutes: opts.cfg.rankAlertCooldownMinutes }), water: new RankAlerts(join(dirname(this.waterFile), 'rank-alerts.json'), { minDrop: opts.cfg.rankAlertMinDrop, cooldownMinutes: opts.cfg.rankAlertCooldownMinutes }) };
    // The retired config key only selects existing credentials during migration.
    const legacyId = (opts.cfg as TerrariumConfigSection & { leaderboardId?: unknown }).leaderboardId;
    this.waterLeaderboard = new LeaderboardClient({ url: opts.cfg.leaderboardUrl, id: '', automaticIds: true, kind: 'water', credentialsFile: join(dirname(this.waterFile), 'report-credentials.json'), incrementalReports: opts.cfg.incrementalReports, requestTimeoutMs: opts.cfg.requestTimeoutMs, onNotice: notice => this.inbox.receive('protocol', { announcements: [notice], nextCursor: 0 }, value => this.pushAnnouncement(value)) });
    this.leaderboard = new LeaderboardClient({ url: opts.cfg.leaderboardUrl, id: typeof legacyId === 'string' ? legacyId : '', automaticIds: true, token: opts.reportToken, credentialsFile: join(dirname(opts.stateFile), 'report-credentials.json'), incrementalReports: opts.cfg.incrementalReports, requestTimeoutMs: opts.cfg.requestTimeoutMs, onNotice: notice => this.inbox.receive('protocol', { announcements: [notice], nextCursor: 0 }, value => this.pushAnnouncement(value)) });
  }
  envPromptVars(): Record<string, string> { return {}; }

  webUi(): WorldWebUiDecl {
    return {
      panels: [{ id: 'garden', title: '生态箱·地' }, { id: 'water', title: '生态箱·水' }],
      invoke: async (panel, method, args) => {
        if (!['garden', 'water'].includes(panel) || !['state', 'sync', 'feedback', 'water', 'care'].includes(method) || (method === 'water' && panel !== 'garden')) throw new Error('Unknown terrarium panel method');
        return this.serial(async () => {
          const habitat = panel === 'water' ? 'water' : 'land';
          if (method === 'care') {
            const input = args[0] as Record<string, unknown>;
            if (!input || typeof input.tool !== 'string' || !CARE_TOOLS.some(t => t.name === input.tool) && input.tool !== 'terrarium_cleanup_food') throw new Error('Unknown care action');
            await this.careTool(input.tool, { ...input, habitat });
            return this.view(habitat);
          }
          if (method === 'water') {
            const watering = await this.waterRectangle(args[0]);
            return { ...this.view('land'), watering };
          }
          if (method === 'feedback') {
            if (!this.host) throw new Error('Terrarium is not running');
            return (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).feedback(args[0], 'world');
          }
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
      { ...TERRARIUM_TOOL_DECLS[14], handler: async args => this.serial(async () => JSON.stringify(await this.waterRectangle(args))) },
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
        if (args.habitat === undefined) return JSON.stringify({ land: this.overview('land'), water: this.overview('water') });
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
        validateWatering(args as WateringOptions);
        await this.update();
        const changed: { plant: ReturnType<typeof water> } | { soil: ReturnType<typeof waterSoil> } = args.plant !== undefined ? { plant: water(this.current(), String(args.plant), args as WateringOptions) } : { soil: waterSoil(this.current(), Number(args.x), Number(args.y), args as WateringOptions) };
        await this.persist();
        const cells = 'plant' in changed ? [changed.plant] : [changed.soil];
        return JSON.stringify({ ...changed, ...wateringReport(this.current().plants, cells) });
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
    this.returnReports = {};
    const beforeLand = this.state ? captureConditions(this.state) : null;
    const beforeWater = this.waterState ? captureConditions(this.waterState) : null;
    try {
      await this.serial(() => this.synchronize());
      for (const habitat of ['land', 'water'] as const) {
        const before = habitat === 'land' ? beforeLand : beforeWater, state = habitat === 'land' ? this.state : this.waterState;
        if (!before || !state || state.updatedAtMs - before.atMs < 60_000) continue;
        const report = this.returnReports[habitat] = createReturnReport(before, state);
        await host.pushEvent({ type: 'terrarium.return', source: this.id, senderKey: habitat === 'land' ? this.id : 'terrarium.water', origin: 'internal', ts: nowIso(this.opts.timezone), text: `生态箱·${habitat === 'land' ? '地' : '水'}回归自检：距存档 ${report.elapsedHours.toFixed(1)} 小时，按规则补算 ${report.simulatedHours.toFixed(1)} 小时。变化 ${JSON.stringify(report.changes.filter(c => ['score', 'meanMoisture', 'oxygen', 'cleanliness', 'plants', 'bugs', 'seeds', 'fish'].includes(c.metric)))}；已不在箱内 ${JSON.stringify(report.removed)}。${report.warnings.slice(0, 3).join(' ')}${habitat === 'land' ? report.moistureExplanation : ''}可用 terrarium_inspect 查看 returnReport；无需为此主动联系主人。` }, { trigger: 'piggyback' });
      }
    } catch (error) { this.leaderboard.close(); this.waterLeaderboard.close(); this.host = null; this.state = null; this.waterState = null; throw error; }
    this.nextCheckAtMs = this.now() + this.opts.cfg.tickIntervalMs;
    this.nextMaintenanceAtMs = this.now() + this.opts.cfg.tickIntervalMs / 2;
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
        if (this.now() < this.nextCheckAtMs) {
          if (this.now() >= this.nextMaintenanceAtMs) {
            await this.update(); await this.checkRank('land', true); await this.checkRank('water', true); await this.checkAnnouncements(true);
            this.nextMaintenanceAtMs = this.now() + this.opts.cfg.tickIntervalMs;
          } else await this.updateLand();
          return;
        }
        try {
          await this.synchronize(true);
          if (this.now() >= this.nextMaintenanceAtMs) {
            await this.checkRank('land', true); await this.checkRank('water', true); await this.checkAnnouncements(true);
            this.nextMaintenanceAtMs = this.now() + this.opts.cfg.tickIntervalMs;
          }
        }
        finally { this.nextCheckAtMs = this.now() + this.opts.cfg.tickIntervalMs; }
      }).catch(error => this.host?.log.warn('terrarium.tick.failed', { error: String(error) })).finally(() => this.schedule());
    }, Math.max(0, Math.min(nextActionAtMs, this.nextCheckAtMs, this.nextMaintenanceAtMs) - now));
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
    return { care: landCare(state, this.now(), this.opts.timezone), habitat: 'land' as const, phase: currentPhase, ...state, colonies: (state.nests ?? []).map(nest => colonySnapshot(state, nest)), requirements: TERRARIUM_PLANT_REQUIREMENTS, soil: state.soil.map(cell => ({ ...cell, daylight: daylight(state, cell.x, cell.y), light: currentPhase === 'day' ? daylight(state, cell.x, cell.y) : 0 })) };
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
  private overview(habitat: 'land' | 'water') {
    const ownership = this.ownership(habitat);
    const state = habitat === 'land' ? this.state : this.waterState;
    if (!state) return { ...ownership, nextStep: 'terrarium_claim', example: { habitat } };
    if ('fish' in state) return { ...ownership, plants: state.plants.length, fish: state.fish.length, oxygen: state.oxygen, cleanliness: state.cleanliness, foodPortions: state.food.reduce((n, f) => n + f.portions, 0), lowHealth: [...state.plants, ...state.fish].filter(p => p.health <= 40).map(p => p.id), suggestedFoodCleanup: waterCare(state, this.now(), this.opts.timezone).suggestedFoodCleanup };
    return { ...ownership, plants: state.plants.length, seeds: state.seeds.length, bugs: state.bugs.length, moisture: { min: Math.min(...state.soil.map(c => c.moisture)), max: Math.max(...state.soil.map(c => c.moisture)) }, dryCells: state.soil.filter(c => { const p = [...state.plants, ...state.seeds].find(p => p.x === c.x && p.y === c.y); return c.moisture < (p ? TERRARIUM_PLANT_REQUIREMENTS[p.species].minMoisture : 30); }).map(c => ({ x: c.x, y: c.y })), lowHealth: state.plants.filter(p => p.health <= 40).map(p => p.id) };
  }
  private view(habitat: 'land' | 'water') {
    const status = this.ownership(habitat);
    if (!status.claimed) return { ...status, claimed: false as const };
    return { ...status, claimed: true as const, state: { ...(habitat === 'land' ? this.snapshot() : { ...structuredClone(this.currentWater()), care: waterCare(this.currentWater(), this.now(), this.opts.timezone), habitat: 'water' as const, phase: phase(this.now(), this.opts.timezone) }), returnReport: this.returnReports[habitat], scoreHistory: recentScores(habitat === 'land' ? this.current() : this.currentWater(), this.now()) } };
  }
  private async waterRectangle(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('Supply rectangle coordinates');
    const { x1, y1, x2, y2 } = value as Record<string, number>;
    if (![x1, y1, x2, y2].every(n => Number.isInteger(n) && n >= 0 && n <= 4) || x1 > x2 || y1 > y2) throw new Error('Area must be ordered corners within the 5×5 grid');
    validateWatering(value as WateringOptions);
    await this.update();
    const soil = waterArea(this.current(), x1, y1, x2, y2, value as WateringOptions);
    await this.persist();
    return { soil, ...wateringReport(this.current().plants, soil) };
  }

  private rectangle(args: Record<string, unknown>) {
    const { x1, y1, x2, y2 } = args;
    if (![x1, y1, x2, y2].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 4) || Number(x1) > Number(x2) || Number(y1) > Number(y2)) throw new Error('Area must be ordered corners within the 5×5 grid');
    return { x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) };
  }
  private async careTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.update();
    const habitat = this.habitat(args.habitat ?? 'land');
    if (name === 'terrarium_score_history') return { habitat, hours: 24, samples: recentScores(habitat === 'land' ? this.current() : this.currentWater(), this.now()), source: 'Local simulation score; public leaderboard uses the last accepted upload. Older samples without recorded scores are null.' };
    if (name === 'terrarium_set_ant_foraging') {
      const state = this.current(), { x, y, enabled } = args;
      if (typeof enabled !== 'boolean' || ![x, y].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 5)) throw new Error('Supply x,y in 0..4 and boolean enabled');
      const cell = state.soil[Number(y) * 5 + Number(x)]; cell.allowAntForaging = enabled;
      await this.persist(); return { soil: cell };
    }
    if (name === 'terrarium_feed_nest') {
      const state = this.current(), nest = state.nests?.find(n => n.id === args.id), portions = args.portions;
      if (!nest) throw new Error('Unknown ant nest');
      if (typeof portions !== 'number' || !Number.isInteger(portions) || portions < 1 || portions > 100) throw new Error('Supply portions 1..100');
      const added = Math.min(portions, nest.depth * 20 - nest.food); nest.food += added;
      await this.persist(); return { nest, added };
    }
    if (name === 'terrarium_cleanup_food') {
      const state = this.currentWater();
      if (!state.food.some(f => f.id === args.id)) throw new Error('Unknown food pile');
      removeAquatic(state, String(args.id)); await this.persistWater(); return { removed: args.id };
    }
    if (name === 'terrarium_collection') {
      const state = habitat === 'land' ? this.current() : this.currentWater();
      if (args.action === 'list') return { habitat, collection: state.collection ?? [] };
      if (typeof args.id !== 'string') throw new Error('Supply organism id');
      if (args.action === 'collect') collect(state, args.id);
      else if (args.action === 'restore') restoreCollected(state, args.id, Number(args.x), Number(args.y));
      else throw new Error('Unknown collection action');
      if (habitat === 'land') await this.persist(); else await this.persistWater();
      return { habitat, collection: state.collection ?? [] };
    }
    if (name === 'terrarium_drain' || name === 'terrarium_set_irrigation') {
      const state = this.current(), x = Number(args.x), y = Number(args.y);
      if (![x, y].every(n => Number.isInteger(n) && n >= 0 && n <= 4)) throw new Error('Position must be in the 5×5 grid');
      if (name === 'terrarium_drain') {
        const amount = Number(args.amount); if (!Number.isFinite(amount) || amount < 1 || amount > 100) throw new Error('Drain amount must be 1..100');
        const cell = state.soil[y * 5 + x]; cell.moisture = Math.max(0, cell.moisture - amount);
        for (const p of state.plants.filter(p => p.x === x && p.y === y)) { p.moisture = cell.moisture; p.dry = p.moisture < TERRARIUM_PLANT_REQUIREMENTS[p.species].minMoisture; }
      } else {
        if (typeof args.enabled !== 'boolean') throw new Error('enabled must be boolean');
        const targetMoisture = Number(args.targetMoisture), intervalMinutes = Number(args.intervalMinutes ?? 60);
        if (args.enabled && (!Number.isFinite(targetMoisture) || targetMoisture < 0 || targetMoisture > 100 || !Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440)) throw new Error('Supply targetMoisture 0..100 and intervalMinutes 1..1440');
        state.irrigation = (state.irrigation ?? []).filter(c => c.x !== x || c.y !== y);
        if (args.enabled) state.irrigation.push({ x, y, targetMoisture, intervalMinutes, lastWateredAtMs: this.now() });
      }
      await this.persist(); return { soil: state.soil[y * 5 + x], irrigation: state.irrigation ?? [] };
    }
    const area = this.rectangle(args);
    if (name === 'terrarium_plant_aquatic_area') {
      if (!['waterweed', 'waterlily', 'algae'].includes(String(args.species))) throw new Error('Unknown aquatic plant species');
      const state = this.currentWater(), cells = [];
      for (let y = area.y1; y <= area.y2; y++) for (let x = area.x1; x <= area.x2; x++) if (!state.plants.some(p => p.x === x && p.y === y)) cells.push({ x, y });
      if (state.plants.length + cells.length > 12) throw new Error('Aquatic plant capacity reached');
      const plants = cells.map(c => plantAquatic(state, args.species, c.x, c.y)); await this.persistWater(); return { plants };
    }
    if (name === 'terrarium_reuse_water') {
      const land = this.current(), water = this.currentWater(), percent = Number(args.percent);
      if (!Number.isFinite(percent) || percent < 1 || percent > 100) throw new Error('Water change must be 1..100 percent');
      const cells = (area.x2 - area.x1 + 1) * (area.y2 - area.y1 + 1), amount = Math.min(100, percent * 5 / cells);
      changeWater(water, percent); const soil = waterArea(land, area.x1, area.y1, area.x2, area.y2, { amount });
      await this.persist(); await this.persistWater(); return { reusedPercent: percent, soil, oxygen: water.oxygen, cleanliness: water.cleanliness };
    }
    throw new Error('Unknown care tool');
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
    if (CARE_TOOLS.some(tool => tool.name === name)) return JSON.stringify(await this.careTool(name, args));
    if (name === 'terrarium_feedback') {
      const habitat = this.habitat(args.habitat ?? 'land');
      return JSON.stringify(await (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).feedback(args, 'ai'));
    }
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
      const previous = await alerts.observe(`${new URL(this.opts.cfg.leaderboardUrl).origin}|${client.id}`, own?.rank ?? null, now, { competitiveRank: own?.competitiveRank, scoreParts: own?.scoreParts });
      if (previous !== undefined && own && this.host) await this.host.pushEvent({
        type: 'terrarium.overtaken', source: this.id, senderKey: habitat === 'land' ? this.id : 'terrarium.water', origin: 'internal', ts: nowIso(this.opts.timezone),
        text: `生态箱·${habitat === 'land' ? '地' : '水'}：排行榜名次从第 ${previous.rank} 名降至第 ${own.rank} 名，当前 ${own.score} 分。${previous.scoreParts ? `评分分项变化：${Object.entries(own.scoreParts).map(([key, value]) => `${key} ${value - ((previous.scoreParts as unknown as Record<string, number>)[key] ?? 0) >= 0 ? "+" : ""}${value - ((previous.scoreParts as unknown as Record<string, number>)[key] ?? 0)}`).join("，")}。` : ""}按累计下降阈值和提醒间隔合并通知。${own.competitiveRank === undefined ? "服务端未提供同分排名，按原始名次判断。" : "同分 ID 排序不计入下降。"}可以用 terrarium_leaderboard 查看榜单；如果不想打榜，可以调用 terrarium_set_rank_alerts({"habitat":"${habitat}","enabled":false}) 关闭这个箱子的排名提醒，enabled:true 可重新开启。`,
      }, { trigger: 'debounce' });
    } catch (error) { this.host?.log.warn('terrarium.rank.failed', { habitat, error: String(error) }); }
  }

  private async pushAnnouncement(notice: Announcement): Promise<void> {
    const host = this.host;
    if (!host) throw new Error('Terrarium is not running');
    await host.pushEvent({ type: 'terrarium.announcement', source: this.id, senderKey: 'terrarium.announcements', origin: 'external', ts: nowIso(this.opts.timezone), text: `服务端公告 #${notice.id}${notice.title ? ` · ${notice.title}` : ''}（${notice.createdAt}）\n${notice.text}` }, { trigger: 'debounce' });
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
        await this.inbox.receive(id, page, notice => this.pushAnnouncement(notice));
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
        type: change.kind === 'irrigation' ? 'terrarium.irrigation' : change.kind === 'egg' ? 'terrarium.egg' : change.kind === 'nest' ? 'terrarium.nest' : change.kind === 'phase' ? 'terrarium.phase' : change.kind === 'web' || change.kind === 'stage' || change.kind === 'dry' || change.kind === 'health' ? 'terrarium.plant' : change.kind === 'hunt' ? 'terrarium.hunt' : change.kind === 'birth' ? 'terrarium.birth' : change.kind === 'hungry' ? 'terrarium.hungry' : 'terrarium.ecosystem',
        source: this.id, senderKey: this.id, origin: 'internal', ts: nowIso(this.opts.timezone), text: `生态箱·地：${change.text}`,
      }, { trigger: change.kind === 'phase' || change.kind === 'irrigation' ? 'piggyback' : 'debounce' });
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

  private async synchronize(reportsOnly = false): Promise<void> {
    await this.update();
    if (this.state) await this.persist();
    if (this.waterState) await this.persistWater();
    if (!reportsOnly) { await this.checkRank('land'); await this.checkRank('water'); await this.checkAnnouncements(); }
  }
}
