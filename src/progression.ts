import type { TerrariumState } from './state.ts';
import type { AquariumState } from './aquarium.ts';
import { score, TERRARIUM_SCORE_VERSION } from './scoring.ts';

export const TERRARIUM_LEVELS = [
  { level: 1, requiredScore: 0, size: 5, organisms: 12, collection: 48 },
  { level: 2, requiredScore: 120, size: 6, organisms: 18, collection: 64 },
  { level: 3, requiredScore: 260, size: 7, organisms: 24, collection: 96 },
  { level: 4, requiredScore: 420, size: 8, organisms: 32, collection: 128 },
] as const;
export const TERRARIUM_WATER_LEVELS = TERRARIUM_LEVELS.map((level, index) => ({ ...level, requiredScore: [0, 120, 240, 360][index] }));
export function expansionLevels(state: DevelopmentState) { return 'kind' in state && state.kind === 'water' ? TERRARIUM_WATER_LEVELS : TERRARIUM_LEVELS; }
export const TERRARIUM_FACILITIES = {
  mulch: { habitat: 'land', level: 2, name: '保湿覆盖', effect: '全箱土壤蒸发减少 25%；不改变渗透。' },
  shade: { habitat: 'land', level: 3, name: '遮阴棚', effect: '所在格与上下左右的日光乘以 0.6，可移动或关闭。' },
  grow_light: { habitat: 'land', level: 4, name: '育苗灯', effect: '白天将所在格与上下左右的光照提高到至少 0.75；夜晚仍不生长。' },
  air_stone: { habitat: 'water', level: 2, name: '气泡石', effect: '全箱每小时额外增加 2 氧气。' },
  filter: { habitat: 'water', level: 3, name: '过滤器', effect: '全箱每小时恢复 2 水质。' },
  water_light: { habitat: 'water', level: 4, name: '水草灯', effect: '白天水草生长速度提高 25%；夜晚仍不生长。' },
} as const;
export type FacilityKind = keyof typeof TERRARIUM_FACILITIES;
export interface Facility { kind: FacilityKind; x: number; y: number; enabled: boolean }
export interface Progression { scoreVersion?: number; level: number; peakScore: number; guideStep: number; guideSkipped: boolean; actions: string[] }
export interface DevelopmentState { progression?: Progression; facilities?: Facility[] }
type State = TerrariumState | AquariumState;
export function capacity(state: DevelopmentState) { return expansionLevels(state).find(l => l.level === state.progression?.level) ?? expansionLevels(state)[0]; }
export function inHabitat(state: DevelopmentState, x: number, y: number): boolean { const n = capacity(state).size; return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < n && y < n; }
export function hasFacility(state: DevelopmentState, kind: FacilityKind): boolean { return state.facilities?.some(f => f.kind === kind && f.enabled) ?? false; }
export function nearFacility(state: DevelopmentState, kind: FacilityKind, x: number, y: number): boolean { return state.facilities?.some(f => f.kind === kind && f.enabled && Math.abs(f.x - x) + Math.abs(f.y - y) <= 1) ?? false; }
export function observeProgress(state: State): Progression {
  const p = state.progression ??= { level: 1, peakScore: 0, guideStep: 0, guideSkipped: false, actions: [] };
  if (p.scoreVersion !== TERRARIUM_SCORE_VERSION) { p.peakScore = 0; p.scoreVersion = TERRARIUM_SCORE_VERSION; }
  p.peakScore = Math.max(p.peakScore, score(state), ...state.history.filter(h => h.scoreVersion === TERRARIUM_SCORE_VERSION).map(h => h.score ?? 0));
  return p;
}
const ACTIONS = ['observe', 'care', 'plant', 'inhabit', 'collect', 'upgrade', 'build'];
export function recordAction(state: State, action: string): void {
  const p = observeProgress(state);
  if (ACTIONS.includes(action) && !p.actions.includes(action)) p.actions.push(action);
}
export function upgradeHabitat(state: State): void {
  const p = observeProgress(state), next = expansionLevels(state)[p.level];
  if (!next) throw new Error('Habitat is already at the maximum level');
  if (p.peakScore < next.requiredScore) throw new Error(`Expansion requires a recorded peak score of ${next.requiredScore}; current peak ${p.peakScore}`);
  p.level++;
  if (!('fish' in state)) {
    const old = new Map(state.soil.map(c => [`${c.x},${c.y}`, c]));
    state.soil = Array.from({ length: next.size ** 2 }, (_, i) => { const x = i % next.size, y = Math.floor(i / next.size); return old.get(`${x},${y}`) ?? { x, y, moisture: 50 }; });
  }
  recordAction(state, 'upgrade');
}
export function installFacility(state: State, kind: unknown, x: unknown, y: unknown, enabled: unknown = true): void {
  if (typeof kind !== 'string' || !Object.hasOwn(TERRARIUM_FACILITIES, kind)) throw new Error('Unknown facility');
  const spec = TERRARIUM_FACILITIES[kind as FacilityKind];
  if (spec.habitat !== ('fish' in state ? 'water' : 'land')) throw new Error('Facility belongs to the other habitat');
  if (capacity(state).level < spec.level) throw new Error(`Facility unlocks at level ${spec.level}`);
  if (typeof x !== 'number' || typeof y !== 'number' || !inHabitat(state, x, y) || typeof enabled !== 'boolean') throw new Error('Supply valid x,y and boolean enabled');
  const entry = { kind: kind as FacilityKind, x, y, enabled };
  state.facilities = [...(state.facilities ?? []).filter(f => f.kind !== kind), entry];
  recordAction(state, 'build');
}
const LETTERS = [
  { title: '一封没有署名的来信', text: '欢迎接手这座小小的观察站。第一封信夹在箱盖里：“先看看这里的住客和环境，再决定怎样照顾它们。”', task: '用 terrarium_inspect 查看这个箱子。', action: 'observe' },
  { title: '水壶旁的便签', text: '旧水壶旁留着一行字：“合适比更多重要。土壤会渴，鱼也需要干净的水。”', task: '地箱实际浇水一次；水箱换水或投放饲料一次。', action: 'care' },
  { title: '空白的植物标签', text: '抽屉里有几张空白标签。你可以在空格种下植物，让它们成为观察站的新住客。', task: '地箱播种，或水箱种植水草一次。', action: 'plant' },
  { title: '会动的邻居', text: '观察笔记还缺几页：谁吃什么，谁又需要庇护？挑选适合现有食物来源的住客，慢慢观察。', task: '地箱放入一只虫子，或水箱放入一条鱼。', action: 'inhabit' },
  { title: '旧仓库的钥匙', text: '柜底的钥匙终于找到了。收藏可以暂停一位住客的模拟，但箱内的其他生命仍需要照顾。', task: '收藏一位住客，再按需要放回；收藏不计排行榜分。', action: 'collect' },
  { title: '围栏外的新地方', text: '最后一封信写着：“当这里足够繁盛，围栏外还有地方。把观察站建成什么样，由你决定。”', task: '最高积分达到 120 后扩建到二级。剧情没有额外积分奖励。', action: 'upgrade' },
] as const;
export function guide(state: State) {
  const p = state.progression ?? { guideStep: 0, guideSkipped: false, actions: [] as string[] };
  const chapter = LETTERS[p.guideStep];
  return { step: p.guideStep, total: LETTERS.length, skipped: p.guideSkipped, completed: p.guideStep >= LETTERS.length, ...(chapter && !p.guideSkipped ? { ...chapter, ready: p.actions.includes(chapter.action) } : {}) };
}
export function advanceGuide(state: State): void {
  const p = observeProgress(state), chapter = LETTERS[p.guideStep];
  if (p.guideSkipped || !chapter) throw new Error('Guide has ended');
  if (!p.actions.includes(chapter.action)) throw new Error('Complete the current chapter task before reading the next letter');
  p.guideStep++;
}
export function development(state: State) {
  const c = capacity(state), peakScore = Math.max(state.progression?.scoreVersion === TERRARIUM_SCORE_VERSION ? state.progression.peakScore : 0, score(state), ...state.history.filter(h => h.scoreVersion === TERRARIUM_SCORE_VERSION).map(h => h.score ?? 0)), next = expansionLevels(state).find(l => l.level === c.level + 1);
  return { ...c, peakScore, next: next ? { ...next, remainingScore: Math.max(0, next.requiredScore - peakScore), available: peakScore >= next.requiredScore } : null, facilities: Object.entries(TERRARIUM_FACILITIES).filter(([, f]) => f.habitat === ('fish' in state ? 'water' : 'land')).map(([kind, f]) => ({ kind, ...f, unlocked: c.level >= f.level, installed: state.facilities?.find(e => e.kind === kind) ?? null })), guide: guide(state) };
}
export function validDevelopment(value: DevelopmentState, habitat: 'land' | 'water'): boolean {
  const p = value.progression;
  if (p !== undefined && (!p || (p.scoreVersion !== undefined && p.scoreVersion !== 1 && p.scoreVersion !== TERRARIUM_SCORE_VERSION) || !TERRARIUM_LEVELS.some(l => l.level === p.level && Number.isSafeInteger(p.peakScore) && p.peakScore >= 0) || !Number.isInteger(p.guideStep) || p.guideStep < 0 || p.guideStep > LETTERS.length || typeof p.guideSkipped !== 'boolean' || !Array.isArray(p.actions) || p.actions.length > ACTIONS.length || new Set(p.actions).size !== p.actions.length || !p.actions.every(a => ACTIONS.includes(a)))) return false;
  return value.facilities === undefined || Array.isArray(value.facilities) && value.facilities.length <= 3 && new Set(value.facilities.map(f => f?.kind)).size === value.facilities.length && value.facilities.every(f => f && Object.hasOwn(TERRARIUM_FACILITIES, f.kind) && TERRARIUM_FACILITIES[f.kind].habitat === habitat && capacity(value).level >= TERRARIUM_FACILITIES[f.kind].level && inHabitat(value, f.x, f.y) && typeof f.enabled === 'boolean');
}
