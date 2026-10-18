// server/announcements.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// src/announcements.ts
var TERRARIUM_MAX_ANNOUNCEMENTS = 2e3;
function validAnnouncement(value) {
  if (!value || typeof value !== "object") return false;
  const notice = value;
  return Number.isSafeInteger(notice.id) && notice.id > 0 && typeof notice.title === "string" && notice.title.length <= 160 && typeof notice.text === "string" && notice.text.trim().length > 0 && notice.text.length <= 2e3 && typeof notice.createdAt === "string" && Number.isFinite(Date.parse(notice.createdAt)) && typeof notice.expiresAt === "string" && Date.parse(notice.expiresAt) > Date.parse(notice.createdAt) && (notice.targets === "all" || Array.isArray(notice.targets) && notice.targets.length > 0 && notice.targets.length <= 100 && notice.targets.every((id) => typeof id === "string" && /^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)));
}

// server/announcements.ts
var AnnouncementStore = class {
  constructor(file) {
    this.file = file;
  }
  file;
  state = { nextId: 1, announcements: [] };
  queue = Promise.resolve();
  async restore() {
    let state;
    try {
      state = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (!state || !Number.isSafeInteger(state.nextId) || state.nextId < 1 || !Array.isArray(state.announcements) || state.announcements.length > TERRARIUM_MAX_ANNOUNCEMENTS || !state.announcements.every((notice, i) => validAnnouncement(notice) && notice.id < state.nextId && (i === 0 || notice.id > state.announcements[i - 1].id))) throw new Error("Invalid announcements file");
    this.state = state;
  }
  page(id, after) {
    const now = Date.now();
    const visible = this.state.announcements.filter((notice) => notice.id > after && Date.parse(notice.expiresAt) > now && (notice.targets === "all" || id !== void 0 && notice.targets.includes(id)));
    const announcements = visible.slice(0, 20);
    return { announcements, nextCursor: visible.length > 20 ? announcements.at(-1).id : this.state.nextId - 1 };
  }
  latestPublic() {
    return { announcements: this.state.announcements.filter((notice) => notice.targets === "all" && Date.parse(notice.expiresAt) > Date.now()).slice(-20), nextCursor: this.state.nextId - 1 };
  }
  list() {
    return this.state.announcements;
  }
  publish(input, registered) {
    return this.serial(async () => {
      const value = input;
      const now = Date.now();
      const notice = { id: this.state.nextId, title: value?.title ?? "", text: value?.text, targets: value?.targets ?? "all", createdAt: new Date(now).toISOString(), expiresAt: value?.expiresAt ?? new Date(now + 7 * 864e5).toISOString() };
      if (!validAnnouncement(notice) || Date.parse(notice.expiresAt) <= now || Date.parse(notice.expiresAt) > now + 30 * 864e5 || notice.targets !== "all" && notice.targets.some((id) => !registered(id))) throw new Error("Invalid announcement: supply text, optional title, registered target IDs and expiry within 30 days");
      const retained = this.state.announcements.filter((entry) => Date.parse(entry.expiresAt) > now);
      if (retained.length >= TERRARIUM_MAX_ANNOUNCEMENTS) throw new Error("Announcement capacity reached; revoke an announcement first");
      await this.save({ nextId: notice.id + 1, announcements: [...retained, notice] });
      return notice;
    });
  }
  revoke(id) {
    return this.serial(async () => {
      if (!this.state.announcements.some((notice) => notice.id === id)) return false;
      await this.save({ ...this.state, announcements: this.state.announcements.filter((notice) => notice.id !== id) });
      return true;
    });
  }
  serial(work) {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {
    });
    return result;
  }
  async save(state) {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 384 });
    await rename(`${this.file}.tmp`, this.file);
    this.state = state;
  }
};

// server/index.ts
import { createServer } from "node:http";
import { readFile as readFile2, mkdir as mkdir2, rename as rename2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2 } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

// src/colony.ts
var TERRARIUM_NEST_SIZE = 4;
function validColony(state) {
  const nests = state.nests ?? [];
  const validResident = (resident) => {
    if (resident.inside === void 0) return true;
    const p = resident.inside;
    const nest = nests.find((nest2) => nest2.id === p?.nestId);
    return resident.species === "ant" && !!nest && resident.x === nest.x && resident.y === nest.y && Number.isInteger(p.x) && p.x >= 0 && p.x < TERRARIUM_NEST_SIZE && Number.isInteger(p.y) && p.y >= 0 && p.y < TERRARIUM_NEST_SIZE;
  };
  return state.bugs.every((bug) => (bug.role === void 0 || bug.species === "ant" && ["queen", "worker"].includes(bug.role)) && validResident(bug)) && state.bugs.filter((bug) => bug.role === "queen").length <= 1 && (state.eggs ?? []).every(validResident);
}

// src/habitat.ts
var TERRARIUM_PLANT_REQUIREMENTS = {
  fern: { minMoisture: 30, maxMoisture: 85, minLight: 0.15, maxLight: 0.7 },
  clover: { minMoisture: 20, maxMoisture: 80, minLight: 0.45, maxLight: 1 },
  moss: { minMoisture: 45, maxMoisture: 90, minLight: 0.15, maxLight: 0.4 },
  basil: { minMoisture: 30, maxMoisture: 75, minLight: 0.65, maxLight: 1 },
  bean: { minMoisture: 25, maxMoisture: 70, minLight: 0.7, maxLight: 1 }
};
var TERRARIUM_MAX_HISTORY = 168;

// src/replay.ts
var TERRARIUM_MAX_REPLAYS = 16;
var TERRARIUM_REPLAY_RETENTION_MS = 7 * 24 * 60 * 6e4;

// src/state.ts
var TERRARIUM_MAX_NAME_LENGTH = 64;
function validName(value) {
  return typeof value === "string" && value === value.trim() && Array.from(value).length >= 1 && Array.from(value).length <= TERRARIUM_MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
var HOUR_MS = 60 * 6e4;
var MAX_CATCHUP_MS = 30 * 24 * HOUR_MS;
function newState(nowMs) {
  const state = { version: 3, soil: Array.from({ length: 25 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5), moisture: 50 })), history: [], updatedAtMs: nowMs, nextId: 1, plants: [
    { id: "fern", species: "fern", x: 0, y: 0, moisture: 45, growthHours: 0, stage: 0, dry: false, health: 100 },
    { id: "clover", species: "clover", x: 4, y: 0, moisture: 50, growthHours: 0, stage: 0, dry: false, health: 100 }
  ], seeds: [], bugs: [], items: [{ id: "coin", x: 1, y: 1 }, { id: "pebble", x: 2, y: 1 }] };
  for (const plant of state.plants) state.soil[plant.y * 5 + plant.x].moisture = plant.moisture;
  recordHistory(state, nowMs);
  return state;
}
var inGrid = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 5 && y >= 0 && y < 5;
function recordHistory(state, recordedAtMs) {
  state.history.push({ recordedAtMs, soilMoisture: state.soil.map((cell) => cell.moisture), plants: state.plants.map(({ id, species, moisture, health, stage, growthHours }) => ({ id, species, moisture, health, stage, growthHours })) });
  state.history = state.history.filter((sample) => sample.recordedAtMs >= recordedAtMs - TERRARIUM_MAX_HISTORY * HOUR_MS).slice(-TERRARIUM_MAX_HISTORY);
}
function migrateState(value) {
  if (value?.version === 1) {
    const old = value;
    if (!Number.isFinite(old.updatedAtMs) || !Array.isArray(old.plants) || old.plants.length !== 2 || !Array.isArray(old.items)) throw new Error("Invalid terrarium state file");
    const migrated = newState(old.updatedAtMs);
    migrated.plants = old.plants.map((p) => ({ ...p, species: p.id, x: p.id === "fern" ? 0 : 4, y: 0, health: 100 }));
    migrated.items = old.items;
    if (!validState(migrated)) throw new Error("Invalid terrarium state file");
    initializeHabitat(migrated);
    return migrated;
  }
  if (value?.version === 2) {
    const migrated = { ...value, version: 3, soil: newState(0).soil, history: [] };
    if (!validState(migrated)) throw new Error("Invalid terrarium state file");
    initializeHabitat(migrated);
    return migrated;
  }
  if (value?.version === 3 && Array.isArray(value.history)) {
    value = { ...value, history: value.history.map((sample) => {
      if (sample && typeof sample === "object" && !Object.hasOwn(sample, "recordedAtMs") && Object.hasOwn(sample, "atMs")) {
        const { atMs, ...rest } = sample;
        return { ...rest, recordedAtMs: atMs };
      }
      return sample;
    }) };
  }
  if (!validState(value)) throw new Error("Invalid terrarium state file");
  return value;
}
function initializeHabitat(state) {
  for (const plant of state.plants) {
    state.soil[plant.y * 5 + plant.x].moisture = plant.moisture;
    plant.dry = plant.moisture < TERRARIUM_PLANT_REQUIREMENTS[plant.species].minMoisture;
  }
  state.history = [];
  recordHistory(state, state.updatedAtMs);
}
function validHabitat(state) {
  const percent2 = (value) => Number.isFinite(value) && value >= 0 && value <= 100;
  return Array.isArray(state.soil) && state.soil.length === 25 && state.soil.every((cell, i) => cell && cell.x === i % 5 && cell.y === Math.floor(i / 5) && percent2(cell.moisture)) && Array.isArray(state.history) && state.history.length <= TERRARIUM_MAX_HISTORY && state.history.every((sample, i) => sample && Number.isFinite(sample.recordedAtMs) && sample.recordedAtMs <= state.updatedAtMs && (i === 0 || sample.recordedAtMs > state.history[i - 1].recordedAtMs) && Array.isArray(sample.soilMoisture) && sample.soilMoisture.length === 25 && sample.soilMoisture.every(percent2) && Array.isArray(sample.plants) && sample.plants.length <= 12 && sample.plants.every((p) => p && typeof p.id === "string" && p.id.length <= 32 && Object.hasOwn(TERRARIUM_PLANT_REQUIREMENTS, p.species) && percent2(p.moisture) && percent2(p.health) && Number.isInteger(p.stage) && p.stage >= 0 && p.stage <= 3 && Number.isFinite(p.growthHours) && p.growthHours >= 0));
}
function validReplays(state) {
  return state.replays === void 0 || Array.isArray(state.replays) && state.replays.length <= TERRARIUM_MAX_REPLAYS && state.replays.every((replay, i) => {
    if (!replay || typeof replay.id !== "string" || replay.id.length > 160 || typeof replay.hunterId !== "string" || typeof replay.preyId !== "string" || !Number.isFinite(replay.recordedAtMs) || replay.recordedAtMs > state.updatedAtMs || i > 0 && replay.recordedAtMs < state.replays[i - 1].recordedAtMs || !Array.isArray(replay.frames) || replay.frames.length !== 3) return false;
    if (!replay.frames.every((frame) => frame && (frame.phase === "day" || frame.phase === "night") && validState({ ...frame, version: 3, nextId: state.nextId, updatedAtMs: replay.recordedAtMs, history: [], replays: void 0 }))) return false;
    const [before, contact, after] = replay.frames;
    const hunter = contact.bugs.find((bug) => bug.id === replay.hunterId);
    const prey = contact.bugs.find((bug) => bug.id === replay.preyId);
    return !!hunter && !!prey && hunter.x === prey.x && hunter.y === prey.y && (hunter.species === "spider" ? prey.species !== "spider" : hunter.species === "beetle" && prey.species === "aphid") && before.bugs.some((bug) => bug.id === hunter.id) && before.bugs.some((bug) => bug.id === prey.id) && after.bugs.some((bug) => bug.id === hunter.id) && !after.bugs.some((bug) => bug.id === prey.id);
  }) && new Set(state.replays.map((replay) => replay.id)).size === state.replays.length;
}
function validState(value) {
  if (!value || typeof value !== "object") return false;
  const state = value;
  return state.version === 3 && (state.name === void 0 || validName(state.name)) && validHabitat(state) && validReplays(state) && Number.isFinite(state.updatedAtMs) && Number.isSafeInteger(state.nextId) && state.nextId >= 1 && Array.isArray(state.plants) && state.plants.length <= 12 && state.plants.every((p) => p && typeof p.id === "string" && p.id.length <= 32 && ["fern", "clover", "moss", "basil", "bean"].includes(p.species) && inGrid(p.x, p.y) && Number.isFinite(p.moisture) && p.moisture >= 0 && p.moisture <= 100 && Number.isFinite(p.growthHours) && p.growthHours >= 0 && Number.isInteger(p.stage) && p.stage >= 0 && p.stage <= 3 && typeof p.dry === "boolean" && Number.isFinite(p.health) && p.health >= 0 && p.health <= 100) && Array.isArray(state.seeds) && state.seeds.length <= 12 && state.plants.length + state.seeds.length <= 12 && state.seeds.every((s) => s && typeof s.id === "string" && ["moss", "basil", "bean"].includes(s.species) && inGrid(s.x, s.y) && Number.isFinite(s.ageHours) && s.ageHours >= 0) && Array.isArray(state.bugs) && state.bugs.length <= 12 && state.bugs.every((b) => b && typeof b.id === "string" && ["aphid", "beetle", "spider", "ant"].includes(b.species) && inGrid(b.x, b.y) && Number.isFinite(b.energy) && b.energy >= 0 && b.energy <= 100 && (b.carrying === void 0 || b.species === "ant" && Number.isInteger(b.carrying) && b.carrying >= 0 && b.carrying <= 5) && Number.isFinite(b.ageHours) && b.ageHours >= 0) && (state.eggs === void 0 || Array.isArray(state.eggs) && state.eggs.length <= 12 && state.eggs.every((egg) => egg && typeof egg.id === "string" && egg.id.length <= 32 && ["beetle", "spider", "ant"].includes(egg.species) && inGrid(egg.x, egg.y) && Number.isFinite(egg.laidAtMs) && egg.laidAtMs <= state.updatedAtMs && Number.isFinite(egg.hatchesAtMs) && egg.hatchesAtMs > egg.laidAtMs && egg.hatchesAtMs <= egg.laidAtMs + 6 * HOUR_MS)) && state.bugs.length + (state.eggs?.length ?? 0) <= 12 && (state.nests === void 0 || Array.isArray(state.nests) && state.nests.length <= 5 && state.nests.every((nest) => nest && typeof nest.id === "string" && nest.id.length <= 32 && inGrid(nest.x, nest.y) && Number.isInteger(nest.depth) && nest.depth >= 1 && nest.depth <= 5 && Number.isInteger(nest.food) && nest.food >= 0 && nest.food <= nest.depth * 20) && new Set(state.nests.map((nest) => `${nest.x},${nest.y}`)).size === state.nests.length) && (state.food === void 0 || Array.isArray(state.food) && state.food.length <= 20 && state.food.every((food) => food && typeof food.id === "string" && food.id.length <= 32 && inGrid(food.x, food.y) && Number.isInteger(food.portions) && food.portions >= 1 && food.portions <= 10 && Number.isFinite(food.droppedAtMs) && food.droppedAtMs <= state.updatedAtMs)) && Array.isArray(state.items) && state.items.length === 2 && ["coin", "pebble"].every((id) => state.items.filter((item) => item.id === id && inGrid(item.x, item.y)).length === 1) && !(state.items[0].x === state.items[1].x && state.items[0].y === state.items[1].y) && new Set([...state.plants, ...state.seeds, ...state.bugs, ...state.eggs ?? [], ...state.nests ?? [], ...state.food ?? []].map((v) => v.id)).size === state.plants.length + state.seeds.length + state.bugs.length + (state.eggs?.length ?? 0) + (state.nests?.length ?? 0) + (state.food?.length ?? 0) && new Set([...state.plants, ...state.seeds].map((v) => `${v.x},${v.y}`)).size === state.plants.length + state.seeds.length && validColony(state);
}

// src/aquarium.ts
var TERRARIUM_FISH_ACTION_INTERVAL_MS = 10 * 6e4;
var grid = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 5 && y >= 0 && y < 5;
var percent = (value) => Number.isFinite(value) && value >= 0 && value <= 100;
function validFrame(value, atMs) {
  if (!value || typeof value !== "object") return false;
  const s = value;
  const id = (value2) => typeof value2 === "string" && value2.length >= 1 && value2.length <= 32;
  return s.kind === "water" && ["day", "night"].includes(s.phase) && percent(s.oxygen) && percent(s.cleanliness) && Array.isArray(s.fish) && s.fish.length <= 12 && s.fish.every((f) => f && id(f.id) && ["guppy", "goldfish", "perch"].includes(f.species) && grid(f.x, f.y) && percent(f.energy) && percent(f.health) && Number.isFinite(f.ageHours) && f.ageHours >= 0) && Array.isArray(s.plants) && s.plants.length <= 12 && s.plants.every((p) => p && id(p.id) && ["waterweed", "waterlily", "algae"].includes(p.species) && grid(p.x, p.y) && percent(p.health) && Number.isFinite(p.growthHours) && p.growthHours >= 0 && Number.isInteger(p.stage) && p.stage >= 0 && p.stage <= 3) && Array.isArray(s.food) && s.food.length <= 20 && s.food.every((f) => f && id(f.id) && grid(f.x, f.y) && Number.isInteger(f.portions) && f.portions >= 1 && f.portions <= 10 && Number.isFinite(f.droppedAtMs) && f.droppedAtMs <= atMs) && new Set([...s.fish, ...s.plants, ...s.food].map((v) => v.id)).size === s.fish.length + s.plants.length + s.food.length && new Set(s.plants.map((p) => `${p.x},${p.y}`)).size === s.plants.length;
}
function validAquarium(value) {
  if (!value || typeof value !== "object") return false;
  const s = value;
  return s.version === 1 && Number.isFinite(s.updatedAtMs) && Number.isSafeInteger(s.nextId) && s.nextId >= 1 && (s.name === void 0 || typeof s.name === "string" && s.name === s.name.trim() && Array.from(s.name).length >= 1 && Array.from(s.name).length <= TERRARIUM_MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f-\u009f]/.test(s.name)) && validFrame({ ...s, phase: "day" }, s.updatedAtMs) && Array.isArray(s.history) && s.history.length <= 168 && s.history.every((h, i) => h && Number.isFinite(h.recordedAtMs) && h.recordedAtMs <= s.updatedAtMs && (i === 0 || h.recordedAtMs > s.history[i - 1].recordedAtMs) && percent(h.oxygen) && percent(h.cleanliness) && validFrame({ kind: "water", phase: "day", oxygen: h.oxygen, cleanliness: h.cleanliness, fish: h.fish, plants: [], food: [] }, h.recordedAtMs)) && Array.isArray(s.replays) && s.replays.length <= TERRARIUM_MAX_REPLAYS && new Set(s.replays.map((r) => r?.id)).size === s.replays.length && s.replays.every((r, i) => {
    if (!r || typeof r.id !== "string" || r.id.length > 160 || !Number.isFinite(r.recordedAtMs) || r.recordedAtMs > s.updatedAtMs || i > 0 && r.recordedAtMs < s.replays[i - 1].recordedAtMs || !Array.isArray(r.frames) || r.frames.length !== 3 || !r.frames.every((f) => validFrame(f, r.recordedAtMs))) return false;
    const [before, contact, after] = r.frames;
    const hunter = contact.fish.find((f) => f.id === r.hunterId), prey = contact.fish.find((f) => f.id === r.preyId);
    return !!hunter && !!prey && hunter.species === "perch" && prey.species === "guppy" && hunter.x === prey.x && hunter.y === prey.y && before.fish.some((f) => f.id === hunter.id) && before.fish.some((f) => f.id === prey.id) && after.fish.some((f) => f.id === hunter.id) && !after.fish.some((f) => f.id === prey.id);
  });
}

// src/scoring.ts
function scoreParts(state) {
  if ("fish" in state) return {
    plants: state.plants.reduce((sum, plant) => sum + Math.round((plant.stage + 1) * plant.health / 10), 0),
    fish: state.fish.reduce((sum, fish) => sum + Math.round(fish.health / 10 + fish.energy / 10), 0),
    water: Math.round((state.oxygen + state.cleanliness) / 10)
  };
  return {
    plants: state.plants.reduce((sum, plant) => sum + Math.round((plant.stage + 1) * plant.health / 10 + plant.moisture / 20), 0),
    bugs: state.bugs.reduce((sum, bug) => sum + Math.round(bug.energy / 20 + (bug.species === "spider" ? 4 : bug.species === "beetle" ? 3 : bug.species === "ant" ? 2 : 1)), 0),
    seeds: state.seeds.length * 2
  };
}
function score(state) {
  return Object.values(scoreParts(state)).reduce((sum, part) => sum + part, 0);
}

// server/index.ts
var idPattern = /^[a-z0-9][a-z0-9_-]{1,39}$/;
function equal(a, b) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
async function writeJson(file, value) {
  await mkdir2(dirname2(file), { recursive: true });
  const temp = file + ".tmp";
  await writeFile2(temp, JSON.stringify(value), { mode: 384 });
  await rename2(temp, file);
}
async function start(options = {}) {
  const file = options.dataFile ?? process.env.TERRARIUM_DATA_FILE ?? "./data/leaderboard.json";
  const credentialsFile = options.credentialsFile ?? process.env.TERRARIUM_CREDENTIALS_FILE ?? "./data/credentials.json";
  const announcements = new AnnouncementStore(options.announcementsFile ?? process.env.CORTICO_TERRARIUM_ANNOUNCEMENTS_FILE ?? `${dirname2(file)}/announcements.json`);
  await announcements.restore();
  const adminTokenFile = options.adminTokenFile ?? process.env.CORTICO_TERRARIUM_ADMIN_TOKEN_FILE ?? `${dirname2(file)}/admin-token`;
  let adminToken = options.adminToken ?? process.env.CORTICO_TERRARIUM_ADMIN_TOKEN;
  if (!adminToken) {
    try {
      adminToken = (await readFile2(adminTokenFile, "utf8")).trim();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      adminToken = randomBytes(32).toString("hex");
      await mkdir2(dirname2(adminTokenFile), { recursive: true });
      await writeFile2(adminTokenFile, adminToken, { mode: 384, flag: "wx" });
    }
    if (!adminToken) throw new Error("Empty announcement admin token");
  }
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  let registry = /* @__PURE__ */ Object.create(null);
  let credentials = /* @__PURE__ */ Object.create(null);
  let registrationQueue = Promise.resolve();
  let reportQueue = Promise.resolve();
  try {
    registry = Object.assign(/* @__PURE__ */ Object.create(null), JSON.parse(await readFile2(file, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    credentials = Object.assign(/* @__PURE__ */ Object.create(null), JSON.parse(await readFile2(credentialsFile, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const page = await readFile2(new URL("./index.html", import.meta.url));
  const sceneScript = await readFile2(new URL("./scene.js", import.meta.url)).catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    return readFile2(new URL("../dist/scene.js", import.meta.url));
  });
  const server = createServer(async (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(value));
    };
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "GET" && path === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        res.end(page);
        return;
      }
      if (req.method === "GET" && path === "/scene.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        res.end(sceneScript);
        return;
      }
      if (req.method === "GET" && path === "/health") {
        reply(200, { ok: true });
        return;
      }
      if (path === "/api/admin/announcements" || path.startsWith("/api/admin/announcements/")) {
        const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        if (!equal(token, adminToken)) {
          reply(401, { error: "Unauthorized" });
          return;
        }
        if (path === "/api/admin/announcements" && req.method === "GET") {
          reply(200, { announcements: announcements.list() });
          return;
        }
        if (path === "/api/admin/announcements" && req.method === "POST") {
          let raw = "";
          for await (const chunk of req) {
            raw += String(chunk);
            if (Buffer.byteLength(raw) > 16384) {
              reply(413, { error: "Announcement too large" });
              return;
            }
          }
          let notice;
          try {
            notice = await announcements.publish(JSON.parse(raw), (id) => Object.hasOwn(credentials, id));
          } catch (error) {
            if (error instanceof SyntaxError || error instanceof Error && /^(Invalid announcement|Announcement capacity)/.test(error.message)) {
              reply(400, { error: error.message });
              return;
            }
            throw error;
          }
          reply(201, notice);
          return;
        }
        if (req.method === "DELETE" && /^\/api\/admin\/announcements\/[1-9][0-9]*$/.test(path)) {
          const removed = await announcements.revoke(Number(path.split("/").at(-1)));
          reply(removed ? 200 : 404, { removed });
          return;
        }
        reply(405, { error: "Method not allowed" });
        return;
      }
      if (req.method === "GET" && path === "/api/announcements/public") {
        const query = new URL(req.url ?? "/", "http://localhost").searchParams;
        if (query.get("view") === "latest") {
          reply(200, announcements.latestPublic());
          return;
        }
        const after = Number(query.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) {
          reply(400, { error: "Invalid announcement cursor" });
          return;
        }
        reply(200, announcements.page(void 0, after));
        return;
      }
      if (req.method === "GET" && path === "/api/announcements") {
        const query = new URL(req.url ?? "/", "http://localhost").searchParams;
        const id = query.get("id") ?? "", token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        const expected = credentials[id];
        if (!expected || !equal(token, expected)) {
          reply(401, { error: "Unauthorized" });
          return;
        }
        const after = Number(query.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) {
          reply(400, { error: "Invalid announcement cursor" });
          return;
        }
        reply(200, announcements.page(id, after));
        return;
      }
      if (req.method === "GET" && path === "/api/leaderboard") {
        const query = new URL(req.url ?? "/", "http://localhost").searchParams;
        const kind = query.get("kind");
        if (kind !== null && kind !== "land" && kind !== "water") {
          reply(400, { error: "Invalid box kind" });
          return;
        }
        const ranked = Object.values(registry).filter((entry) => kind === null || (entry.kind ?? "land") === kind).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
        if (query.get("view") === "summary") {
          const limit = Number(query.get("limit") ?? 20), ownId = query.get("ownId");
          if (!kind || !Number.isInteger(limit) || limit < 1 || limit > 100 || ownId !== null && !idPattern.test(ownId)) {
            reply(400, { error: "Summary requires kind, limit 1..100 and a valid optional ownId" });
            return;
          }
          const summarize = (entry, index) => ({ rank: index + 1, id: entry.id, name: entry.state.name, score: entry.score, scoreParts: scoreParts(entry.state), reportedAt: entry.reportedAt });
          const ownIndex = ranked.findIndex((entry) => entry.id === ownId);
          reply(200, { habitat: kind, total: ranked.length, entries: ranked.slice(0, limit).map(summarize), own: ownIndex < 0 ? null : summarize(ranked[ownIndex], ownIndex) });
          return;
        }
        reply(200, ranked.slice(0, 100));
        return;
      }
      if (req.method === "GET" && path.startsWith("/api/boxes/")) {
        const id = decodeURIComponent(path.slice("/api/boxes/".length));
        reply(registry[id] ? 200 : 404, registry[id] ?? { error: "Unknown box" });
        return;
      }
      if (req.method === "POST" && path === "/api/registrations") {
        let raw = "";
        for await (const chunk of req) {
          raw += String(chunk);
          if (Buffer.byteLength(raw) > 1024) {
            reply(413, { error: "Registration too large" });
            return;
          }
        }
        const input = JSON.parse(raw);
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => key !== "id" && key !== "kind")) {
          reply(400, { error: "Invalid registration" });
          return;
        }
        const requested = input.id;
        const kind = input.kind;
        if (kind !== void 0 && kind !== "land" && kind !== "water") {
          reply(400, { error: "Invalid box kind" });
          return;
        }
        if (requested !== void 0 && (typeof requested !== "string" || !idPattern.test(requested))) {
          reply(400, { error: "Invalid box ID" });
          return;
        }
        const register = registrationQueue.then(async () => {
          const id = typeof requested === "string" ? requested : `box-${randomBytes(12).toString("hex")}`;
          if (Object.hasOwn(credentials, id) || Object.hasOwn(registry, id)) {
            reply(409, { error: "Box ID is already registered; supply its token or choose another ID" });
            return;
          }
          const token = randomBytes(32).toString("hex");
          const next = Object.assign(/* @__PURE__ */ Object.create(null), credentials, { [id]: token });
          await writeJson(credentialsFile, next);
          credentials = next;
          reply(201, { id, token });
        });
        registrationQueue = register.catch(() => {
        });
        await register;
        return;
      }
      if (req.method === "PUT" && path === "/api/reports") {
        let raw = "";
        for await (const chunk of req) {
          raw += String(chunk);
          if (Buffer.byteLength(raw) > 1048576) {
            reply(413, { error: "Report too large" });
            return;
          }
        }
        const input = JSON.parse(raw);
        let state;
        try {
          if (input.state?.kind === "water") {
            if (!validAquarium(input.state)) throw new Error("Invalid aquarium");
            state = input.state;
          } else state = migrateState(input.state);
        } catch {
          reply(400, { error: "Invalid report" });
          return;
        }
        if (typeof input.id !== "string" || !idPattern.test(input.id) || input.phase !== void 0 && input.phase !== "day" && input.phase !== "night") {
          reply(400, { error: "Invalid report" });
          return;
        }
        const expected = credentials[input.id];
        const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        if (!expected || !equal(token, expected)) {
          reply(401, { error: "Unauthorized" });
          return;
        }
        const now = Date.now();
        if (state.updatedAtMs > now + 6e4 || state.updatedAtMs < now - 31 * 864e5) {
          reply(400, { error: "Invalid report time" });
          return;
        }
        const id = input.id;
        const kind = "fish" in state ? "water" : "land";
        const report = reportQueue.then(async () => {
          if (registry[id] && (registry[id].kind ?? "land") !== kind) {
            reply(409, { error: "Box habitat cannot change" });
            return;
          }
          if (registry[id] && state.updatedAtMs < registry[id].state.updatedAtMs) {
            reply(409, { error: "Stale report" });
            return;
          }
          const next = Object.assign(/* @__PURE__ */ Object.create(null), registry, { [id]: { id, kind, state, phase: input.phase, score: score(state), reportedAt: new Date(now).toISOString() } });
          await writeJson(file, next);
          registry = next;
          reply(200, { score: registry[id].score });
        });
        reportQueue = report.catch(() => {
        });
        await report;
        return;
      }
      reply(404, { error: "Not found" });
    } catch (error) {
      reply(error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? "Invalid JSON" : "Request failed" });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}
if (process.env.TERRARIUM_SERVER_MAIN === "1") void start();
export {
  score,
  start
};
