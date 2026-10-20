import { capacity } from './progression.ts';
import { daylight, flowerStage, plantCareAdvice, TERRARIUM_GROWTH_STAGE_HOURS, TERRARIUM_PLANT_REQUIREMENTS } from './habitat.ts';
import { phase, type TerrariumState } from './state.ts';
import { advanceAquarium, type AquariumState } from './aquarium.ts';

/** Forecasts assume no caretaker actions; growth estimates count suitable daylight hours. */
export function phaseTiming(nowMs: number, timezone: string) {
  const current = phase(nowMs, timezone);
  let low = nowMs, high = nowMs + 3_600_000;
  while (phase(high, timezone) === current) { low = high; high += 3_600_000; }
  while (high - low > 1000) { const mid = Math.floor((low + high) / 2); if (phase(mid, timezone) === current) low = mid; else high = mid; }
  return { phase: current, nextPhaseAtMs: Math.ceil(high / 1000) * 1000, hoursUntilChange: (high - nowMs) / 3_600_000 };
}
function progress(stage: number, growthHours: number) {
  const threshold = TERRARIUM_GROWTH_STAGE_HOURS[stage + 1];
  const suitableHoursRemaining = threshold === undefined ? 0 : Math.max(0, threshold - growthHours);
  return { nextStage: threshold === undefined ? null : stage + 1, suitableHoursRemaining, progress: threshold === undefined ? 1 : Math.max(0, Math.min(1, (growthHours - TERRARIUM_GROWTH_STAGE_HOURS[stage]) / (threshold - TERRARIUM_GROWTH_STAGE_HOURS[stage]))) };
}
export function landCare(state: TerrariumState, nowMs: number, timezone: string) {
  const timing = phaseTiming(nowMs, timezone);
  const plants = state.plants.map(plant => {
    const needs = TERRARIUM_PLANT_REQUIREMENTS[plant.species], light = daylight(state, plant.x, plant.y);
    const moistureShortfall = Math.max(0, needs.minMoisture - plant.moisture), moistureExcess = Math.max(0, plant.moisture - needs.maxMoisture);
    const lightShortfall = Math.max(0, needs.minLight - light), lightExcess = Math.max(0, light - needs.maxLight);
    return { id: plant.id, species: plant.species, x: plant.x, y: plant.y, moisture: plant.moisture, daylight: light, suitable: needs, needsAction: !!(moistureShortfall || moistureExcess || lightShortfall || lightExcess || plant.health <= 40), advice: plant.health <= 40 ? plantCareAdvice(plant) : undefined, ...progress(plant.stage, plant.growthHours), waitForDaylight: timing.phase === 'night', moistureShortfall, moistureExcess, lightShortfall, lightExcess, canGrowNow: timing.phase === 'day' && !moistureShortfall && !moistureExcess && !lightShortfall && !lightExcess, remainingDaylightGrowthUpperBoundHours: timing.phase === 'day' ? timing.hoursUntilChange * 1.1 : 0 };
  });
  const seeds = state.seeds.map(seed => ({ id: seed.id, suitableDaylightHoursRemaining: Math.max(0, 2 - seed.ageHours), waitForDaylight: timing.phase === 'night', moistureShortfall: Math.max(0, TERRARIUM_PLANT_REQUIREMENTS[seed.species].minMoisture - state.soil[seed.y * capacity(state).size + seed.x].moisture) }));
  const species = new Set(state.plants.filter(p => p.health >= 60).map(p => p.species));
  return { ...timing, summary: { minMoisture: Math.min(...state.soil.map(c => c.moisture)), maxMoisture: Math.max(...state.soil.map(c => c.moisture)), dryPlants: plants.filter(p => p.moistureShortfall > 0).length, wetPlants: plants.filter(p => p.moistureExcess > 0).length, lowHealth: state.plants.filter(p => p.health <= 40).length }, plants, seeds, goals: [{ id: 'healthy-diversity', current: species.size, target: 5 }, { id: 'three-blooms', current: state.plants.filter(p => flowerStage(p) === 'bloom').length, target: 3 }, { id: 'stocked-colony', current: Math.max(0, ...(state.nests ?? []).map(n => n.food)), target: 10 }], nextSteps: state.plants.length + state.seeds.length < 3 ? ['选择空格播种；按物种水分和光照需求选位置。', '可用 targetMoisture 精确浇水，先少量放虫并观察食物来源。'] : [] };
}
export function waterCare(state: AquariumState, nowMs: number, timezone: string) {
  const timing = phaseTiming(nowMs, timezone);
  const forecast = structuredClone(state);
  let dawn = timing.nextPhaseAtMs;
  if (timing.phase === 'day') dawn = phaseTiming(timing.nextPhaseAtMs + 1000, timezone).nextPhaseAtMs;
  advanceAquarium(forecast, dawn, timezone);
  return { ...timing, plants: state.plants.map(plant => ({ id: plant.id, ...progress(plant.stage, plant.growthHours), waitForDaylight: timing.phase === 'night', cleanlinessShortfall: Math.max(0, 40 - state.cleanliness), canGrowNow: timing.phase === 'day' && state.cleanliness >= 40 })), oxygenForecast: { atMs: dawn, oxygen: forecast.oxygen, assumption: '按当前生物、食物和模拟规则推进，期间不人工操作；并非保证值。' }, suggestedFoodCleanup: state.food.filter(f => nowMs - f.droppedAtMs >= 3_600_000 || state.cleanliness < 60).map(f => f.id), feeding: state.fish.map(f => ({ fishId: f.id, lastMeal: f.lastMeal ?? null })), goals: [{ id: 'healthy-aquatic-diversity', current: new Set(state.plants.filter(p => p.health >= 60).map(p => p.species)).size, target: 3 }, { id: 'balanced-water', current: Math.min(state.oxygen, state.cleanliness), target: 80 }], thresholds: { oxygenWarning: 40, fishOxygenDamageBelow: 25, cleanlinessGrowthMinimum: 40, cleanlinessDamageBelow: 30 }, nextSteps: ['水草夜间等待天亮；水质至少 40 才能生长。', '鱼需要游到食物所在格才会进食；已有残饵时先等它靠近，避免重复投放。'] };
}
