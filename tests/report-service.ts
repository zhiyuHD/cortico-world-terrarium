import { createServer, request } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import type { ReportMessage, ReportReply } from '../src/report-protocol.ts';

export async function createReportProxy(target: string, onReport?: (message: ReportMessage) => void, rejectUpgrade: boolean | ((id: string) => boolean) = false) {
  const frames: ReportMessage[] = [], peers = new Set<WebSocket>();
  const replies: ReportReply[] = [];
  const upgrades: URL[] = [], httpReports: string[] = [];
  let rewriteReport: ((message: ReportMessage) => ReportMessage) | undefined;
  let rewriteReply: ((reply: ReportReply) => ReportReply) | undefined;
  let omitChecksums = false;
  let skipReplies = 0;
  let duplicateReplies = false;
  let previousReply: string | undefined;
  const server = createServer((req, res) => {
    if (req.url === '/api/reports') httpReports.push(req.method ?? '');
    const forwarded = request(new URL(req.url ?? '/', target), { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode ?? 500, response.headers); response.pipe(res);
    });
    forwarded.on('error', () => res.destroy()); req.pipe(forwarded);
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const address = new URL(req.url ?? '/', target); upgrades.push(address);
    if (typeof rejectUpgrade === 'function' ? rejectUpgrade(address.searchParams.get('id') ?? '') : rejectUpgrade) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    sockets.handleUpgrade(req, socket, head, downstream => {
      peers.add(downstream);
      const url = new URL(req.url ?? '/', target); url.protocol = 'ws:';
      const upstream = new WebSocket(url, { headers: { authorization: req.headers.authorization ?? '' } });
      peers.add(upstream);
      downstream.on('error', () => upstream.terminate()); upstream.on('error', () => downstream.terminate());
      downstream.on('close', () => { peers.delete(downstream); upstream.terminate(); });
      upstream.on('close', () => { peers.delete(upstream); downstream.terminate(); });
      downstream.on('message', (data, binary) => {
        const frame = JSON.parse(data.toString()) as ReportMessage;
        frames.push(frame); onReport?.(frame);
        const outgoing = rewriteReport ? JSON.stringify(rewriteReport(frame)) : data;
        rewriteReport = undefined;
        const send = () => { if (upstream.readyState === WebSocket.OPEN) upstream.send(outgoing, { binary }); };
        if (upstream.readyState === WebSocket.OPEN) send(); else upstream.once('open', send);
      });
      upstream.on('message', (data, binary) => {
        if (skipReplies > 0) { skipReplies--; return; }
        const reply = JSON.parse(data.toString()) as ReportReply;
        replies.push(reply);
        let outgoing = rewriteReply ? rewriteReply(reply) : reply;
        rewriteReply = undefined;
        if (omitChecksums && outgoing.kind === 'ack') { outgoing = { ...outgoing }; delete outgoing.stateHash; }
        if (downstream.readyState === WebSocket.OPEN) {
          if (duplicateReplies && previousReply) downstream.send(previousReply);
          previousReply = JSON.stringify(outgoing);
          downstream.send(previousReply, { binary });
          if (duplicateReplies) downstream.send(previousReply, { binary });
        }
      });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing proxy port');
  return {
    url: `http://127.0.0.1:${address.port}`, frames, replies, upgrades, httpReports,
    rewriteNextReport(rewrite: (message: ReportMessage) => ReportMessage) { rewriteReport = rewrite; },
    rewriteNextReply(rewrite: (reply: ReportReply) => ReportReply) { rewriteReply = rewrite; },
    omitReplyChecksums() { omitChecksums = true; },
    skipNextReply() { skipReplies++; },
    duplicateReplies() { duplicateReplies = true; },
    disconnect() { for (const peer of peers) peer.terminate(); },
    async close() {
      for (const peer of peers) peer.terminate(); sockets.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
