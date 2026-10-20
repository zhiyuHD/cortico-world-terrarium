import { chmod, cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { packRelease, ReleaseStore, verifyRelease } from '../server/releases.ts';
import { newState } from '../src/state.ts';

let source: string;
const cleanup: Array<() => Promise<unknown>> = [];
async function removeTree(path: string): Promise<void> {
  await chmod(path, 0o700);
  for (const file of await readdir(path, { withFileTypes: true })) if (file.isDirectory()) await removeTree(join(path, file.name));
  await rm(path, { force: true, recursive: true });
}
beforeAll(async () => {
  source = await mkdtemp(join(tmpdir(), 'terrarium-release-source-'));
  await cp('dist', source, { recursive: true });
  for (const [entry, name] of [['index.ts', 'server.mjs'], ['release-cli.ts', 'release.mjs'], ['release-runner.ts', 'runner.mjs']]) {
    await build({ entryPoints: [resolve('server', entry)], outfile: join(source, name), bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  }
}, 20000);
afterAll(() => removeTree(source));
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function freePort() { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); await new Promise<void>(resolve => server.close(() => resolve())); return address.port; }
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'terrarium-release-')); cleanup.push(() => removeTree(dir));
  const root = join(dir, 'deployment'); await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(join(root, 'data/credentials.json'), '{"test-box":"fixture-token"}');
  const controlBytes = JSON.stringify({ httpPush: { enabled: true, scheduledChange: { enabled: false, at: new Date(Date.now() + 3600000).toISOString() } } });
  await writeFile(join(root, 'data/controls.json'), controlBytes);
  const store = new ReleaseStore(root), port = await freePort(), adminPort = await freePort();
  const url = `http://127.0.0.1:${port}`, adminUrl = `http://127.0.0.1:${adminPort}`;
  const pack = async (id: string, custom?: string, dataEpoch = 1) => {
    const output = join(dir, id), payload = custom === undefined ? source : join(dir, `${id}-source`);
    if (custom !== undefined) { await cp(source, payload, { recursive: true }); await writeFile(join(payload, 'server.mjs'), custom); }
    await packRelease(payload, output, { id, version: '0.7.11', revision: 'fixture', dataEpoch });
    return output;
  };
  await store.install(await pack('first')); await store.initialize('first');
  const runners = new Set<ChildProcess>();
  const startRunner = (admin = true) => {
    const child = spawn(process.execPath, [join(root, 'manager/runner.mjs')], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CORTICO_TERRARIUM_DEPLOY_ROOT: root, CORTICO_TERRARIUM_START_TIMEOUT_MS: '2500', CORTICO_TERRARIUM_HEALTH_URL: url + '/health', PORT: String(port), TERRARIUM_DATA_FILE: join(root, 'data/leaderboard.json'), TERRARIUM_CREDENTIALS_FILE: join(root, 'data/credentials.json'), CORTICO_TERRARIUM_ADMIN_TOKEN: 'fixture-admin', CORTICO_TERRARIUM_ADMIN_HOST: admin ? '127.0.0.1' : '', CORTICO_TERRARIUM_ADMIN_PORT: String(adminPort), CORTICO_TERRARIUM_ADMIN_ALLOWED_CIDR: '127.0.0.1/32' } });
    runners.add(child); child.stdout?.resume(); child.stderr?.resume();
    return child;
  };
  const stop = async (child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') => { if (child.exitCode !== null || child.signalCode !== null) return; const ended = once(child, 'exit'); if (signal === 'SIGKILL') process.kill(-child.pid!, signal); else child.kill(signal); await ended; runners.delete(child); };
  cleanup.push(async () => { for (const child of runners) await stop(child, 'SIGKILL'); });
  const ready = async (id: string) => { await expect.poll(async () => { try { return (await (await fetch(url + '/health')).json()).releaseId; } catch { return undefined; } }, { timeout: 7000 }).toBe(id); await expect.poll(async () => (await store.state()).pending, { timeout: 7000 }).toBeNull(); };
  return { dir, root, store, pack, url, adminUrl, controlBytes, startRunner, stop, ready };
}
it('installs immutable complete releases, verifies hashes and rejects symlinks, extra files and version ID collisions', async () => {
  const { dir, store, pack, root } = await fixture();
  const release = await pack('second'); await store.install(release); await store.install(release);
  expect(await readlink(join(root, 'current'))).toBe('versions/first');
  expect(await readlink(join(root, 'manager'))).toBe('versions/first');
  await expect(writeFile(join(store.directory('second'), 'server.mjs'), 'corruption')).rejects.toMatchObject({ code: 'EACCES' });
  const collision = join(dir, 'collision-source'); await cp(source, collision, { recursive: true }); await writeFile(join(collision, 'server.mjs'), 'throw new Error("changed")');
  const collisionRelease = join(dir, 'collision'); await packRelease(collision, collisionRelease, { id: 'second', version: '0.7.11', revision: 'fixture' });
  await expect(store.install(collisionRelease)).rejects.toThrow('different files');
  const invalid = join(dir, 'invalid'); await cp(release, invalid, { recursive: true }); await chmod(invalid, 0o700);
  await writeFile(join(invalid, 'credentials.json'), 'must not enter release'); await expect(verifyRelease(invalid)).rejects.toThrow('inventory');
  await rm(join(invalid, 'credentials.json')); await chmod(join(invalid, 'server.mjs'), 0o600); await writeFile(join(invalid, 'server.mjs'), 'corruption'); await expect(verifyRelease(invalid)).rejects.toThrow('checksum');
  await rm(join(invalid, 'server.mjs')); const { symlink } = await import('node:fs/promises'); await symlink(join(source, 'server.mjs'), join(invalid, 'server.mjs')); await expect(verifyRelease(invalid)).rejects.toThrow('non-regular');
  await mkdir(join(root, 'versions/.install-interrupted')); await writeFile(join(root, 'versions/.install-interrupted/server.mjs'), 'partial');
  expect((await store.list()).releases.map(item => item.id)).toEqual(['first', 'second']);
}, 20000);
it('switches server and assets together, keeps old browser assets available and rolls back without reverting data', async () => {
  const { store, pack, root, url, adminUrl, startRunner, stop, ready, controlBytes } = await fixture();
  let child = startRunner(); await ready('first');
  const state = newState(Date.now()); state.name = 'Persistent box';
  expect((await fetch(url + '/api/reports', { method: 'PUT', headers: { authorization: 'Bearer fixture-token' }, body: JSON.stringify({ id: 'test-box', state }) })).status).toBe(200);
  expect(await (await fetch(adminUrl + '/api/admin/boxes', { headers: { authorization: 'Bearer fixture-admin' } })).json()).toMatchObject({ acceptedReports: { http: 1, websocket: 0 } });
  const saved = await readFile(join(root, 'data/leaderboard.json'), 'utf8');
  await store.install(await pack('second')); await store.queue('second', 'activate'); await stop(child); child = startRunner(); await ready('second');
  expect(await readlink(join(root, 'current'))).toBe('versions/second'); expect(await readlink(join(root, 'manager'))).toBe('versions/first');
  const page = await (await fetch(adminUrl)).text(); expect(page).toContain('/releases/second/client.js'); expect(page).toContain('/releases/second/assets/MiSans-Regular.woff2');
  for (const id of ['first', 'second']) {
    const asset = await fetch(adminUrl + `/releases/${id}/client.js`); expect(asset.status).toBe(200); expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(url + `/releases/${id}/scene.js`)).status).toBe(200);
    expect((await fetch(url + `/releases/${id}/client.js`)).status).toBe(404);
    expect((await fetch(adminUrl + `/releases/${id}/server.mjs`)).status).toBe(404);
  }
  expect(await (await fetch(url + '/api/boxes/test-box')).json()).toMatchObject({ state: { name: 'Persistent box' } });
  await store.queue(undefined, 'rollback'); await stop(child); child = startRunner(); await ready('first');
  expect(await readFile(join(root, 'data/leaderboard.json'), 'utf8')).toBe(saved); expect(await readFile(join(root, 'data/controls.json'), 'utf8')).toBe(controlBytes);
  expect((await store.state()).history.map(item => item.status)).toEqual(['succeeded', 'succeeded']);
  expect((await fetch(adminUrl + '/releases/second/client.js')).status).toBe(200);
}, 20000);
it('automatically restores the healthy release after a candidate exits or fails release identity checks', async () => {
  const { store, pack, startRunner, stop, ready } = await fixture();
  await store.install(await pack('broken', 'throw new Error("fixture startup failure");'));
  const wrongIdentity = "process.env.CORTICO_TERRARIUM_RELEASE_ID='unexpected-release';\n" + await readFile(join(source, 'server.mjs'), 'utf8');
  await store.install(await pack('wrong-identity', wrongIdentity));
  for (const id of ['broken', 'wrong-identity']) {
    await store.queue(id, 'activate'); const child = startRunner(); await ready('first');
    expect((await store.state()).history.at(-1)).toMatchObject({ to: id, status: 'failed' }); await stop(child);
  }
}, 20000);
it('recovers an activation interrupted after its journal and pointer were changed', async () => {
  const { store, root, pack, startRunner, ready } = await fixture();
  await store.install(await pack('second')); const pending = await store.queue('second', 'activate');
  await store.starting(pending); await store.switchCurrent('second');
  startRunner(); await ready('first'); expect(await readlink(join(root, 'current'))).toBe('versions/first');
  expect((await store.state()).history.at(-1)).toMatchObject({ status: 'failed', error: 'Runner interrupted before activation was committed' });
}, 20000);
it('recovers from a killed activation process group and leaves the persistent controls intact', async () => {
  const { root, store, pack, startRunner, stop, ready, controlBytes } = await fixture();
  await store.install(await pack('stalled', 'setInterval(() => {}, 1000); await new Promise(() => {});'));
  await store.queue('stalled', 'activate'); const child = startRunner();
  await expect.poll(async () => (await store.state()).pending?.phase, { timeout: 5000 }).toBe('starting'); await stop(child, 'SIGKILL');
  startRunner(); await ready('first'); expect(await readFile(join(root, 'data/controls.json'), 'utf8')).toBe(controlBytes);
  expect((await store.state()).history.at(-1)?.status).toBe('failed');
}, 20000);
it('refuses concurrent transactions and incompatible data epochs before changing the current pointer', async () => {
  const { store, pack, root } = await fixture();
  await store.install(await pack('incompatible', undefined, 2)); await expect(store.queue('incompatible', 'activate')).rejects.toThrow('data compatibility');
  expect((await store.state()).pending).toBeNull(); expect(await readlink(join(root, 'current'))).toBe('versions/first');
  await store.install(await pack('second')); await store.queue('second', 'activate'); await expect(store.queue('incompatible', 'activate')).rejects.toThrow('pending');
}, 20000);
it('uses a kernel lock for command-line changes and retains an interrupted install outside the active release', async () => {
  const { root, store, pack } = await fixture();
  const release = await pack('second'), lock = join(root, '.deployment/lock');
  const holder = spawn('flock', ['--no-fork', '--nonblock', lock, process.execPath, '-e', 'process.stdout.write("locked\\n");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
  cleanup.push(async () => { if (holder.exitCode === null && holder.signalCode === null) { const exited = once(holder, 'exit'); holder.kill(); await exited; } });
  await once(holder.stdout!, 'data');
  const cli = spawn(process.execPath, [join(root, 'manager/release.mjs'), 'install', '--root', root, '--source', release], { stdio: ['ignore', 'pipe', 'pipe'] });
  let error = ''; cli.stderr!.on('data', chunk => { error += String(chunk); });
  const [code] = await once(cli, 'exit'); expect(code).toBe(1); expect(error).toContain('deployment lock');
  expect((await store.list()).releases.map(item => item.id)).toEqual(['first']);
}, 20000);

it('runs a sealed native executable, rolls back to Node and rejects an incompatible target', async () => {
  const { dir, store, root, url, pack, startRunner, stop, ready } = await fixture();
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const nativeSource = join(dir, 'native-source'); await cp(source, nativeSource, { recursive: true });
  await rm(join(nativeSource, 'server.mjs'));
  const cFile = join(dir, 'fixture.c');
  await writeFile(cFile, `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
int main(void) {
 int fd=socket(AF_INET,SOCK_STREAM,0), yes=1;
 setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof(yes));
 struct sockaddr_in addr={.sin_family=AF_INET,.sin_port=htons(atoi(getenv("PORT"))),.sin_addr.s_addr=htonl(INADDR_LOOPBACK)};
 if(bind(fd,(void*)&addr,sizeof(addr)) || listen(fd,16))return 1;
 for(;;){int client=accept(fd,0,0);if(client<0)continue;char req[2048],body[512],out[1024];
 read(client,req,sizeof(req));snprintf(body,sizeof(body),"{\\"ok\\":true,\\"releaseId\\":\\"%s\\"}",getenv("CORTICO_TERRARIUM_RELEASE_ID"));
 int len=snprintf(out,sizeof(out),"HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: %zu\\r\\nConnection: close\\r\\n\\r\\n%s",strlen(body),body);
 write(client,out,len);close(client);}
}`);
  await promisify(execFile)('cc', [cFile, '-o', join(nativeSource, 'server')]);
  const nativeRelease = join(dir, 'native');
  const runtime = { kind: 'native' as const, platform: 'linux' as const, arch: process.arch as 'x64' | 'arm64' };
  await packRelease(nativeSource, nativeRelease, { id: 'native', version: '0.1.0', revision: 'fixture', runtime });
  await store.install(nativeRelease);
  const { stat } = await import('node:fs/promises');
  expect((await stat(join(store.directory('native'), 'server'))).mode & 0o777).toBe(0o555);
  expect((await store.manifest('native')).schema).toBe(2);
  await store.queue('native', 'activate'); let child = startRunner(false); await ready('native');
  expect((await (await fetch(url + '/health')).json()).releaseId).toBe('native');
  await store.queue(undefined, 'rollback'); await stop(child); child = startRunner(false); await ready('first'); await stop(child);
  const wrong = join(dir, 'wrong-target');
  await packRelease(nativeSource, wrong, { id: 'wrong-target', version: '0.1.0', revision: 'fixture', runtime: { ...runtime, arch: process.arch === 'x64' ? 'arm64' : 'x64' } });
  await store.install(wrong); await store.queue('wrong-target', 'activate'); child = startRunner(false); await ready('first');
  expect((await store.state()).history.at(-1)?.error).toContain('target'); await stop(child);
  await store.install(await pack('controller')); await store.upgradeController('controller');
  expect(await readlink(join(root, 'manager'))).toBe('versions/controller');
  expect((await store.state()).controller).toBe('controller');
  expect((await store.state()).current).toBe('first');
}, 20000);
