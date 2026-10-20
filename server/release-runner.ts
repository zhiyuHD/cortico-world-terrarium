import { realpathSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ReleaseStore, type ReleaseManifest } from './releases.ts';

interface RunningServer { child: ChildProcess; done: Promise<void>; ended: boolean; error?: string }
export async function runDeployment(root: string): Promise<void> {
  const store = new ReleaseStore(root);
  const timeoutMs = Number(process.env.CORTICO_TERRARIUM_START_TIMEOUT_MS ?? 20000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1500 || timeoutMs > 120000) throw new Error('Invalid server startup timeout');
  const healthUrl = new URL(process.env.CORTICO_TERRARIUM_HEALTH_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}/health`);
  if (healthUrl.protocol !== 'http:' || healthUrl.hostname !== '127.0.0.1' || healthUrl.pathname !== '/health') throw new Error('Release health URL must use loopback HTTP /health');
  let active: RunningServer | undefined, stopping = false;
  const stop = async (server: RunningServer | undefined) => {
    if (!server || server.ended) return;
    server.child.kill('SIGTERM');
    const timeout = setTimeout(() => { server.child.kill('SIGKILL'); }, 3000); timeout.unref();
    try { await server.done; } finally { clearTimeout(timeout); }
  };
  const shutdown = () => { stopping = true; void stop(active); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  const launch = (manifest: ReleaseManifest) => {
    const runtime = manifest.runtime;
    if (runtime && (runtime.platform !== process.platform || runtime.arch !== process.arch)) throw new Error('Native release target does not match this host');
    const executable = runtime ? join(store.directory(manifest.id), 'server') : process.execPath;
    const args = runtime ? [] : [join(store.directory(manifest.id), 'server.mjs')];
    const child = spawn(executable, args, { cwd: store.root, stdio: 'inherit', env: { ...process.env, TERRARIUM_SERVER_MAIN: '1', CORTICO_TERRARIUM_RELEASE_ID: manifest.id, CORTICO_TERRARIUM_DEPLOY_ROOT: store.root } });
    const server: RunningServer = { child, done: Promise.resolve(), ended: false };
    server.done = new Promise<void>(resolve => {
      child.once('error', error => { server.error = error.message; server.ended = true; resolve(); });
      child.once('exit', (code, signal) => { server.error = `Server exited (${signal ?? code})`; server.ended = true; resolve(); });
    });
    active = server; return server;
  };
  const healthy = async (server: RunningServer, manifest: ReleaseManifest) => {
    const deadline = Date.now() + timeoutMs; let readySince = 0, lastError = '';
    while (Date.now() < deadline) {
      if (stopping) throw new Error('Runner stopped during activation');
      if (server.ended) throw new Error(server.error);
      try {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000), redirect: 'error' });
        const health = await response.json() as { ok?: boolean; releaseId?: string };
        if (!response.ok || health.ok !== true || (manifest.healthProtocol === 1 && health.releaseId !== manifest.id)) throw new Error('Server release health check did not match');
        const urls = [new URL('/', healthUrl)];
        if (process.env.CORTICO_TERRARIUM_ADMIN_HOST) {
          const admin = `http://${process.env.CORTICO_TERRARIUM_ADMIN_HOST}:${process.env.CORTICO_TERRARIUM_ADMIN_PORT ?? 8788}`;
          urls.push(new URL('/', admin), new URL('/client.js', admin), new URL('/client.css', admin));
        }
        for (const url of urls) { const result = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' }); await result.body?.cancel(); if (!result.ok) throw new Error(`Server asset check failed: ${url.pathname} (${result.status})`); }
        if (!readySince) readySince = Date.now();
        if (Date.now() - readySince >= 750 && !server.ended) return;
      } catch (error) { lastError = (error as Error).message; readySince = 0; }
      await delay(150);
    }
    throw new Error(`Server startup timed out: ${lastError}`);
  };
  try {
    let state = await store.state();
    if (state.pending?.phase === 'starting') {
      const pending = state.pending;
      await store.switchCurrent(pending.from);
      await store.finish(pending, 'Runner interrupted before activation was committed');
      console.error(`Recovered interrupted deployment ${pending.to}; restored ${pending.from}`);
      state = await store.state();
    }
    if (state.pending) {
      const pending = state.pending;
      try {
        const manifest = await store.manifest(pending.to);
        const previous = await store.manifest(pending.from);
        if (manifest.dataEpoch !== previous.dataEpoch) throw new Error('Release data compatibility differs');
        await store.starting(pending); await store.switchCurrent(pending.to);
        const candidate = launch(manifest); await healthy(candidate, manifest);
        if (stopping) return;
        await store.finish(pending);
        console.log(`Activated ${pending.to}; previous ${pending.from}`);
      } catch (error) {
        await stop(active); active = undefined;
        if (stopping) return;
        await store.switchCurrent(pending.from); await store.finish(pending, (error as Error).message);
        console.error(`Activation failed; restored ${pending.from}: ${(error as Error).message}`);
      }
    }
    if (!active && !stopping) {
      state = await store.state(); const manifest = await store.manifest(state.current);
      await store.switchCurrent(state.current);
      const server = launch(manifest); await healthy(server, manifest);
      console.log(`Serving ${manifest.id}`);
    }
    if (active) { await active.done; if (!stopping) throw new Error(active.error); }
  } finally { await stop(active); process.off('SIGTERM', shutdown); process.off('SIGINT', shutdown); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const root = process.env.CORTICO_TERRARIUM_DEPLOY_ROOT;
  if (!root) { console.error('CORTICO_TERRARIUM_DEPLOY_ROOT is required'); process.exitCode = 1; }
  else void runDeployment(root).catch(error => { console.error((error as Error).stack); process.exitCode = 1; });
}
