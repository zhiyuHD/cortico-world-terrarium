import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocketServer } from 'ws';
import { afterEach, expect, it } from 'vitest';
import type { ToolCallContext, ToolOutcome, WorldHost } from 'cortico/core/types.ts';
import { LeaderboardClient } from '../src/leaderboard.ts';
import { TerrariumWorld } from '../src/world.ts';
import { TERRARIUM_DEFAULTS } from '../src/config.ts';
import { newState, saveState } from '../src/state.ts';
import { newAquarium } from '../src/aquarium.ts';
import { reportStateHash } from '../src/report-protocol.ts';
import { photoCaption } from '../src/photo.ts';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=', 'base64');
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-photo-'));
  let state: unknown, response: 'png' | 'hash' | 'old' | 'html' | 'stale' = 'png';
  const photos: Record<string, unknown>[] = [];
  const photoLink = { url: 'https://photos.example.test/temporary/image.png?signature=a%2Bb', expiresAt: '2026-10-23T14:00:00.000Z' };
  let linkHeaders: Record<string, string> = { 'x-terrarium-photo-url': photoLink.url, 'x-terrarium-photo-expires-at': photoLink.expiresAt };
  const server = createServer(async (req, res) => {
    if (req.url !== '/api/photos') { res.writeHead(404).end('{}'); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString()); photos.push(input);
    if (req.headers.authorization !== `Bearer ${'b'.repeat(64)}`) { res.writeHead(401).end(); return; }
    if (response === 'old') { res.writeHead(404).end('{}'); return; }
    if (response === 'stale') { res.writeHead(409).end('{}'); return; }
    if (input.stateHash !== reportStateHash(state)) { res.writeHead(409).end('{}'); return; }
    res.writeHead(200, { 'content-type': response === 'html' ? 'text/html' : 'image/png', 'x-terrarium-state-hash': response === 'hash' ? '0'.repeat(64) : input.stateHash, 'x-terrarium-captured-at': '2026-10-22T14:00:00.000Z', ...linkHeaders });
    res.end(response === 'html' ? 'error page' : png);
  });
  const ws = new WebSocketServer({ server });
  ws.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString()); state = frame.state;
    socket.send(JSON.stringify({ kind: 'ack', seq: frame.seq, revision: 'a'.repeat(32), score: 0, stateHash: reportStateHash(state) }));
  }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing port');
  const url = `http://127.0.0.1:${address.port}`;
  cleanup.push(async () => { ws.clients.forEach(socket => socket.terminate()); await new Promise<void>(resolve => ws.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
  return { dir, url, photos, photoLink, setLinkHeaders(value: Record<string, string>) { linkHeaders = value; }, setResponse(value: typeof response) { response = value; } };
}
it.each(['land', 'water'] as const)('returns a frozen %s PNG through the World with existing credentials', async habitat => {
  const f = await fixture(), now = Date.parse('2026-10-22T14:00:00Z');
  const file = join(f.dir, habitat, 'state.json'); await mkdir(join(f.dir, habitat));
  if (habitat === 'land') await saveState(file, newState(now)); else await writeFile(file, JSON.stringify(newAquarium(now)));
  const credentials = JSON.stringify({ [`${f.url}/${habitat === 'water' ? 'water/' : ''}auto`]: { id: `saved-${habitat}`, token: 'b'.repeat(64) } });
  await writeFile(join(f.dir, habitat, 'report-credentials.json'), credentials);
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: f.url, tickIntervalMs: 3600000 }, stateFile: join(f.dir, 'land', 'state.json'), waterStateFile: join(f.dir, 'water', 'state.json'), timezone: 'UTC', now: () => now });
  await world.start({ log: { warn() {} }, async pushEvent() {} } as unknown as WorldHost);
  try {
    const result = await world.tools().find(tool => tool.name === 'terrarium_take_photo')!.handler({ habitat, caption: '今天也很好' }, {} as ToolCallContext) as ToolOutcome;
    expect(JSON.parse(result.text)).toMatchObject({ habitat, caption: '今天也很好', stateHash: f.photos[0].stateHash, ...f.photoLink });
    expect(result.blobs).toHaveLength(1);
    expect(result.blobs![0]).toMatchObject({ bytes: png, mime: 'image/png', fallbackText: expect.stringContaining('今天也很好') });
    expect(f.photos[0]).toMatchObject({ id: `saved-${habitat}`, caption: '今天也很好' });
    expect(await readFile(join(f.dir, habitat, 'report-credentials.json'), 'utf8')).toBe(credentials);
  } finally { await world.stop(); }
});
it('rejects old servers, altered checksums and non-image responses without attaching them', async () => {
  const f = await fixture();
  const client = new LeaderboardClient({ url: f.url, id: 'saved-land', token: 'b'.repeat(64), credentialsFile: join(f.dir, 'client.json') });
  try {
    for (const [mode, error] of [['old', 'upgrade the server'], ['hash', 'mismatched snapshot'], ['html', 'Invalid photo response'], ['stale', 'Snapshot changed']] as const) {
      f.setResponse(mode); await expect(client.takePhoto(newState(Date.now()), 'day', '')).rejects.toThrow(error);
    }
  } finally { client.close(); }
});
it('does not register an unclaimed box and validates captions before network work', async () => {
  const f = await fixture();
  const client = new LeaderboardClient({ url: f.url, id: '', credentialsFile: join(f.dir, 'missing.json') });
  await expect(client.takePhoto(newState(Date.now()), 'day', '')).rejects.toThrow('Claim a box');
  expect(f.photos).toEqual([]);
  expect(photoCaption('🌱'.repeat(120))).toHaveLength(240);
  for (const value of ['花'.repeat(121), 'bad\u0000', 12]) expect(() => photoCaption(value)).toThrow('120 characters');
});

it('returns the attachment with explicit null link fields when an older photo server omits link headers', async () => {
  const f = await fixture(); f.setLinkHeaders({});
  const now = Date.parse('2026-10-22T14:00:00Z'), stateFile = join(f.dir, 'land', 'state.json');
  await saveState(stateFile, newState(now));
  await writeFile(join(f.dir, 'land', 'report-credentials.json'), JSON.stringify({ [`${f.url}/auto`]: { id: 'saved-land', token: 'b'.repeat(64) } }));
  const world = new TerrariumWorld({ cfg: { ...TERRARIUM_DEFAULTS, leaderboardUrl: f.url, tickIntervalMs: 3600000 }, stateFile, timezone: 'UTC', now: () => now });
  await world.start({ log: { warn() {} }, async pushEvent() {} } as unknown as WorldHost);
  try {
    const result = await world.tools().find(t => t.name === 'terrarium_take_photo')!.handler({}, {} as ToolCallContext) as ToolOutcome;
    expect(JSON.parse(result.text)).toMatchObject({ url: null, expiresAt: null, urlUnavailableReason: expect.any(String) });
    expect(result.blobs![0]).toMatchObject({ bytes: png });
  } finally { await world.stop(); }
});
it('rejects unsafe, partial or invalid link metadata without fetching the supplied URL', async () => {
  const f = await fixture();
  const client = new LeaderboardClient({ url: f.url, id: 'saved-land', token: 'b'.repeat(64), credentialsFile: join(f.dir, 'client.json') });
  const urlHeader = 'x-terrarium-photo-url', expiryHeader = 'x-terrarium-photo-expires-at';
  try {
    const invalid: Record<string, string>[] = [
      ...['http://photos.example.test/image.png', 'javascript:alert(1)', '//photos.example.test/image.png', 'https://name:secret@photos.example.test/image.png', 'https://photos.example.test/image.png#part', 'https://photos.example.test/' + 'a'.repeat(2048)].map(url => ({ [urlHeader]: url, [expiryHeader]: f.photoLink.expiresAt })),
      { [urlHeader]: f.photoLink.url }, { [expiryHeader]: f.photoLink.expiresAt },
      { [urlHeader]: f.photoLink.url, [expiryHeader]: 'not-a-date' },
      { [urlHeader]: f.photoLink.url, [expiryHeader]: '2026-10-22T13:00:00Z' },
    ];
    for (const headers of invalid) {
      f.setLinkHeaders(headers);
      await expect(client.takePhoto(newState(Date.now()), 'day', '')).rejects.toThrow('Invalid photo link metadata');
    }
    f.setLinkHeaders({ [urlHeader]: f.photoLink.url, [expiryHeader]: f.photoLink.expiresAt });
    expect(await client.takePhoto(newState(Date.now()), 'day', '')).toMatchObject({ ...f.photoLink, bytes: png });
  } finally { client.close(); }
});
