import type { AquariumState } from '../src/aquarium.ts';
import type { TerrariumState } from '../src/state.ts';

export interface GalleryEntry {
  id: string; kind?: 'land' | 'water'; state: TerrariumState | AquariumState;
  phase?: 'day' | 'night'; score: number; reportedAt: string;
}

/** Page snapshots omit histories, frozen specimens and replay frames. Ranks precede filtering. */
export function galleryPage(ranked: readonly GalleryEntry[], query: URLSearchParams) {
  const requestedPage = Number(query.get('page') ?? 1), pageSize = Number(query.get('pageSize') ?? 4);
  const sort = query.get('sort') ?? 'score', search = (query.get('q') ?? '').trim().toLocaleLowerCase();
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 12 || !['score', 'recent'].includes(sort) || search.length > 100) throw new Error('Invalid gallery pagination, sort or search');
  const ranks = new Map(ranked.map((entry, index) => [entry.id, index + 1]));
  const filtered = ranked.filter(entry => `${entry.state.name ?? ''} ${entry.id}`.toLocaleLowerCase().includes(search));
  if (sort === 'recent') filtered.sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt) || a.id.localeCompare(b.id));
  const total = filtered.length, pages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requestedPage, pages);
  return {
    page, pageSize, pages, total,
    counts: { boxes: ranked.length, plants: ranked.reduce((n, entry) => n + entry.state.plants.length, 0), animals: ranked.reduce((n, entry) => n + ('fish' in entry.state ? entry.state.fish.length : entry.state.bugs.length), 0) },
    entries: filtered.slice((page - 1) * pageSize, page * pageSize).map(entry => {
      const state = entry.state;
      const common = { name: state.name, progression: state.progression, facilities: state.facilities, plants: state.plants };
      return { id: entry.id, kind: entry.kind ?? 'land', rank: ranks.get(entry.id)!, score: entry.score, reportedAt: entry.reportedAt, phase: entry.phase, replayCount: state.replays?.length ?? 0,
        state: 'fish' in state ? { ...common, kind: 'water', oxygen: state.oxygen, cleanliness: state.cleanliness, fish: state.fish, eggs: state.eggs, food: state.food } : { ...common, economy: state.economy, soil: state.soil, seeds: state.seeds, bugs: state.bugs, items: state.items, nests: state.nests, eggs: state.eggs, food: state.food, webs: state.webs },
      };
    }),
  };
}
