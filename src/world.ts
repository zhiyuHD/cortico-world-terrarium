import { TERRARIUM_FORUM_TOOL_DECLS, forumRequest } from './forum.ts';
import { deliverVersionNotice, TERRARIUM_VERSION_NOTICE } from './version-notice.ts';
import { capacity, inHabitat, development, guide, guideHint, observeProgress, recordAction, upgradeHabitat, installFacility, advanceGuide, TERRARIUM_FACILITIES } from './progression.ts';
import { landHistory, waterHistory, TERRARIUM_HISTORY_PAGE_SIZE, TERRARIUM_MAX_HISTORY_PAGE_SIZE, TERRARIUM_LAND_HISTORY_METRICS, TERRARIUM_WATER_HISTORY_METRICS } from './history-query.ts';
import { compactNumbers, inspectState, TERRARIUM_INSPECT_SECTIONS, type InspectSection } from './inspect.ts';
import { careAlerts } from './care-alerts.ts';
import { collect, restoreCollected } from './collection.ts';
import { captureConditions, createReturnReport, recentScores, type ReturnReport } from './return-report.ts';
import { landCare, waterCare } from './care.ts';
import { readRules, TERRARIUM_RULE_TOPICS } from './rules.ts';
import type { Announcement } from './announcements.ts';
import { colonySnapshot, isNestEntrance, fillAntEntrance } from './colony.ts';
import { AnnouncementInbox } from './announcement-inbox.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RankAlerts } from './rank-alerts.ts';
import { LeaderboardClient } from './leaderboard.ts';
import type { ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { validateWatering, type WateringOptions, daylight, wateringReport, TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';
import { nowIso } from 'cortico/core/util.ts';
import { TERRARIUM_CONFIG_GROUP, type TerrariumConfigSection } from './config.ts';
import { TERRARIUM_ANT_ACTION_INTERVAL_MS, TERRARIUM_MAX_NAME_LENGTH, renameBox, dropLandFood, newState, migrateState, advance, feedBug, move, phase, releaseBug, relocateBug, removeOrganism, saveState, sow, water, waterSoil, waterArea, type BugSpecies, type ItemId, type SeedSpecies, type TerrariumState } from './state.ts';

import { TERRARIUM_MAX_REPLAYS } from './replay.ts';

import { advanceAquarium, changeWater, dropFishFood, newAquarium, plantAquatic, relocateFish, removeAquatic, stockFish, validAquarium, type AquariumState } from './aquarium.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

const historyProperties = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: TERRARIUM_MAX_HISTORY_PAGE_SIZE, default: TERRARIUM_HISTORY_PAGE_SIZE } };
const wateringProperties = { preview: { type: 'boolean', description: 'Preview watering and warnings on a copy; does not water, heal or save the proposed changes.' }, amount: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'Moisture to add; default 35. Cannot be combined with targetMoisture.' }, targetMoisture: { type: 'number', minimum: 0, maximum: 100, description: 'Only add enough water to reach this moisture; never drains.' }, onlyDry: { type: 'boolean', description: 'Only water cells below the occupant species minimum (30 for empty soil).' } };

export const TERRARIUM_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  { name: 'terrarium_inspect', description: 'Without habitat, list ownership and current overview of both boxes. With habitat, return compact current organisms, environment and record counts. Display precision is one decimal, or three for fractions below one; simulation values are unchanged. Optional section selects soil (land moisture/light matrices and species requirements), care (growth advice), colonies (land nest contents), return (startup changes), objects (food, eggs, webs and irrigation), or residents (paged full organism records). Default summary shows up to 12 of each organism group and includes total counts; use residents for the rest. It excludes stored specimens, history, replays and score curves; use their dedicated tools. Long detail lists are paged with offset (default 0) and limit (default 5, maximum 10). Inspection never claims a box.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, section: { type: 'string', enum: [...TERRARIUM_INSPECT_SECTIONS] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 10 } } } },
  { name: 'terrarium_water', description: 'Water soil by plant id OR x and y, including seed and empty plots. Use preview:true to calculate without applying watering. Defaults to +35 moisture. Supply amount for a smaller dose, or targetMoisture to reach a target without draining. onlyDry skips cells already above their species minimum. Water diffuses to adjacent cells over time. Returns plant moisture ranges and explicit overwatering warnings; actual water additions restore 5 health and do not instantly damage plants.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...wateringProperties, plant: { type: 'string' }, x: { type: 'integer', minimum: 0, maximum: 7 }, y: { type: 'integer', minimum: 0, maximum: 7 } }, oneOf: [{ required: ['plant'], not: { anyOf: [{ required: ['x'] }, { required: ['y'] }] } }, { required: ['x', 'y'], not: { required: ['plant'] } }] } },
  { name: 'terrarium_move', description: 'Move the coin or pebble on the current habitat grid. The pebble shades its cell and orthogonal neighbors, reducing daylight to 35% and slowing daytime evaporation. x and y are 0..size-1.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { item: { type: 'string', enum: ['coin', 'pebble'] }, x: { type: 'integer', minimum: 0, maximum: 7 }, y: { type: 'integer', minimum: 0, maximum: 7 } }, required: ['item', 'x', 'y'] } },
  { name: 'terrarium_sow', description: 'Sow fern, clover, moss, basil, bean, sunflower or mint in a free plot of the current habitat grid. Seeds sprout after two daylight hours with enough soil moisture. Plants grow within their species moisture and light ranges; inspect returns those ranges. Capacity depends on the expansion level; inspect reports current limits.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['fern', 'clover', 'moss', 'basil', 'bean', 'sunflower', 'mint'] }, x: { type: 'integer', minimum: 0, maximum: 7 }, y: { type: 'integer', minimum: 0, maximum: 7 } }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_release_bug', description: 'Release aphid, beetle, ladybug, spider, ant, fruit_fly, mosquito or moth into the current habitat grid. Flying bugs act every ten seconds: 75% chance to move, 25% stay. They eat flower nectar and are caught by spider webs. Ants act every ten seconds; one existing ant becomes the saved queen, workers dig a nest only on empty soil, collect food, enter it and store food; crowded colonies expand from 4×4 to 8×8 and add entrances on empty soil. One ant per surface or nest cell; aphids, beetles and spiders act every minute. Aphids feed on plants when energy is below 70 or hunger reaches 25. Beetles hunt aphids within two cells; ladybugs sense aphids within three cells, spiders hunt ground bugs and weave webs to catch flying bugs. Bugs and eggs share the expansion-level organism limit.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['aphid', 'beetle', 'ladybug', 'spider', 'ant', 'fruit_fly', 'mosquito', 'moth'] }, x: { type: 'integer', minimum: 0, maximum: 7 }, y: { type: 'integer', minimum: 0, maximum: 7 } }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_feed_bug', description: 'Restore 35 energy (maximum 100) to one bug. Does not reduce hunger or prevent starvation; bugs must eat plants, prey or stored ant food.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { bug: { type: 'string' } }, required: ['bug'] } },
  { name: 'terrarium_relocate_bug', description: 'Move one bug by id to a grid cell. Ants require a surface cell without another ant; other bugs may share cells. Predators move and hunt every minute.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { bug: { type: 'string' }, x: { type: 'integer', minimum: 0, maximum: 7 }, y: { type: 'integer', minimum: 0, maximum: 7 } }, required: ['bug', 'x', 'y'] } },
  { name: 'terrarium_remove', description: 'Remove a plant, seed, bug, egg, food pile, spider web or ant nest by ID from the land terrarium.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'terrarium_history', description: 'Read paged hourly history for one plant (including dead or removed plants) OR one soil cell. Returns total, offset, nextOffset and chronological samples. Default 6 samples, maximum 24 per page; offset counts backwards from the latest sample. Optional metric selects moisture, health, growthHours or stage; soil supports moisture only. Missing plants have null values. Display numbers are rounded; saved history is unchanged.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { plant: { type: 'string' }, x: { type: 'integer', minimum: 0, maximum: 7 }, y: { type: 'integer', minimum: 0, maximum: 7 }, metric: { type: 'string', enum: [...TERRARIUM_LAND_HISTORY_METRICS] }, ...historyProperties }, oneOf: [{ required: ['plant'], not: { anyOf: [{ required: ['x'] }, { required: ['y'] }] } }, { required: ['x', 'y'], not: { required: ['plant'] } }] } },
  { name: 'terrarium_rename', description: 'Rename your terrarium. The name is persisted and shown in the WebUI and public leaderboard when reporting is enabled. Names may repeat and do not change the box ID or credentials. Leading and trailing whitespace is removed; use 1..64 characters without control characters.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, name: { type: 'string', minLength: 1, maxLength: TERRARIUM_MAX_NAME_LENGTH } }, required: ['name'] } },
  { name: 'terrarium_replay', description: 'List saved hunts with timestamps and replay IDs, or supply id to read the three recorded scene frames (before movement, contact, after capture). Keeps up to 16 hunts from the last seven days. Earlier unrecorded hunts cannot be replayed.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, id: { type: 'string' } } } },
  { name: 'terrarium_leaderboard', description: 'Read the public land or water ranking, default land. Returns the top limit boxes (default 20, maximum 100), names, scores, score parts and last report times, plus your box rank even outside that limit. Reading requires no claim or token and never registers a box. Rankings use last uploaded states; land and water are separate.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  { name: 'terrarium_set_rank_alerts', description: 'Enable or disable rank-drop events for your land or water box, default land. Alerts default to enabled with a 3-place cumulative drop and 120-minute cooldown; tied-score ID ordering is ignored when supported by the server. Preferences persist across restarts and include instructions for disabling them. Re-enabling starts a fresh baseline without alerts for changes while disabled. This tool never claims a box or changes reporting.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, enabled: { type: 'boolean' } }, required: ['enabled'] } },
  { name: 'terrarium_drop_food', description: 'Drop 1..10 portions of land food at x,y for ants to collect and carry to their nest. At most 20 piles; food outside the nest expires after 48 hours. Ants can also gather from plants, costing one plant health per portion. Nest storage holds 20 portions per depth level, up to five levels.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { x: { type: 'integer', minimum: 0, maximum: 7 }, y: { type: 'integer', minimum: 0, maximum: 7 }, portions: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['x', 'y', 'portions'] } },
  { name: 'terrarium_water_area', description: 'Water an inclusive rectangle of land cells from top-left (x1,y1) to bottom-right (x2,y2), coordinates 0..size-1. Use preview:true to calculate without applying watering. Defaults to +35 moisture per cell. Optional amount OR targetMoisture controls the dose; onlyDry skips sufficiently moist cells. Each actually watered plant gains 5 health once. Includes seed and empty plots; saves and reports once. Use (0,0)-(size-1,size-1) for the whole habitat. Returns each watered plant, its moisture range and overwatering warnings. Excess moisture costs 0.5 health per hour; watering restores 5 health immediately.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...wateringProperties, x1: { type: 'integer', minimum: 0, maximum: 7 }, y1: { type: 'integer', minimum: 0, maximum: 7 }, x2: { type: 'integer', minimum: 0, maximum: 7 }, y2: { type: 'integer', minimum: 0, maximum: 7 } }, required: ['x1', 'y1', 'x2', 'y2'] } },
  { name: 'terrarium_rules', description: 'Read bundled rules by topic without claiming, advancing simulation, saving or making network requests. Topics: overview (ownership and guide), land (plants, insects and nests), water (fish and aquatic plants), care (diagnostics and irrigation), records (history, collections, replays and deaths), ranking (score formula and alerts), reporting (sync, announcements and feedback), expansion (levels and facilities).', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { topic: { type: 'string', enum: [...TERRARIUM_RULE_TOPICS] } }, required: ['topic'] } },
];

const SYNC_TOOL: Omit<ToolDef, 'handler'> = { name: 'terrarium_sync', description: 'Immediately upload a full snapshot of your claimed land or water box, default land. Returns sync status, last server acknowledgement time and any upload error. Does not claim a box, change credentials, or enable reporting when disabled. Sync status is local transport metadata; server error text is external data.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] } } } };

const positionProperties = { x: { type: 'integer', minimum: 0, maximum: 7 }, y: { type: 'integer', minimum: 0, maximum: 7 } };
const careProperties = { habitat: { type: 'string', enum: ['land', 'water'] }, ...positionProperties, id: { type: 'string' }, x1: { type: 'integer', minimum: 0, maximum: 7 }, y1: { type: 'integer', minimum: 0, maximum: 7 }, x2: { type: 'integer', minimum: 0, maximum: 7 }, y2: { type: 'integer', minimum: 0, maximum: 7 } };
const CARE_TOOLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  { name: 'terrarium_fill_ant_hole', description: 'Fill one land ant entrance at x,y. Other entrances retain the same colony. Filling the last entrance removes the nest and its stored food, evacuating ants and eggs to the surface without killing them. Filled soil accepts plants and seeds and cannot be automatically dug again. Surface and nest cells each hold at most one ant; overflow ants are spread across free surface cells.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...positionProperties }, required: ['x', 'y'] } },
  { name: 'terrarium_progress', description: 'Read habitat expansion, unlocked facilities and the optional observation-station story. Defaults to action status and habitat land. Peak score permanently qualifies upgrades: land 120/260/420 or water 120/240/360 points, size 6/7/8, plant and animal limits 18/24/32 each, collection 64/96/128. Upgrade advances one level, spends no score and never downgrades. Install or move one facility of a kind using facility,x,y,enabled (default true). Guide advances one completed chapter and otherwise returns the current chapter without error. Supply the returned step to make retries idempotent; skip ends the optional guide. Existing species and tools remain usable. Does not claim a habitat.', tags: ['read', 'write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, action: { type: 'string', enum: ['status', 'upgrade', 'install', 'guide', 'skip'] }, step: { type: 'integer', minimum: 0, maximum: 6, description: 'Expected current chapter index for an idempotent guide advance.' }, facility: { type: 'string', enum: Object.keys(TERRARIUM_FACILITIES) }, x: { type: 'integer', minimum: 0, maximum: 7 }, y: { type: 'integer', minimum: 0, maximum: 7 }, enabled: { type: 'boolean' } } } },
  { name: 'terrarium_score_history', description: 'Read your own local score samples for the last 24 hours, default habitat land. Earlier samples without a recorded score are null; the public leaderboard can lag behind local simulation.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] } } } },
  { name: 'terrarium_set_ant_foraging', description: 'Allow or forbid ant harvesting of plants in one land cell x,y. enabled:false protects that cell; food piles remain accessible. Does not block aphids.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...positionProperties, enabled: { type: 'boolean' } }, required: ['x', 'y', 'enabled'] } },
  { name: 'terrarium_feed_nest', description: 'Place 1..100 portions directly into an existing ant nest by id. Clamps to nest capacity and returns the actual amount added. Queen and workers can eat the stored food.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, portions: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['id', 'portions'] } },
  { name: 'terrarium_sow_area', description: 'Sow fern, clover, moss, basil, bean, sunflower or mint in an inclusive land rectangle. Skip occupied plots and stop adding seeds at plant capacity; returns planted and skipped counts. Saves and reports once. Sprouting needs two suitable daylight simulation hours; nights do not count. Same-species score contributions are limited to the strongest three.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['fern', 'clover', 'moss', 'basil', 'bean', 'sunflower', 'mint'] }, x1: { type: 'integer', minimum: 0, maximum: 7 }, y1: { type: 'integer', minimum: 0, maximum: 7 }, x2: { type: 'integer', minimum: 0, maximum: 7 }, y2: { type: 'integer', minimum: 0, maximum: 7 } }, required: ['species', 'x1', 'y1', 'x2', 'y2'] } },
  { name: 'terrarium_collection', description: 'List frozen collected organisms, collect an active plant, seed, bug or fish by id, or restore one to x,y within normal habitat capacity. Default habitat land. List defaults to 5 compact entries (maximum 10), with offset and nextOffset; list with id reads one complete specimen. Collect/restore return only the changed id and remaining collection count. Collection holds 48–128 per box depending on expansion level; collected organisms do not simulate or score. Ants return without their former queen role or nest location.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...careProperties, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 10 }, action: { type: 'string', enum: ['list', 'collect', 'restore'] } }, required: ['action'] } },
  { name: 'terrarium_drain', description: 'Drain amount moisture (1..100) from one land cell x,y without healing plants. Use to correct overwatering.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...positionProperties, amount: { type: 'number', minimum: 1, maximum: 100 } }, required: ['x', 'y', 'amount'] } },
  { name: 'terrarium_set_irrigation', description: 'Enable/replace or disable scheduled watering for one land cell x,y. targetMoisture 0..100, intervalMinutes 1..1440 (default 60). Adds water up to target in chronological simulation order, including offline catch-up up to 30 days. Does not call a model.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...positionProperties, enabled: { type: 'boolean' }, targetMoisture: { type: 'number', minimum: 0, maximum: 100 }, intervalMinutes: { type: 'number', minimum: 1, maximum: 1440 } }, required: ['x', 'y', 'enabled'] } },
  { name: 'terrarium_plant_aquatic_area', description: 'Plant one aquatic species in every free cell of an inclusive rectangle, skipping occupied cells. Refuses the entire operation if it would exceed the current aquatic plant capacity.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...careProperties, species: { type: 'string', enum: ['waterweed', 'waterlily', 'algae'] } }, required: ['species', 'x1', 'y1', 'x2', 'y2'] } },
  { name: 'terrarium_reuse_water', description: 'Change percent (1..100) aquarium water and reuse the replaced water on a land rectangle. Both boxes must be claimed. Total moisture points are percent*5 divided among selected cells, capped at 100 per cell. Uses the normal freshwater refill and watering rules.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...careProperties, percent: { type: 'number', minimum: 1, maximum: 100 } }, required: ['percent', 'x1', 'y1', 'x2', 'y2'] } },
];

export const TERRARIUM_AQUATIC_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  ...CARE_TOOLS,
  SYNC_TOOL,
  { name: 'terrarium_feedback', description: 'Submit feedback to the terrarium service administrator, not publicly. text is 1..2000 characters; contact is optional, at most 200 characters. Optional habitat selects an existing box identity, default land. Works without claiming and never registers a box or changes ecosystem state. Returns a stored receipt, not a promise of a reply. Feedback text is user supplied data.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', minLength: 1, maxLength: 2000 }, contact: { type: 'string', maxLength: 200 }, habitat: { type: 'string', enum: ['land', 'water'] } }, required: ['text'] } },
  { name: 'terrarium_claim', description: 'Claim your own land terrarium or water aquarium. Each habitat can be claimed once; repeated calls return the existing box and reuse its persisted server ID/token. No box exists before claiming. Optional name is public when reporting is enabled.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, name: { type: 'string', minLength: 1, maxLength: TERRARIUM_MAX_NAME_LENGTH } }, required: ['habitat'] } },
  { name: 'terrarium_stock_fish', description: 'Add guppy, goldfish or perch to your claimed water aquarium. Perch hunt guppies; goldfish also graze algae. Fish swim and feed every ten minutes. Fish capacity follows the expansion level.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['guppy', 'goldfish', 'perch'] }, ...positionProperties }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_plant_aquatic', description: 'Plant waterweed, waterlily or algae in a free water plot. Daylight plants produce oxygen; plants consume oxygen at night. Aquatic plant capacity follows the expansion level.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: ['waterweed', 'waterlily', 'algae'] }, ...positionProperties }, required: ['species', 'x', 'y'] } },
  { name: 'terrarium_feed_fish', description: 'Drop 1..10 fish food portions at a water grid cell. Fish swim toward food and gain 20 energy per portion. Food pollutes water and expires after six hours. At most 20 piles.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { ...positionProperties, portions: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['x', 'y', 'portions'] } },
  { name: 'terrarium_change_water', description: 'Replace 1..100 percent of aquarium water. Fresh water has cleanliness 100 and oxygen 90; remaining food portions are reduced in the same proportion. Fish lose health below oxygen 25 or cleanliness 30.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { percent: { type: 'number', minimum: 1, maximum: 100 } }, required: ['percent'] } },
  { name: 'terrarium_relocate_fish', description: 'Move one fish to another water grid cell.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { fish: { type: 'string' }, ...positionProperties }, required: ['fish', 'x', 'y'] } },
  { name: 'terrarium_remove_aquatic', description: 'Remove one fish, aquatic plant or food pile by ID from the water aquarium.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'terrarium_deaths', description: 'Read persisted death records for a claimed habitat (default land), newest first, up to 48 (default 10). Includes final observed organism values, last actual meal when recorded, simulation time, cause and environment. Manual removal is excluded; older deaths cannot be reconstructed.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, limit: { type: 'integer', minimum: 1, maximum: 48 } } } },
  { name: 'terrarium_water_history', description: 'Read paged water history: default oxygen and cleanliness only, 6 recent samples (maximum 24). Optional fish id includes that fish only, including dead or removed fish; missing samples are null. Optional metric selects oxygen, cleanliness, health or energy; health/energy require fish id. Returns total, offset, nextOffset and chronological samples; offset counts backwards from the latest sample.', tags: ['read'], parameters: { type: 'object', additionalProperties: false, properties: { ...historyProperties, fish: { type: 'string' }, metric: { type: 'string', enum: [...TERRARIUM_WATER_HISTORY_METRICS] } } } },
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
    this.leaderboard = new LeaderboardClient({ url: opts.cfg.leaderboardUrl, id: typeof legacyId === 'string' ? legacyId : '', automaticIds: true, kind: 'land', token: opts.reportToken, credentialsFile: join(dirname(opts.stateFile), 'report-credentials.json'), incrementalReports: opts.cfg.incrementalReports, requestTimeoutMs: opts.cfg.requestTimeoutMs, onNotice: notice => this.inbox.receive('protocol', { announcements: [notice], nextCursor: 0 }, value => this.pushAnnouncement(value)) });
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
          const state = habitat === 'land' ? this.state : this.waterState;
          if (state) recordAction(state, 'observe');
          return this.view(habitat);
        });
      },
      config: [TERRARIUM_CONFIG_GROUP],
      promptDocs: [{ key: 'worlds.terrarium.envPrompt', title: '生态箱 · 环境提示词', description: '生态箱 World 提供给 bot 的环境说明。', path: ENV_PROMPT_FILE, role: 'envPrompt' }],
    };
  }

  tools(): ToolDef[] {
    const tools: ToolDef[] = [
      { ...TERRARIUM_TOOL_DECLS[15], handler: async args => readRules(args.topic) },
      { ...TERRARIUM_TOOL_DECLS[14], handler: async args => this.serial(async () => JSON.stringify(compactNumbers(await this.waterRectangle(args)))) },
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
        const ranking = await (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).leaderboard(Number(limit));
        const state = habitat === 'land' ? this.state : this.waterState;
        return JSON.stringify({ ...ranking, ...(state ? { localPeakScore: development(state).peakScore, peakSource: 'Local recorded scores under the current formula; public ranking uses the last accepted upload.' } : {}) });
      }) },
      { ...TERRARIUM_TOOL_DECLS[0], handler: async args => this.serial(async () => {
        const section = args.section ?? 'summary', offset = args.offset ?? 0, limit = args.limit ?? 5;
        if (!TERRARIUM_INSPECT_SECTIONS.includes(section as InspectSection)) throw new Error('Unknown inspection section');
        if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 10) throw new Error('Inspection offset must be non-negative and limit must be 1..10');
        if (args.habitat === undefined && section !== 'summary') throw new Error('Detailed inspection requires habitat');
        await this.update();
        if (args.habitat === undefined) { if (this.state) recordAction(this.state, 'observe'); if (this.waterState) recordAction(this.waterState, 'observe'); return JSON.stringify(compactNumbers({ land: this.overview('land'), water: this.overview('water') })); }
        const habitat = this.habitat(args.habitat), ownership = this.inspectOwnership(habitat);
        if (!ownership.claimed) return JSON.stringify(ownership);
        const state = habitat === 'land' ? this.current() : this.currentWater();
        recordAction(state, 'observe');
        return JSON.stringify(compactNumbers({ ...ownership, section, ...inspectState(state, this.now(), this.opts.timezone, section as InspectSection, Number(offset), Number(limit), this.returnReports[habitat]) }));
      }) },
      { ...TERRARIUM_TOOL_DECLS[1], handler: async args => this.serial(async () => {
        if (args.plant !== undefined) {
          if (typeof args.plant !== 'string' || args.x !== undefined || args.y !== undefined) throw new Error('Supply plant OR x and y');
        } else if (!Number.isInteger(args.x) || !Number.isInteger(args.y) || Number(args.x) < 0 || Number(args.x) >= capacity(this.current()).size || Number(args.y) < 0 || Number(args.y) >= capacity(this.current()).size) throw new Error('Position must be in the current habitat grid');
        validateWatering(args as WateringOptions);
        await this.update();
        const state = args.preview === true ? structuredClone(this.current()) : this.current(), target = args.plant === undefined ? { x: Number(args.x), y: Number(args.y) } : state.plants.find(p => p.id === args.plant);
        const before = target ? state.soil[target.y * capacity(state).size + target.x].moisture : undefined;
        const changed: { plant: ReturnType<typeof water> } | { soil: ReturnType<typeof waterSoil> } = args.plant !== undefined ? { plant: water(state, String(args.plant), args as WateringOptions) } : { soil: waterSoil(state, Number(args.x), Number(args.y), args as WateringOptions) };
        if (args.preview !== true) await this.persist();
        const cells = 'plant' in changed ? [changed.plant] : [changed.soil];
        return JSON.stringify(compactNumbers({ preview: args.preview === true, ...changed, watering: { requested: 1, watered: cells[0].moisture !== before ? 1 : 0, skipped: cells[0].moisture === before ? 1 : 0, reason: cells[0].moisture === before ? 'No water added: onlyDry threshold or target already met.' : undefined }, ...wateringReport(state.plants, cells) }));
      }) },
      { ...TERRARIUM_TOOL_DECLS[3], handler: async args => this.serial(async () => {
        await this.update();
        const changed = sow(this.current(), args.species as SeedSpecies, Number(args.x), Number(args.y));
        await this.persist(); return JSON.stringify({ seed: changed, growth: '需要累计 2 个适宜白天模拟小时发芽，夜间不累计。', scoreRule: '同种只取贡献最高的前三株，权重 100%/50%/25%；种子本身不计分。' });
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
        await this.update();
        return JSON.stringify(landHistory(this.current(), args));
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
      ...TERRARIUM_FORUM_TOOL_DECLS.map(decl => ({ ...decl, handler: async (args: Record<string, unknown>) => {
        if (!this.host) throw new Error('Terrarium is not running');
        const habitat = this.habitat(args.habitat ?? 'land');
        const request = forumRequest(decl.name, args);
        return JSON.stringify(await (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).forum(request));
      } })),
      ...TERRARIUM_AQUATIC_TOOL_DECLS.map(decl => ({ ...decl, handler: async (args: Record<string, unknown>) => this.serial(async () => this.aquaticTool(decl.name, args)) })),
    ];
    const guided = new Set(['terrarium_inspect', 'terrarium_water', 'terrarium_water_area', 'terrarium_sow', 'terrarium_sow_area', 'terrarium_release_bug', 'terrarium_stock_fish', 'terrarium_plant_aquatic', 'terrarium_plant_aquatic_area', 'terrarium_feed_fish', 'terrarium_change_water', 'terrarium_collection', 'terrarium_feed_nest']);
    return tools.map(tool => !guided.has(tool.name) ? tool : { ...tool, handler: async (args, context) => {
      const result = await tool.handler(args, context);
      if (typeof result !== 'string') return result;
      const habitat = args.habitat === 'water' || ['terrarium_stock_fish', 'terrarium_plant_aquatic', 'terrarium_plant_aquatic_area', 'terrarium_feed_fish', 'terrarium_change_water'].includes(tool.name) ? 'water' : 'land';
      const state = habitat === 'water' ? this.waterState : this.state;
      if (tool.name === 'terrarium_inspect' && args.habitat === undefined) return result;
      return state ? JSON.stringify({ ...JSON.parse(result), guide: guideHint(state) }) : result;
    } });
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
      const release = TERRARIUM_VERSION_NOTICE;
      await deliverVersionNotice(join(dirname(this.opts.stateFile), 'version-notices.json'), release.version, async () => {
        await host.pushEvent({ type: 'terrarium.updated', source: this.id, senderKey: 'terrarium.updates', origin: 'internal', ts: nowIso(this.opts.timezone), text: `生态箱 World 已更新到 ${release.version}${release.theme ? ` · ${release.theme}` : ''}。本版改进：\n${release.improvements.map(item => `- ${item}`).join('\n')}\n这是本部署对该版本的一次更新说明，重启不会重复投递。无需为此主动联系主人；主人下次聊到生态箱时可按需提及。` }, { trigger: 'piggyback' });
      });
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
    return { habitat, claimed: !!state, ...(state ? { expansion: { ...capacity(state), peakScore: development(state).peakScore, next: development(state).next } } : {}), name: state?.name, id: (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).id, sync: (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).status() };
  }
  private inspectOwnership(habitat: 'land' | 'water') {
    const value = this.ownership(habitat), error = value.sync.lastError;
    return { ...value, sync: { ...value.sync, lastError: error?.slice(0, 256), ...(error && error.length > 256 ? { errorTruncated: true } : {}) } };
  }
  private overview(habitat: 'land' | 'water') {
    const ownership = this.inspectOwnership(habitat);
    const state = habitat === 'land' ? this.state : this.waterState;
    if (!state) return { ...ownership, nextStep: 'terrarium_claim', example: { habitat } };
    if ('fish' in state) return { ...ownership, guide: guideHint(state), plants: state.plants.length, fish: state.fish.length, oxygen: state.oxygen, cleanliness: state.cleanliness, foodPortions: state.food.reduce((n, f) => n + f.portions, 0), lowHealth: [...state.plants, ...state.fish].filter(p => p.health <= 40).map(p => p.id), suggestedFoodCleanup: waterCare(state, this.now(), this.opts.timezone).suggestedFoodCleanup };
    return { ...ownership, guide: guideHint(state), plants: state.plants.length, seeds: state.seeds.length, bugs: state.bugs.length, moisture: { min: Math.min(...state.soil.map(c => c.moisture)), max: Math.max(...state.soil.map(c => c.moisture)) }, dryCells: state.soil.filter(c => { const p = [...state.plants, ...state.seeds].find(p => p.x === c.x && p.y === c.y); return c.moisture < (p ? TERRARIUM_PLANT_REQUIREMENTS[p.species].minMoisture : 30); }).map(c => ({ x: c.x, y: c.y })), lowHealth: state.plants.filter(p => p.health <= 40).map(p => p.id) };
  }
  private view(habitat: 'land' | 'water') {
    const status = this.ownership(habitat);
    if (!status.claimed) return { ...status, claimed: false as const };
    return { ...status, claimed: true as const, state: { ...(habitat === 'land' ? this.snapshot() : { ...structuredClone(this.currentWater()), care: waterCare(this.currentWater(), this.now(), this.opts.timezone), habitat: 'water' as const, phase: phase(this.now(), this.opts.timezone) }), development: development(habitat === 'land' ? this.current() : this.currentWater()), returnReport: this.returnReports[habitat], scoreHistory: recentScores(habitat === 'land' ? this.current() : this.currentWater(), this.now()) } };
  }
  private async waterRectangle(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('Supply rectangle coordinates');
    const { x1, y1, x2, y2 } = value as Record<string, number>;
    if (![x1, y1, x2, y2].every(n => Number.isInteger(n) && n >= 0 && n < capacity(this.current()).size) || x1 > x2 || y1 > y2) throw new Error('Area must be ordered corners within the current habitat grid');
    validateWatering(value as WateringOptions);
    await this.update();
    const preview = (value as Record<string, unknown>).preview === true;
    const state = preview ? structuredClone(this.current()) : this.current();
    const before = state.soil.map(c => c.moisture);
    const soil = waterArea(state, x1, y1, x2, y2, value as WateringOptions).filter(c => c.moisture !== before[c.y * capacity(state).size + c.x]);
    if (!preview) await this.persist();
    const requested = (x2 - x1 + 1) * (y2 - y1 + 1);
    return { preview, soil, watering: { requested, watered: soil.length, skipped: requested - soil.length, reason: soil.length < requested ? 'Skipped cells already meet onlyDry threshold or target moisture.' : undefined }, ...wateringReport(state.plants, soil) };
  }

  private rectangle(args: Record<string, unknown>, state: TerrariumState | AquariumState) {
    const { x1, y1, x2, y2 } = args;
    if (![x1, y1, x2, y2].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < capacity(state).size) || Number(x1) > Number(x2) || Number(y1) > Number(y2)) throw new Error('Area must be ordered corners within the current habitat grid');
    return { x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) };
  }
  private async careTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.update();
    const habitat = this.habitat(args.habitat ?? 'land');
    if (name === 'terrarium_progress') {
      const state = habitat === 'land' ? this.current() : this.currentWater(), action = args.action ?? 'status';
      let guideAdvanced: boolean | undefined;
      if (action === 'status') return { habitat, ...development(state) };
      if (action === 'upgrade') upgradeHabitat(state);
      else if (action === 'install') installFacility(state, args.facility, args.x, args.y, args.enabled);
      else if (action === 'guide') guideAdvanced = advanceGuide(state, args.step as number | undefined);
      else if (action === 'skip') observeProgress(state).guideSkipped = true;
      else throw new Error('Unknown progression action');
      if (habitat === 'land') await this.persist(); else await this.persistWater();
      return { habitat, ...development(state), guideAdvanced };
    }
    if (name === 'terrarium_score_history') return { habitat, hours: 24, samples: recentScores(habitat === 'land' ? this.current() : this.currentWater(), this.now()), source: 'Local simulation score; public leaderboard uses the last accepted upload. Older samples without current-formula scores are null.' };
    if (name === 'terrarium_set_ant_foraging') {
      const state = this.current(), { x, y, enabled } = args;
      if (typeof enabled !== 'boolean' || ![x, y].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < capacity(state).size)) throw new Error('Supply x,y in 0..size-1 and boolean enabled');
      const cell = state.soil[Number(y) * capacity(state).size + Number(x)]; cell.allowAntForaging = enabled;
      await this.persist(); return { soil: cell };
    }
    if (name === 'terrarium_fill_ant_hole') {
      const result = fillAntEntrance(this.current(), args.x as number, args.y as number);
      await this.persist(); return result;
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
    if (name === 'terrarium_sow_area') {
      const state = this.current(), area = this.rectangle(args, state);
      if (typeof args.species !== 'string' || !Object.hasOwn(TERRARIUM_PLANT_REQUIREMENTS, args.species)) throw new Error('Unknown seed species');
      const seeds = []; let skippedOccupied = 0, skippedCapacity = 0;
      for (let y = area.y1; y <= area.y2; y++) for (let x = area.x1; x <= area.x2; x++) {
        if (isNestEntrance(state, x, y) || [...state.plants, ...state.seeds].some(p => p.x === x && p.y === y)) { skippedOccupied++; continue; }
        if (state.plants.length + state.seeds.length >= capacity(state).organisms) { skippedCapacity++; continue; }
        seeds.push(sow(state, args.species as SeedSpecies, x, y));
      }
      if (seeds.length) await this.persist();
      return { seeds, planted: seeds.length, skippedOccupied, skippedCapacity, growth: '累计 2 个适宜白天模拟小时发芽，夜间不累计；同种只计贡献最高的前三株。' };
    }
    if (name === 'terrarium_collection') {
      const state = habitat === 'land' ? this.current() : this.currentWater();
      if (args.action === 'list') {
        const offset = args.offset ?? 0, limit = args.limit ?? 5;
        if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 10) throw new Error('Collection offset must be non-negative and limit must be 1..10');
        const entries = state.collection ?? [];
        if (args.id !== undefined) {
          const entry = entries.find(e => e.specimen.id === args.id);
          if (!entry) throw new Error('Unknown collected organism');
          return { habitat, entry };
        }
        return { habitat, total: entries.length, offset, nextOffset: Number(offset) + Number(limit) < entries.length ? Number(offset) + Number(limit) : null, collection: entries.slice(Number(offset), Number(offset) + Number(limit)).map(e => ({ kind: e.kind, specimen: { id: e.specimen.id, species: e.specimen.species } })) };
      }
      if (typeof args.id !== 'string') throw new Error('Supply organism id');
      if (args.action === 'collect') collect(state, args.id);
      else if (args.action === 'restore') restoreCollected(state, args.id, Number(args.x), Number(args.y));
      else throw new Error('Unknown collection action');
      if (habitat === 'land') await this.persist(); else await this.persistWater();
      return { habitat, action: args.action, id: args.id, ...(args.action === 'restore' ? { x: Number(args.x), y: Number(args.y) } : {}), collectionCount: state.collection?.length ?? 0 };
    }
    if (name === 'terrarium_drain' || name === 'terrarium_set_irrigation') {
      const state = this.current(), x = Number(args.x), y = Number(args.y);
      if (![x, y].every(n => Number.isInteger(n) && n >= 0 && n < capacity(state).size)) throw new Error('Position must be in the current habitat grid');
      if (name === 'terrarium_drain') {
        const amount = Number(args.amount); if (!Number.isFinite(amount) || amount < 1 || amount > 100) throw new Error('Drain amount must be 1..100');
        const cell = state.soil[y * capacity(state).size + x]; cell.moisture = Math.max(0, cell.moisture - amount);
        for (const p of state.plants.filter(p => p.x === x && p.y === y)) { p.moisture = cell.moisture; p.dry = p.moisture < TERRARIUM_PLANT_REQUIREMENTS[p.species].minMoisture; }
      } else {
        if (typeof args.enabled !== 'boolean') throw new Error('enabled must be boolean');
        const targetMoisture = Number(args.targetMoisture), intervalMinutes = Number(args.intervalMinutes ?? 60);
        if (args.enabled && (!Number.isFinite(targetMoisture) || targetMoisture < 0 || targetMoisture > 100 || !Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440)) throw new Error('Supply targetMoisture 0..100 and intervalMinutes 1..1440');
        state.irrigation = (state.irrigation ?? []).filter(c => c.x !== x || c.y !== y);
        if (args.enabled) state.irrigation.push({ x, y, targetMoisture, intervalMinutes, lastWateredAtMs: this.now() });
      }
      await this.persist(); return { soil: state.soil[y * capacity(state).size + x], irrigation: state.irrigation?.find(c => c.x === x && c.y === y) ?? null };
    }
    const area = this.rectangle(args, name === 'terrarium_plant_aquatic_area' ? this.currentWater() : this.current());
    if (name === 'terrarium_plant_aquatic_area') {
      if (!['waterweed', 'waterlily', 'algae'].includes(String(args.species))) throw new Error('Unknown aquatic plant species');
      const state = this.currentWater(), cells = [];
      for (let y = area.y1; y <= area.y2; y++) for (let x = area.x1; x <= area.x2; x++) if (!state.plants.some(p => p.x === x && p.y === y)) cells.push({ x, y });
      if (state.plants.length + cells.length > capacity(state).organisms) throw new Error('Aquatic plant capacity reached');
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
    await this.report(habitat, true);
  }

  private async persistWater(): Promise<void> {
    const state = this.currentWater();
    observeProgress(state);
    await saveState(this.waterFile, state);
    await this.report('water');
  }
  private async aquaticTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.host) throw new Error('Terrarium is not running');
    if (CARE_TOOLS.some(tool => tool.name === name)) return JSON.stringify(compactNumbers(await this.careTool(name, args)));
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
      const existing = habitat === 'land' ? this.state : this.waterState;
      if (existing) return JSON.stringify({ ...this.ownership(habitat), guide: guide(existing), tool: 'terrarium_progress', savedLocally: true, synchronization: (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).status().state === 'synced' ? 'synced' : 'pending; local habitat is claimed and will retry synchronization' });
      const state = habitat === 'land' ? newState(this.now()) : newAquarium(this.now());
      if (args.name !== undefined) renameBox(state, args.name);
      observeProgress(state);
      await saveState(habitat === 'land' ? this.opts.stateFile : this.waterFile, state);
      if (habitat === 'land') this.state = state as TerrariumState; else this.waterState = state as AquariumState;
      try {
        await (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).claim();
        if (habitat === 'land') await this.report(); else await this.report('water');
      } catch (error) { this.host?.log.warn('terrarium.claim.sync.failed', { habitat, error: String(error) }); }
      // Ranking and announcement polling runs on the maintenance schedule.
      return JSON.stringify({ ...this.ownership(habitat), guide: guide(state), tool: 'terrarium_progress', savedLocally: true, synchronization: (habitat === 'land' ? this.leaderboard : this.waterLeaderboard).status().state === 'synced' ? 'synced' : 'pending; local habitat is claimed and will retry synchronization' });
    }
    await this.update();
    if (name === 'terrarium_deaths') {
      const habitat = this.habitat(args.habitat ?? 'land'), limit = args.limit ?? 10;
      if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 48) throw new Error('Death record limit must be 1..48');
      const state = habitat === 'land' ? this.current() : this.currentWater();
      return JSON.stringify({ habitat, records: (state.deaths ?? []).slice(-Number(limit)).reverse() });
    }
    const state = this.currentWater();
    let result: unknown;
    switch (name) {
      case 'terrarium_stock_fish': result = stockFish(state, args.species, Number(args.x), Number(args.y)); break;
      case 'terrarium_plant_aquatic': result = plantAquatic(state, args.species, Number(args.x), Number(args.y)); break;
      case 'terrarium_feed_fish': result = dropFishFood(state, Number(args.x), Number(args.y), Number(args.portions)); break;
      case 'terrarium_change_water': changeWater(state, Number(args.percent)); result = { oxygen: state.oxygen, cleanliness: state.cleanliness }; break;
      case 'terrarium_relocate_fish': result = relocateFish(state, String(args.fish), Number(args.x), Number(args.y)); break;
      case 'terrarium_remove_aquatic': removeAquatic(state, String(args.id)); result = { removed: args.id }; break;
      case 'terrarium_water_history': return JSON.stringify(waterHistory(state, args));
      default: throw new Error('Unknown aquatic tool');
    }
    await this.persistWater();
    return JSON.stringify(result);
  }

  private async persist(): Promise<void> { observeProgress(this.current()); await saveState(this.opts.stateFile, this.current()); await this.report(); }

  private async report(habitat: 'land' | 'water' = 'land', full = false): Promise<void> {
    const state = habitat === 'land' ? this.current() : this.currentWater();
    const client = habitat === 'land' ? this.leaderboard : this.waterLeaderboard;
    try { await client.report(state, phase(this.now(), this.opts.timezone), full); }
    catch (error) { this.host?.log.warn('terrarium.report.failed', { habitat, error: String(error) }); }
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
      observeProgress(state);
      const host = this.host;
      if (!host) return;
      for (const change of changes.filter(c => !['dry', 'health', 'hungry'].includes(c.kind))) await host.pushEvent({
        type: change.kind === 'irrigation' ? 'terrarium.irrigation' : change.kind === 'egg' ? 'terrarium.egg' : change.kind === 'nest' ? 'terrarium.nest' : change.kind === 'phase' ? 'terrarium.phase' : change.kind === 'web' || change.kind === 'stage' || change.kind === 'dry' || change.kind === 'health' ? 'terrarium.plant' : change.kind === 'hunt' ? 'terrarium.hunt' : change.kind === 'birth' ? 'terrarium.birth' : change.kind === 'hungry' ? 'terrarium.hungry' : 'terrarium.ecosystem',
        source: this.id, senderKey: this.id, origin: 'internal', ts: nowIso(this.opts.timezone), text: `生态箱·地：${change.text}`,
      }, { trigger: change.kind === 'phase' || change.kind === 'irrigation' ? 'piggyback' : 'debounce' });
      await this.pushCareAlerts('land', state);
    }
  }

  private async update(): Promise<void> {
    if (!this.host) throw new Error('Terrarium is not running');
    if (this.waterState) {
      const changes = advanceAquarium(this.waterState, this.now(), this.opts.timezone);
      observeProgress(this.waterState);
      for (const change of changes.filter(c => !['hungry', 'oxygen'].includes(c.kind))) await this.host.pushEvent({ type: `terrarium.${change.kind}`, source: this.id, senderKey: 'terrarium.water', origin: 'internal', ts: nowIso(this.opts.timezone), text: `生态箱·水：${change.text}` }, { trigger: 'debounce' });
      await this.pushCareAlerts('water', this.waterState);
    }
    await this.updateLand();
  }

  private async pushCareAlerts(habitat: 'land' | 'water', state: TerrariumState | AquariumState): Promise<void> {
    const host = this.host;
    if (!host) return;
    const changes = careAlerts(state);
    if (changes.length) await host.pushEvent({ type: 'terrarium.care', source: this.id, senderKey: habitat === 'land' ? this.id : 'terrarium.water', origin: 'internal', ts: nowIso(this.opts.timezone), text: `生态箱·${habitat === 'land' ? '地' : '水'}照料变化（${changes.length} 项）：\n${changes.join('\n')}\n可用 terrarium_inspect 查看当前环境和照料建议；无需为此主动联系主人。` }, { trigger: 'debounce' });
  }

  private async synchronize(reportsOnly = false): Promise<void> {
    await this.update();
    if (this.state) await this.persist();
    if (this.waterState) await this.persistWater();
    if (!reportsOnly) { await this.checkRank('land'); await this.checkRank('water'); await this.checkAnnouncements(); }
  }
}
