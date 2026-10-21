import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { LeaderboardClient } from '../src/leaderboard.ts';
import { forumRequest } from '../src/forum.ts';

it('validates destinations, bounded text, pagination and explicit social mutations', () => {
  expect(forumRequest('terrarium_forum_read', { q: '薄荷', limit: 2, before: 8 })).toEqual({ method: 'GET', path: 'threads', query: { q: '薄荷', limit: '2', before: '8' } });
  expect(forumRequest('terrarium_forum_post', { threadId: 3, body: ' 谢谢邻居 ' })).toEqual({ method: 'POST', path: 'threads/3/replies', body: { body: '谢谢邻居' } });
  for (const args of [{ profileId: '../credentials' }, { threadId: 0 }, { limit: 21 }, { before: 1.5 }, { q: 'x'.repeat(101) }, { threadId: 1, profileId: 'garden-a' }]) expect(() => forumRequest('terrarium_forum_read', args)).toThrow();
  expect(() => forumRequest('terrarium_forum_post', { body: 'no title' })).toThrow();
  expect(() => forumRequest('terrarium_forum_post', { threadId: 1, body: 'x'.repeat(2001) })).toThrow();
  expect(() => forumRequest('terrarium_forum_like', { postId: 1 })).toThrow();
  expect(() => forumRequest('terrarium_forum_follow', { targetId: 'http://example.test', following: true })).toThrow();
});

it('handles unopened old servers, keeps missing threads distinct and reuses stored credentials for forum posts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-forum-'));
  let supported = false, enabled = false, registrations = 0;
  const posts: unknown[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const send = (code: number, value: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/api/registrations') { registrations++; return send(201, { id: 'garden-a', token: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }); }
    if (!supported) return send(404, { error: 'Not found' });
    if (url.pathname === '/api/forum/status') return send(200, { enabled });
    if (!enabled) return send(503, { code: 'forum_closed', error: '未开放论坛' });
    if (url.pathname === '/api/forum/threads/999') return send(404, { error: 'Thread not found' });
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (req.headers.authorization !== 'Bearer cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' || body.id !== 'garden-a' || !body.clientVersion) return send(401, { error: 'Unauthorized' });
      posts.push(body); return send(200, { id: posts.length, author: body.id, title: body.title, body: body.body });
    }
    send(200, { threads: posts, nextCursor: null, externalContent: true });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No port');
  const options = { url: `http://127.0.0.1:${address.port}`, id: '', automaticIds: true, credentialsFile: join(dir, 'credentials.json') };
  const client = new LeaderboardClient(options);
  try {
    expect(await client.forum(forumRequest('terrarium_forum_read', {}))).toMatchObject({ message: '未开放论坛' });
    expect(await client.forum(forumRequest('terrarium_forum_post', { title: '向日葵', body: '开花了' }))).toMatchObject({ message: '未开放论坛' });
    supported = true;
    expect(await client.forum(forumRequest('terrarium_forum_read', {}))).toMatchObject({ message: '未开放论坛' });
    enabled = true;
    await expect(client.forum(forumRequest('terrarium_forum_post', { title: '向日葵', body: '开花了' }))).rejects.toThrow('Claim a box');
    expect(registrations).toBe(0);
    await client.claim(); const saved = await readFile(options.credentialsFile, 'utf8');
    const restarted = new LeaderboardClient(options); await restarted.restore();
    const receipt = await restarted.forum(forumRequest('terrarium_forum_post', { title: '向日葵', body: '开花了' }));
    expect(receipt).toMatchObject({ id: 1, author: 'garden-a', body: '开花了' });
    expect(registrations).toBe(1); expect(await readFile(options.credentialsFile, 'utf8')).toBe(saved);
    await expect(restarted.forum(forumRequest('terrarium_forum_read', { threadId: 999 }))).rejects.toThrow('Thread not found');
    restarted.close();
  } finally { client.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});
