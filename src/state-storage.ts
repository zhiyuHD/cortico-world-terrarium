import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const writes = new Map<string, Promise<void>>();

async function read(file: string): Promise<Buffer | null> {
  try { return await readFile(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function parse(raw: Buffer): object {
  const value: unknown = JSON.parse(raw.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Invalid ecosystem snapshot: expected an object');
  return value;
}
async function durableWrite(file: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
    if (process.platform !== 'win32') {
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temporary, { force: true }); }
}

/** Each replacement retains the previous parseable snapshot in a separately flushed file. */
export async function saveSnapshot(file: string, value: object): Promise<void> {
  const text = JSON.stringify(value, null, 2), key = resolve(file);
  const job = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const previous = await read(file);
    if (previous !== null) {
      let valid = true;
      try { parse(previous); } catch { valid = false; }
      if (valid) await durableWrite(`${file}.backup`, previous);
      else await durableWrite(`${file}.corrupt-${Date.now()}-${randomUUID()}`, previous);
    } else if (await read(`${file}.backup`) === null) await durableWrite(`${file}.backup`, text);
    await durableWrite(file, text);
  });
  writes.set(key, job);
  try { await job; } finally { if (writes.get(key) === job) writes.delete(key); }
}

/** Syntax failures preserve the damaged bytes and recover only from a parseable backup. */
export async function readSnapshot(file: string): Promise<{ value: unknown | null; recoveredFrom?: string; corruptFile?: string }> {
  const raw = await read(file);
  let failure: unknown;
  if (raw !== null) {
    try { return { value: parse(raw) }; }
    catch (error) { failure = error; }
  }
  const backup = await read(`${file}.backup`);
  if (backup === null) { if (failure) throw failure; return { value: null }; }
  let value: unknown;
  try { value = parse(backup); }
  catch (error) { throw failure ?? error; }
  const corruptFile = raw === null ? undefined : `${file}.corrupt-${Date.now()}-${randomUUID()}`;
  if (corruptFile) await durableWrite(corruptFile, raw!);
  await durableWrite(file, backup);
  return { value, recoveredFrom: `${file}.backup`, ...(corruptFile ? { corruptFile } : {}) };
}
