import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface AlertState { enabled: boolean; baseline?: { identity: string; rank: number } }

export class RankAlerts {
  private state: AlertState = { enabled: true };
  constructor(private readonly file: string) {}
  get enabled(): boolean { return this.state.enabled; }

  async restore(): Promise<void> {
    let value: AlertState;
    try { value = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.state = { enabled: true }; return; } throw error; }
    if (!value || typeof value.enabled !== 'boolean' || (value.baseline !== undefined &&
      (!value.baseline || typeof value.baseline.identity !== 'string' || !Number.isSafeInteger(value.baseline.rank) || value.baseline.rank < 1))) throw new Error('Invalid rank alerts file');
    this.state = value;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.enabled) return;
    await this.save({ enabled });
  }

  async observe(identity: string, rank: number | null): Promise<number | undefined> {
    if (!this.enabled) return;
    const previous = this.state.baseline;
    if (rank === null) { if (previous) await this.save({ enabled: true }); return; }
    if (previous?.identity === identity && previous.rank === rank) return;
    await this.save({ enabled: true, baseline: { identity, rank } });
    return previous?.identity === identity && rank > previous.rank ? previous.rank : undefined;
  }

  private async save(state: AlertState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
    this.state = state;
  }
}
