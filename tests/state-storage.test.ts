import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readSnapshot, saveSnapshot } from '../src/state-storage.ts';
import { newState, saveState, loadState } from '../src/state.ts';
import { newAquarium, validAquarium } from '../src/aquarium.ts';

it.each(['land', 'water'] as const)('recovers a NUL-filled %s file from the previous snapshot and preserves damaged bytes', async habitat => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-snapshot-'));
  try {
    const file = join(dir, 'state.json'), previous = habitat === 'land' ? newState(100) : newAquarium(100);
    await saveState(file, previous);
    await saveState(file, { ...previous, name: 'Latest' });
    const damaged = Buffer.alloc(178000); await writeFile(file, damaged);
    const recovered = await readSnapshot(file);
    expect(recovered.value).toEqual(previous);
    expect(await readFile(recovered.corruptFile!)).toEqual(damaged);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(previous);
    if (habitat === 'water') expect(validAquarium(recovered.value)).toBe(true);
    else expect(await loadState(file, 200)).toEqual(previous);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('keeps an absent box unclaimed but recovers a missing primary when its backup exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-snapshot-'));
  try {
    const file = join(dir, 'state.json'); expect((await readSnapshot(file)).value).toBeNull();
    await saveSnapshot(file, { revision: 1 }); await rm(file);
    expect(await readSnapshot(file)).toMatchObject({ value: { revision: 1 }, recoveredFrom: `${file}.backup` });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('does not treat a stored JSON null as an unclaimed habitat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-snapshot-'));
  try {
    const file = join(dir, 'state.json'); await writeFile(file, 'null');
    await expect(readSnapshot(file)).rejects.toThrow('expected an object');
    expect(await readFile(file, 'utf8')).toBe('null');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('fails without overwriting either file when both primary and backup are damaged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-snapshot-'));
  try {
    const file = join(dir, 'state.json'); await writeFile(file, Buffer.alloc(123)); await writeFile(`${file}.backup`, '{');
    await expect(readSnapshot(file)).rejects.toThrow();
    expect(await readFile(file)).toEqual(Buffer.alloc(123)); expect(await readFile(`${file}.backup`, 'utf8')).toBe('{');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('serializes overlapping saves without exposing partial JSON and retains the penultimate version', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-snapshot-'));
  try {
    const file = join(dir, 'state.json'); await saveSnapshot(file, { revision: 0 });
    const jobs = Array.from({ length: 25 }, (_, index) => saveSnapshot(file, { revision: index + 1, payload: 'x'.repeat(10000) }));
    for (let i = 0; i < 40; i++) expect(Number.isInteger(JSON.parse(await readFile(file, 'utf8')).revision)).toBe(true);
    await Promise.all(jobs);
    expect(JSON.parse(await readFile(file, 'utf8')).revision).toBe(25);
    expect(JSON.parse(await readFile(`${file}.backup`, 'utf8')).revision).toBe(24);
    expect((await readdir(dir)).some(name => name.endsWith('.tmp'))).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('leaves the primary intact when its backup cannot be replaced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-snapshot-'));
  try {
    const file = join(dir, 'state.json'); await saveSnapshot(file, { revision: 1 });
    await rm(`${file}.backup`); await mkdir(`${file}.backup`);
    await expect(saveSnapshot(file, { revision: 2 })).rejects.toThrow();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ revision: 1 });
    expect((await readdir(dir)).some(name => name.endsWith('.tmp'))).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
