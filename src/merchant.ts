import type { ToolDef } from 'cortico/core/types.ts';
import type { PlantState, TerrariumState } from './state.ts';
import { inHabitat } from './progression.ts';
import { isNestEntrance } from './colony.ts';
import { TERRARIUM_CROP_SPECIES } from './crops.ts';
import { TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';

export const TERRARIUM_MAX_COINS = 1_000_000_000;
export const TERRARIUM_POTS = {
  clay: { name: '素陶盆', price: 24, effect: '暖陶色装饰，无额外效果', growth: 1, evaporation: 1, light: 0, recovery: 0, drain: 0 },
  porcelain: { name: '青瓷盆', price: 40, effect: '青瓷与细叶纹装饰，无额外效果', growth: 1, evaporation: 1, light: 0, recovery: 0, drain: 0 },
  spring: { name: '春醒盆', price: 100, effect: '自然生长 ×1.5，蒸发 ×1.3', growth: 1.5, evaporation: 1.3, light: 0, recovery: 0, drain: 0 },
  slow: { name: '缓时盆', price: 60, effect: '自然生长 ×0.5，蒸发 ×0.8', growth: .5, evaporation: .8, light: 0, recovery: 0, drain: 0 },
  still: { name: '留景盆', price: 120, effect: '停止萌发和生长，禁止施肥；水分、健康和采食仍正常结算', growth: 0, evaporation: 1, light: 0, recovery: 0, drain: 0 },
  reservoir: { name: '蓄露盆', price: 80, effect: '蒸发 ×0.45；不自动浇水', growth: 1, evaporation: .45, light: 0, recovery: 0, drain: 0 },
  drainage: { name: '透雨盆', price: 60, effect: '每小时额外排出 2 水分，最低排到 60；仍会自然蒸发', growth: 1, evaporation: 1, light: 0, recovery: 0, drain: 2 },
  shade: { name: '苔荫盆', price: 80, effect: '本格白天光照 ×0.55，蒸发 ×0.8', growth: 1, evaporation: .8, light: -.45, recovery: 0, drain: 0 },
  sun: { name: '映日盆', price: 120, effect: '本格白天光照 +0.25，上限 1；不改变昼夜', growth: 1, evaporation: 1, light: .25, recovery: 0, drain: 0 },
  healing: { name: '养叶盆', price: 160, effect: '适宜白天每小时恢复 1 健康及 2 叶损；自然生长 ×0.8', growth: .8, evaporation: 1, light: 0, recovery: 1, drain: 0 },
} as const;
export type PotKind = keyof typeof TERRARIUM_POTS;
export interface Pot { kind: PotKind; x: number; y: number }
/** The local wallet travels with the habitat snapshot, like organisms and fertilizer. */
export interface Economy { earned: number; spent: number; seedSpent?: number; inventory: Partial<Record<PotKind, number>>; pots: Pot[] }
export function balance(state: Pick<TerrariumState, 'economy'>): number { return state.economy ? state.economy.earned - state.economy.spent : 0; }
export function potAt(state: Pick<TerrariumState, 'economy'>, x: number, y: number) { const pot = state.economy?.pots.find(p => p.x === x && p.y === y); return pot ? TERRARIUM_POTS[pot.kind] : undefined; }
export function validEconomy(state: Partial<TerrariumState>): boolean {
  const e = state.economy;
  if (e === undefined) return true;
  if (!e || !Number.isSafeInteger(e.earned) || e.earned < 0 || e.earned > TERRARIUM_MAX_COINS || !Number.isSafeInteger(e.spent) || e.spent < 0 || e.spent > e.earned || !e.inventory || typeof e.inventory !== 'object' || Array.isArray(e.inventory) || !Array.isArray(e.pots) || e.pots.length > 64) return false;
  let owned = e.pots.length, cost = 0;
  for (const [kind, count] of Object.entries(e.inventory)) {
    if (!Object.hasOwn(TERRARIUM_POTS, kind) || !Number.isSafeInteger(count) || count! < 0 || count! > 64) return false;
    owned += count!; cost += TERRARIUM_POTS[kind as PotKind].price * count!;
  }
  for (const p of e.pots) { if (!p || !Object.hasOwn(TERRARIUM_POTS, p.kind) || !inHabitat(state, p.x, p.y)) return false; cost += TERRARIUM_POTS[p.kind].price; }
  const seeds = e.seedSpent ?? 0;
  return owned <= 64 && Number.isSafeInteger(seeds) && seeds >= 0 && seeds <= e.spent && cost + seeds === e.spent && new Set(e.pots.map(p => `${p.x},${p.y}`)).size === e.pots.length;
}
/** Packets give the one-hour sprouting head start that neighbor gifts used to be the only source of. */
export const TERRARIUM_SEED_PACKETS: Record<string, number> = { fern: 6, clover: 5, moss: 5, basil: 7, bean: 7, sunflower: 9, mint: 7, daisy: 8, lavender: 9, tomato: 8, strawberry: 8, mushroom: 6, watermelon: 13, melon: 11, wheat: 7 };
const prices = { fern: 24, clover: 20, moss: 20, basil: 28, bean: 28, sunflower: 36, mint: 26, daisy: 32, lavender: 36, tomato: 30, strawberry: 32, mushroom: 24, watermelon: 52, melon: 44, wheat: 26 };
export function plantQuote(plant: PlantState) {
  const hours = plant.naturalGrowthHours ?? Math.min(48, plant.growthHours);
  const eligible = hours + 1e-8 >= 6 && plant.health >= 40;
  const coins = eligible ? Math.floor(prices[plant.species] * Math.min(2, 1 + (hours - 6) / 42) * plant.health / 100) : 0;
  return { id: plant.id, species: plant.species, coins, eligible, naturalGrowthHours: hours, reason: eligible ? undefined : '需要至少 6 小时自然生长且健康不低于 40；施肥不增加出售资格或售价。' };
}
export function merchantStatus(state: TerrariumState, catalog = true) {
  return { coins: balance(state), earned: state.economy?.earned ?? 0, spent: state.economy?.spent ?? 0, inventory: state.economy?.inventory ?? {}, pots: state.economy?.pots ?? [], ...(catalog ? { catalog: Object.entries(TERRARIUM_POTS).map(([kind, item]) => ({ kind, ...item })), quotes: state.plants.map(plantQuote), seeds: { catalog: Object.entries(TERRARIUM_SEED_PACKETS).map(([species, price]) => ({ species, price })), owned: state.seedPackets ?? {} }, seedPackets: '播种时自动消耗一包，萌发起步一小时的种子包；也可由邻里赠送获得。' } : {}) };
}
export function trade(state: TerrariumState, args: Record<string, unknown>): unknown {
  const action = args.action ?? 'status';
  if (action === 'status') return merchantStatus(state);
  // Work on a copy so failed purchases, placements and sales do not change the wallet.
  const e: Economy = structuredClone(state.economy ?? { earned: 0, spent: 0, inventory: {}, pots: [] });
  const packets: Record<string, number> = { ...state.seedPackets };
  let sold: ReturnType<typeof plantQuote> | undefined;
  let bought: { species: string; portions: number; price: number } | undefined;
  if (action === 'sell') {
    const plant = state.plants.find(p => p.id === args.id);
    if (!plant) throw new Error('Select a living land plant; seeds and collected specimens cannot be sold');
    sold = plantQuote(plant);
    if (!sold.eligible) throw new Error(sold.reason);
    if (e.earned + sold.coins > TERRARIUM_MAX_COINS) throw new Error('Coin lifetime earnings limit reached');
    e.earned += sold.coins;
  } else if (action === 'buy') {
    const kind = args.pot as PotKind;
    if (!Object.hasOwn(TERRARIUM_POTS, kind)) throw new Error('Unknown pot; read status for the catalog');
    const owned = Object.values(e.inventory).reduce((a, b) => a + b!, e.pots.length);
    if (owned >= 64) throw new Error('Pot capacity reached (64 including placed pots)');
    const price = TERRARIUM_POTS[kind].price;
    if (e.earned - e.spent < price) throw new Error('Not enough coins');
    e.spent += price; e.inventory[kind] = (e.inventory[kind] ?? 0) + 1;
  } else if (action === 'buy_seed') {
    const species = args.species as string, portions = Number(args.portions ?? 1);
    if (!Object.hasOwn(TERRARIUM_SEED_PACKETS, species)) throw new Error('Unknown seed species; read status for the seed catalog');
    if (!Number.isInteger(portions) || portions < 1 || portions > 10) throw new Error('Seed packets are sold 1..10 at a time');
    const owned = (packets[species] ?? 0) + portions, price = TERRARIUM_SEED_PACKETS[species] * portions;
    if (owned > 10000) throw new Error('Seed packet capacity reached');
    if (e.earned - e.spent < price) throw new Error('Not enough coins');
    e.spent += price; e.seedSpent = (e.seedSpent ?? 0) + price; packets[species] = owned; bought = { species, portions, price };
  } else if (action === 'place' || action === 'remove') {
    const x = args.x as number, y = args.y as number;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inHabitat(state, x, y)) throw new Error('Position must be in the current habitat grid');
    const old = e.pots.find(p => p.x === x && p.y === y);
    if (action === 'place') {
      const kind = args.pot as PotKind;
      if (!Object.hasOwn(TERRARIUM_POTS, kind) || !(e.inventory[kind]! > 0)) throw new Error('Buy this pot before placing it');
      if (isNestEntrance(state, x, y)) throw new Error('Cannot put a pot on an ant entrance');
      e.inventory[kind]!--; e.pots = e.pots.filter(p => p !== old); e.pots.push({ kind, x, y });
    } else {
      if (!old) throw new Error('There is no pot on this plot');
      e.pots = e.pots.filter(p => p !== old);
    }
    if (old) e.inventory[old.kind] = (e.inventory[old.kind] ?? 0) + 1;
  } else throw new Error('Unknown merchant action');
  if (sold) state.plants.splice(state.plants.findIndex(p => p.id === sold!.id), 1);
  state.economy = e;
  if (bought) state.seedPackets = packets;
  return { ...merchantStatus(state, false), ...(bought ? { bought, seedPackets: packets } : {}), ...(sold ? { sold } : {}) };
}
/** Built on first use: the plant catalog lives in habitat.ts, which imports this module for pot effects. */
export function merchantToolDecl(): Omit<ToolDef, 'handler'> {
  return {
  name: 'terrarium_merchant', tags: ['read', 'write'],
  description: 'Land merchant and pot shop. status returns coins, inventory, pot catalog, seed catalog, owned seed packets and plant sale quotes. sell permanently removes a living land plant by id: requires 6 natural growth hours and health >=40; fertilizer grants no sale value. buy purchases one pot into inventory; place equips it at x,y (replaced pot returns to inventory); remove returns a placed pot. buy_seed purchases 1..10 seed packets of one species; sowing consumes a packet automatically for a one-hour sprouting head start, and packets are also received from neighbors. Pots stay when plants are sold, composted, collected or die. One effect per plot; no stacking. still blocks fertilizer but does not freeze health, water or insects. Coins are local snapshot data, separate from ecology score; decorative coin item is unrelated.',
  parameters: { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['status', 'sell', 'sell_fruit', 'buy', 'buy_seed', 'place', 'remove'] }, species: { type: 'string', enum: [...new Set([...TERRARIUM_CROP_SPECIES, ...Object.keys(TERRARIUM_PLANT_REQUIREMENTS)])] }, portions: { type: 'integer', minimum: 1, maximum: 10000 }, id: { type: 'string' }, pot: { type: 'string', enum: Object.keys(TERRARIUM_POTS) }, x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } } },
  };
}

export interface CoinEntry { rank: number; competitiveRank: number; id: string; name?: string; coins: number; earned: number; reportedAt: string }
export interface CoinRanking { habitat: 'land'; metric: 'coins'; total: number; entries: CoinEntry[]; own: CoinEntry | null }
export function coinRanking(entries: Array<{ id: string; state: TerrariumState; reportedAt: string }>, limit: number, ownId?: string): CoinRanking {
  const rows = entries.filter(e => (e.state.economy?.earned ?? 0) > 0).sort((a, b) => balance(b.state) - balance(a.state) || a.id.localeCompare(b.id));
  let competitive = 0, previous = -1;
  const summaries = rows.map((e, i): CoinEntry => { const coins = balance(e.state); if (coins !== previous) competitive = i + 1; previous = coins; return { rank: i + 1, competitiveRank: competitive, id: e.id, name: e.state.name, coins, earned: e.state.economy!.earned, reportedAt: e.reportedAt }; });
  return { habitat: 'land', metric: 'coins', total: rows.length, entries: summaries.slice(0, limit), own: summaries.find(e => e.id === ownId) ?? null };
}
