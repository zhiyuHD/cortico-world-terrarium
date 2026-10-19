import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_DEFAULTS } from './config.ts';
import type { ScoreParts } from './scoring.ts';

interface Baseline { identity: string; rank: number; competitiveRank?: number; scoreParts?: ScoreParts }
interface AlertState { enabled: boolean; baseline?: Baseline; lastAlertAtMs?: number }
export class RankAlerts {
  private state: AlertState = { enabled: true };
  constructor(private readonly file: string, private readonly options: { minDrop?: number; cooldownMinutes?: number } = {}) {}
  get enabled(): boolean { return this.state.enabled; }
  async restore(): Promise<void> {
    let value: AlertState;
    try { value = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!value || typeof value.enabled !== 'boolean' || (value.lastAlertAtMs !== undefined && !Number.isFinite(value.lastAlertAtMs)) || (value.baseline !== undefined &&
      (!value.baseline || typeof value.baseline.identity !== 'string' || !Number.isSafeInteger(value.baseline.rank) || value.baseline.rank < 1 || (value.baseline.competitiveRank !== undefined && (!Number.isSafeInteger(value.baseline.competitiveRank) || value.baseline.competitiveRank < 1)) || (value.baseline.scoreParts !== undefined && (!value.baseline.scoreParts || Object.values(value.baseline.scoreParts).some(n => !Number.isSafeInteger(n) || n < 0)))))) throw new Error('Invalid rank alerts file');
    this.state = value;
  }
  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled !== this.enabled) await this.save({ enabled });
  }
  async observe(identity: string, rank: number | null, nowMs = Date.now(), detail: { competitiveRank?: number; scoreParts?: ScoreParts } = {}): Promise<Baseline | undefined> {
    if (!this.enabled) return;
    const previous = this.state.baseline;
    if (rank === null) { if (previous) await this.save({ enabled: true }); return; }
    const baseline: Baseline = { identity, rank, ...detail };
    const effective = detail.competitiveRank ?? rank, before = previous?.competitiveRank ?? previous?.rank;
    if (!previous || previous.identity !== identity || effective < before! || (previous.competitiveRank === undefined && detail.competitiveRank !== undefined)) {
      await this.save({ ...this.state, baseline }); return;
    }
    if (effective - before! < (this.options.minDrop ?? TERRARIUM_DEFAULTS.rankAlertMinDrop!) || nowMs - (this.state.lastAlertAtMs ?? -Infinity) < (this.options.cooldownMinutes ?? TERRARIUM_DEFAULTS.rankAlertCooldownMinutes!) * 60_000) return;
    await this.save({ ...this.state, baseline, lastAlertAtMs: nowMs });
    return previous;
  }
  private async save(state: AlertState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file); this.state = state;
  }
}
