import { TERRARIUM_DEFAULTS } from './config.ts';
import WebSocket from 'ws';
import { validAnnouncement, type Announcement } from './announcements.ts';
import { reportChanges, reportStateHash, TERRARIUM_REPORT_MAX_BYTES, TERRARIUM_REPORT_MAX_CHANGES, type ReportMessage, type ReportReply } from './report-protocol.ts';
import { reportClientMetadata } from './version.ts';

export class ReportSocketError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export class ReportSocket {
  private socket: WebSocket | undefined;
  private baseline: unknown;
  private baselineHash: string | undefined;
  private revision: string | undefined;
  private seq = 0;
  private settledSeq = 0;
  private reportQueue: Promise<void> = Promise.resolve();
  private pending: { seq: number; resolve: (reply: ReportReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;

  constructor(private readonly options: { url: URL; id: string; token: string; incremental: boolean; timeoutMs?: number; onNotice?: (notice: Announcement) => Promise<void>; signal?: AbortSignal }) {}

  close(): void { this.disconnect(new Error('Report connection closed')); }

  report(state: unknown, phase: 'day' | 'night'): Promise<void> {
    const snapshot: unknown = JSON.parse(JSON.stringify(state));
    const task = this.reportQueue.then(() => this.reportSnapshot(snapshot, phase));
    this.reportQueue = task.catch(() => {});
    return task;
  }

  private async reportSnapshot(snapshot: unknown, phase: 'day' | 'night'): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      this.options.signal?.throwIfAborted();
      try { await this.deliver(snapshot, phase); return; }
      catch (error) {
        this.disconnect(error instanceof Error ? error : new Error(String(error)));
        if (attempt > 0 || error instanceof ReportSocketError) throw error;
      }
    }
  }

  private async deliver(state: unknown, phase: 'day' | 'night'): Promise<void> {
    const socket = await this.connect();
    this.options.signal?.throwIfAborted();
    const changes = this.options.incremental && this.revision && this.baselineHash && reportStateHash(this.baseline) === this.baselineHash ? reportChanges(this.baseline, state) : undefined;
    const stateHash = reportStateHash(state);
    const header = { protocol: 1 as const, seq: ++this.seq, ...reportClientMetadata(), phase, stateHash };
    let message: ReportMessage = changes && changes.length <= TERRARIUM_REPORT_MAX_CHANGES
      ? { ...header, kind: 'delta', baseRevision: this.revision!, baseHash: this.baselineHash!, changes }
      : { ...header, kind: 'full', state };
    const full: ReportMessage = { ...header, kind: 'full', state };
    if (message.kind === 'delta' && Buffer.byteLength(JSON.stringify(message)) >= Buffer.byteLength(JSON.stringify(full))) message = full;
    let reply = await this.send(socket, message);
    if (reply.kind === 'resync') reply = await this.send(socket, { ...header, seq: ++this.seq, kind: 'full', state });
    if (reply.kind === 'error') throw new ReportSocketError(reply.error, reply.status);
    const acceptance = reply as ReportReply & { accepted?: boolean; ignored?: boolean };
    if (acceptance.accepted === false || acceptance.ignored === true) throw new ReportSocketError('Server ignored report; snapshot was not accepted');
    if (reply.kind !== 'ack' || typeof reply.revision !== 'string' || !/^[a-f0-9]{32}$/.test(reply.revision) || !Number.isSafeInteger(reply.score) || reply.score < 0) throw new Error('Invalid report acknowledgement');
    if ((reply.stateHash !== undefined || this.baselineHash !== undefined) && reply.stateHash !== stateHash) throw new Error('Report state checksum mismatch');
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) throw new Error('Report connection closed');
    this.baseline = state; this.revision = reply.revision; this.baselineHash = reply.stateHash;
  }

  private async connect(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) return this.socket;
    const url = new URL('/api/reports/ws', this.options.url);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('id', this.options.id);
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.options.token}`, 'x-cortico-client-version': reportClientMetadata().clientVersion, 'x-cortico-protocol-notices': '1' }, family: 4, handshakeTimeout: this.options.timeoutMs ?? TERRARIUM_DEFAULTS.requestTimeoutMs!, maxPayload: 16_384, perMessageDeflate: false });
    this.socket = socket;
    this.baseline = undefined; this.revision = undefined; this.baselineHash = undefined;
    socket.on('message', raw => {
      if (this.socket !== socket) return;
      try {
        const frame = JSON.parse(raw.toString());
        if (frame?.kind === 'notice') {
          if (!validAnnouncement(frame.notice) || !Array.isArray(frame.notice.targets) || !frame.notice.targets.includes(this.options.id)) throw new Error('Invalid protocol notice');
          void this.options.onNotice?.(frame.notice).catch(() => {});
          return;
        }
        const reply = frame as ReportReply;
        if (!reply || !Number.isSafeInteger(reply.seq) || reply.seq < 1 || !['ack', 'error', 'resync'].includes(reply.kind)) throw new Error('Invalid report acknowledgement');
        // Settled replies can arrive again after a proxy retries delivery.
        if (reply.seq <= this.settledSeq) return;
        if (!this.pending || reply.seq !== this.pending.seq) throw new Error('Invalid report acknowledgement');
        const pending = this.pending; this.pending = undefined; this.settledSeq = reply.seq; clearTimeout(pending.timer); pending.resolve(reply);
      } catch { this.disconnect(new Error('Invalid report acknowledgement')); }
    });
    socket.on('error', () => { if (this.socket === socket) this.disconnect(new Error('Report connection failed')); });
    socket.on('close', () => { if (this.socket === socket) this.disconnect(new Error('Report connection closed')); });
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('Report connection closed')));
      socket.once('unexpected-response', (_request, response) => {
        response.resume();
        reject(new ReportSocketError(`Report WebSocket HTTP ${response.statusCode}`, response.statusCode));
        socket.terminate();
      });
    });
  }

  private send(socket: WebSocket, message: ReportMessage): Promise<ReportReply> {
    const raw = JSON.stringify(message);
    if (Buffer.byteLength(raw) > TERRARIUM_REPORT_MAX_BYTES) return Promise.reject(new ReportSocketError('Report too large', 413));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.disconnect(new Error('Report acknowledgement timeout')), this.options.timeoutMs ?? TERRARIUM_DEFAULTS.requestTimeoutMs!);
      timer.unref();
      this.pending = { seq: message.seq, resolve, reject, timer };
      socket.send(raw, error => { if (error) this.disconnect(error); });
    });
  }

  private disconnect(error: Error): void {
    const socket = this.socket; this.socket = undefined;
    this.baseline = undefined; this.revision = undefined; this.baselineHash = undefined;
    if (this.pending) { const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); pending.reject(error); }
    socket?.terminate();
  }
}
