import type { AquariumState } from './aquarium.ts';
import type { TerrariumState } from './state.ts';

export type ScoreParts = { plants: number; bugs: number; seeds: number } | { plants: number; fish: number; water: number };
export function scoreParts(state: TerrariumState | AquariumState): ScoreParts {
  if ('fish' in state) return {
    plants: state.plants.reduce((sum, plant) => sum + Math.round((plant.stage + 1) * plant.health / 10), 0),
    fish: state.fish.reduce((sum, fish) => sum + Math.round(fish.health / 10 + fish.energy / 10), 0),
    water: Math.round((state.oxygen + state.cleanliness) / 10),
  };
  return {
    plants: state.plants.reduce((sum, plant) => sum + Math.round((plant.stage + 1) * plant.health / 10 + plant.moisture / 20), 0),
    bugs: state.bugs.reduce((sum, bug) => sum + Math.round(bug.energy / 20 + (bug.species === 'spider' ? 4 : bug.species === 'beetle' ? 3 : bug.species === 'ant' ? 2 : 1)), 0),
    seeds: state.seeds.length * 2,
  };
}
export function score(state: TerrariumState | AquariumState): number {
  return Object.values(scoreParts(state)).reduce((sum, part) => sum + part, 0);
}
export interface LeaderboardBoxSummary { rank: number; id: string; name?: string; score: number; scoreParts: ScoreParts; reportedAt: string }
export interface LeaderboardSummary { habitat: 'land' | 'water'; total: number; entries: LeaderboardBoxSummary[]; own: LeaderboardBoxSummary | null }
