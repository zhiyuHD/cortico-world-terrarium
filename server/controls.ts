import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface ScheduledChange { at: string; enabled: boolean }
interface HttpPushControl { enabled: boolean; scheduledChange: ScheduledChange | null }
interface Controls { httpPush: HttpPushControl }
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const timestamp = (value: unknown): value is string => typeof value === 'string' && timestampPattern.test(value) && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export class ControlError extends Error {}

export class ControlStore {
  private state: Controls = { httpPush: { enabled: true, scheduledChange: null } };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  async restore(): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!object(value) || !object(value.httpPush) || typeof value.httpPush.enabled !== 'boolean') throw new Error('Invalid controls file');
    const rule = value.httpPush.scheduledChange;
    if (rule !== null && (!object(rule) || typeof rule.enabled !== 'boolean' || !timestamp(rule.at))) throw new Error('Invalid controls file');
    this.state = value as unknown as Controls;
  }

  // Evaluate the persisted deadline on every read, including after a restart or an idle period.
  get(): Controls {
    const control = this.state.httpPush;
    if (control.scheduledChange && Date.parse(control.scheduledChange.at) <= Date.now()) {
      return { httpPush: { enabled: control.scheduledChange.enabled, scheduledChange: null } };
    }
    return structuredClone(this.state);
  }

  updateHttpPush(input: unknown): Promise<Controls> {
    const result = this.queue.then(async () => {
      if (!object(input)) throw new ControlError('Invalid HTTP Push control');
      const current = this.get().httpPush;
      let next: HttpPushControl;
      if (input.cancel === true && Object.keys(input).length === 1) next = { ...current, scheduledChange: null };
      else {
        if (typeof input.enabled !== 'boolean' || Object.keys(input).some(key => key !== 'enabled' && key !== 'at')) throw new ControlError('Supply enabled and an optional timestamp with timezone');
        if (input.at !== undefined) {
          if (!timestamp(input.at) || Date.parse(input.at) <= Date.now()) throw new ControlError('Scheduled time must be in the future and include a timezone');
          next = { ...current, scheduledChange: { enabled: input.enabled, at: new Date(input.at).toISOString() } };
        } else next = { enabled: input.enabled, scheduledChange: null };
      }
      const state = { httpPush: next };
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.state = state;
      return this.get();
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
