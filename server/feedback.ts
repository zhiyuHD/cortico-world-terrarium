import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseFeedback, TERRARIUM_MAX_FEEDBACK, TERRARIUM_FEEDBACK_ANONYMOUS_LIMIT, TERRARIUM_FEEDBACK_BOX_LIMIT, TERRARIUM_FEEDBACK_RATE_INTERVAL_MS, TERRARIUM_FEEDBACK_PAGE_SIZE, type TerrariumFeedbackInput, type TerrariumFeedbackReceipt } from '../src/feedback.ts';
import { validClientVersion } from '../src/report-protocol.ts';

interface Feedback extends TerrariumFeedbackInput, TerrariumFeedbackReceipt { source: 'web' | 'world' | 'ai'; boxId?: string; clientVersion?: string; resolvedAt?: string }
interface Store { nextId: number; feedback: Feedback[] }
export class FeedbackError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export class FeedbackStore {
  private state: Store = { nextId: 1, feedback: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async restore(): Promise<void> {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8')) as Store;
      if (!state || !Number.isSafeInteger(state.nextId) || state.nextId < 1 || !Array.isArray(state.feedback) || state.feedback.length > TERRARIUM_MAX_FEEDBACK || !state.feedback.every((item, index) => {
        parseFeedback(item);
        return Number.isSafeInteger(item.id) && item.id > 0 && item.id < state.nextId && (index === 0 || item.id > state.feedback[index - 1].id) && ['web', 'world', 'ai'].includes(item.source) && Number.isFinite(Date.parse(item.createdAt)) && (item.resolvedAt === undefined || Number.isFinite(Date.parse(item.resolvedAt))) && (item.clientVersion === undefined || validClientVersion(item.clientVersion)) && (item.boxId === undefined || /^[a-z0-9][a-z0-9_-]{1,39}$/.test(item.boxId));
      })) throw new Error('Invalid feedback store');
      this.state = state;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  list(after = 0): { feedback: Feedback[]; nextCursor: number } {
    const feedback = this.state.feedback.filter(item => item.id > after).slice(0, TERRARIUM_FEEDBACK_PAGE_SIZE);
    return { feedback: structuredClone(feedback), nextCursor: feedback.at(-1)?.id ?? after };
  }
  submit(value: unknown, boxId?: string): Promise<TerrariumFeedbackReceipt> {
    return this.serial(async () => {
      let input: TerrariumFeedbackInput;
      try { input = parseFeedback(value); } catch (error) { throw new FeedbackError(400, (error as Error).message); }
      const metadata = value as { source?: unknown; clientVersion?: unknown };
      const source = metadata.source ?? 'web';
      if (typeof source !== 'string' || !['web', 'world', 'ai'].includes(source) || (metadata.clientVersion !== undefined && !validClientVersion(metadata.clientVersion))) throw new FeedbackError(400, 'Invalid feedback metadata');
      const now = Date.now(), recent = this.state.feedback.filter(item => item.boxId === boxId && Date.parse(item.createdAt) > now - TERRARIUM_FEEDBACK_RATE_INTERVAL_MS);
      if (recent.length >= (boxId ? TERRARIUM_FEEDBACK_BOX_LIMIT : TERRARIUM_FEEDBACK_ANONYMOUS_LIMIT)) throw new FeedbackError(429, 'Feedback limit reached; retry after one minute');
      let feedback = this.state.feedback;
      if (feedback.length >= TERRARIUM_MAX_FEEDBACK) {
        const removable = feedback.find(item => item.resolvedAt !== undefined);
        if (!removable) throw new FeedbackError(503, 'Feedback inbox is full');
        feedback = feedback.filter(item => item.id !== removable.id);
      }
      const entry: Feedback = { ...input, id: this.state.nextId, createdAt: new Date(now).toISOString(), source: source as Feedback['source'], ...(boxId ? { boxId } : {}), ...(metadata.clientVersion ? { clientVersion: metadata.clientVersion as string } : {}) };
      await this.save({ nextId: entry.id + 1, feedback: [...feedback, entry] });
      return { id: entry.id, createdAt: entry.createdAt };
    });
  }
  resolve(id: number): Promise<boolean> {
    return this.serial(async () => {
      const entry = this.state.feedback.find(item => item.id === id);
      if (!entry) return false;
      if (!entry.resolvedAt) await this.save({ ...this.state, feedback: this.state.feedback.map(item => item.id === id ? { ...item, resolvedAt: new Date().toISOString() } : item) });
      return true;
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work); this.queue = result.catch(() => {}); return result; }
  private async save(state: Store): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file); this.state = state;
  }
}
