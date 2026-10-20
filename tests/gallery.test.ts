import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { start } from '../server/index.ts';
import { newState } from '../src/state.ts';
import { newAquarium } from '../src/aquarium.ts';

it('pages compact scenes across the entire ranking, searches globally and preserves legacy responses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-gallery-')), now = Date.now();
  const land = newState(now), water = newAquarium(now);
  land.history = Array.from({ length: 168 }, (_, i) => ({ ...structuredClone(land.history[0]), recordedAtMs: now - (167 - i) * 3_600_000 }));
  const entries: Record<string, unknown> = Object.fromEntries(Array.from({ length: 121 }, (_, i) => {
    const id = `plot-${String(i).padStart(3, '0')}`;
    return [id, { id, kind: 'land', state: { ...land, name: i === 120 ? 'Far garden' : `Garden ${i}` }, score: 0, reportedAt: new Date(now + i).toISOString() }];
  }));
  entries['water-fixture'] = { id: 'water-fixture', kind: 'water', state: water, score: 0, reportedAt: new Date(now).toISOString() };
  const dataFile = join(dir, 'boxes.json'); await writeFile(dataFile, JSON.stringify(entries));
  const server = await start({ port: 0, dataFile });
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing port');
    const base = `http://127.0.0.1:${address.port}`;
    const read = (query: string) => fetch(base + '/api/leaderboard?kind=land&view=gallery&' + query);
    const firstText = await (await read('')).text(), first = JSON.parse(firstText);
    expect(first).toMatchObject({ page: 1, pages: 31, pageSize: 4, total: 121, counts: { boxes: 121, plants: land.plants.length * 121, animals: 0 } });
    expect(first.entries).toHaveLength(4); expect(first.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2, 3, 4]);
    for (const key of ['history', 'replays', 'collection', 'deaths']) expect(first.entries[0].state).not.toHaveProperty(key);
    expect((await (await read('page=2')).json()).entries[0]).toMatchObject({ id: 'plot-004', rank: 5 });
    expect(await (await read('page=999')).json()).toMatchObject({ page: 31, entries: [{ id: 'plot-120', rank: 121 }] });
    expect((await (await read('sort=recent')).json()).entries[0]).toMatchObject({ id: 'plot-120', rank: 121 });
    expect(await (await read('q=FAR')).json()).toMatchObject({ page: 1, pages: 1, total: 1, entries: [{ id: 'plot-120', rank: 121 }], counts: { boxes: 121 } });
    expect(await (await read('q=absent')).json()).toMatchObject({ total: 0, page: 1, pages: 1, entries: [] });
    for (const query of ['page=0', 'page=1.5', 'pageSize=13', 'pageSize=0', 'sort=unknown', 'q=' + 'a'.repeat(101)]) expect((await read(query)).status).toBe(400);
    expect((await fetch(base + '/api/leaderboard?view=gallery')).status).toBe(400);
    expect(await (await fetch(base + '/api/leaderboard?kind=water&view=gallery')).json()).toMatchObject({ total: 1, counts: { boxes: 1, plants: water.plants.length }, entries: [{ id: 'water-fixture', state: { kind: 'water', fish: [] } }] });
    const legacyText = await (await fetch(base + '/api/leaderboard?kind=land')).text(), legacy = JSON.parse(legacyText);
    expect(legacy).toHaveLength(100); expect(legacy[0].state.history).toHaveLength(land.history.length);
    expect(firstText.length).toBeLessThan(legacyText.length / 50);
    expect(await (await fetch(base + '/api/boxes/plot-000?view=replays')).json()).toEqual({ replays: [] });
    expect((await (await fetch(base + '/api/boxes/plot-000')).json()).state.history).toHaveLength(land.history.length);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
