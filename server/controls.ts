import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validClientVersion } from '../src/report-protocol.ts';

interface ScheduledChange { at: string; enabled: boolean }
interface HttpPushControl { enabled: boolean; scheduledChange: ScheduledChange | null }
interface VersionControl { version: string | null; scheduledChange: { at: string; version: string | null } | null }
export interface Controls { httpPush: HttpPushControl; minimumClientVersion: VersionControl }
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const timestamp = (value: unknown): value is string => typeof value === 'string' && timestampPattern.test(value) && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const version = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length <= 100 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value));

/** Minimum versions are stable releases; build metadata does not affect precedence. */
export function meetsMinimumVersion(client: unknown, minimum: string | null): boolean {
  if (minimum === null) return true;
  if (!validClientVersion(client)) return false;
  const parts = client.split('+')[0].split('-');
  const actual = parts[0].split('.').map(BigInt), required = minimum.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (actual[i] !== required[i]) return actual[i] > required[i];
  return parts.length === 1;
}

export class ControlError extends Error {}

export class ControlStore {
  private state: Controls = { httpPush: { enabled: true, scheduledChange: null }, minimumClientVersion: { version: null, scheduledChange: null } };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  async restore(): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!object(value) || !object(value.httpPush) || typeof value.httpPush.enabled !== 'boolean') throw new Error('Invalid controls file');
    const rule = value.httpPush.scheduledChange;
    if (rule !== null && (!object(rule) || typeof rule.enabled !== 'boolean' || !timestamp(rule.at))) throw new Error('Invalid controls file');
    const floor = value.minimumClientVersion;
    if (floor !== undefined && (!object(floor) || !version(floor.version) || (floor.scheduledChange !== null && (!object(floor.scheduledChange) || !version(floor.scheduledChange.version) || !timestamp(floor.scheduledChange.at))))) throw new Error('Invalid controls file');
    this.state = { httpPush: value.httpPush as unknown as HttpPushControl, minimumClientVersion: floor === undefined ? { version: null, scheduledChange: null } : floor as unknown as VersionControl };
  }

  // Evaluate persisted deadlines on every read, including after a restart or idle period.
  get(): Controls {
    const state = structuredClone(this.state);
    if (state.httpPush.scheduledChange && Date.parse(state.httpPush.scheduledChange.at) <= Date.now()) state.httpPush = { enabled: state.httpPush.scheduledChange.enabled, scheduledChange: null };
    if (state.minimumClientVersion.scheduledChange && Date.parse(state.minimumClientVersion.scheduledChange.at) <= Date.now()) state.minimumClientVersion = { version: state.minimumClientVersion.scheduledChange.version, scheduledChange: null };
    return state;
  }

  private update(work: (state: Controls) => void): Promise<Controls> {
    const result = this.queue.then(async () => {
      const state = this.get(); work(state);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.state = state;
      return this.get();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  updateHttpPush(input: unknown): Promise<Controls> {
    return this.update(state => {
      if (!object(input)) throw new ControlError('Invalid HTTP Push control');
      if (input.cancel === true && Object.keys(input).length === 1) { state.httpPush.scheduledChange = null; return; }
      if (typeof input.enabled !== 'boolean' || Object.keys(input).some(key => key !== 'enabled' && key !== 'at')) throw new ControlError('Supply enabled and an optional timestamp with timezone');
      if (input.at !== undefined) state.httpPush.scheduledChange = { enabled: input.enabled, at: this.future(input.at) };
      else state.httpPush = { enabled: input.enabled, scheduledChange: null };
    });
  }

  updateMinimumClientVersion(input: unknown): Promise<Controls> {
    return this.update(state => {
      if (!object(input)) throw new ControlError('Invalid minimum client version control');
      if (input.cancel === true && Object.keys(input).length === 1) { state.minimumClientVersion.scheduledChange = null; return; }
      if (!Object.hasOwn(input, 'version') || !version(input.version) || Object.keys(input).some(key => key !== 'version' && key !== 'at')) throw new ControlError('Supply a stable version (major.minor.patch) or null and an optional timestamp with timezone');
      if (input.at !== undefined) state.minimumClientVersion.scheduledChange = { version: input.version, at: this.future(input.at) };
      else state.minimumClientVersion = { version: input.version, scheduledChange: null };
    });
  }

  private future(at: unknown): string {
    if (!timestamp(at) || Date.parse(at) <= Date.now()) throw new ControlError('Scheduled time must be in the future and include a timezone');
    return new Date(at).toISOString();
  }
}
