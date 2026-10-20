import { realpathSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { packRelease, ReleaseStore, verifyRelease } from './releases.ts';

const help = `pack --source <build-dir> --output <new-dir> --id <release-id> --version <version> --revision <commit> [--legacy-health] [--native-target linux-x64|linux-arm64 --data-epoch <number>]
install --source <release-dir> --root <deployment>
init --id <installed-release> --root <deployment>
upgrade-controller --id <installed-release> --root <deployment>
status | list | verify --id <release-id>
activate --id <release-id> [--service cortico-box.service]
rollback [--id <release-id>] [--service cortico-box.service]
recover [--service cortico-box.service]
Deployment commands use --root or CORTICO_TERRARIUM_DEPLOY_ROOT. Updates and rollback restart the user systemd service; data/ is never copied or restored.`;
async function command(program: string, args: string[], env = process.env): Promise<number> {
  const child = spawn(program, args, { stdio: 'inherit', env });
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => signal ? reject(new Error(`${program} interrupted: ${signal}`)) : resolve(code ?? 1)); });
}
export async function releaseCli(args: string[]): Promise<unknown> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { root: { type: 'string' }, source: { type: 'string' }, output: { type: 'string' }, id: { type: 'string' }, version: { type: 'string' }, revision: { type: 'string' }, service: { type: 'string', default: 'cortico-box.service' }, 'native-target': { type: 'string' }, 'data-epoch': { type: 'string' }, 'legacy-health': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) return help;
  const [action] = positionals;
  if (positionals.length !== 1 || !['pack', 'install', 'init', 'upgrade-controller', 'status', 'list', 'verify', 'activate', 'rollback', 'recover'].includes(action)) throw new Error(help);
  if (action === 'pack') {
    if (!values.source || !values.output || !values.id || !values.version || !values.revision) throw new Error(help);
    if (values['native-target'] && !['linux-x64', 'linux-arm64'].includes(values['native-target'])) throw new Error('Invalid native target');
    const dataEpoch = values['data-epoch'] === undefined ? undefined : Number(values['data-epoch']);
    if ((values['native-target'] && dataEpoch === undefined) || (dataEpoch !== undefined && (!Number.isSafeInteger(dataEpoch) || dataEpoch < 1))) throw new Error('Native releases require an explicit positive data epoch');
    const runtime = values['native-target'] ? { kind: 'native' as const, platform: 'linux' as const, arch: values['native-target'].slice(6) as 'x64' | 'arm64' } : undefined;
    return packRelease(resolve(values.source), resolve(values.output), { id: values.id, version: values.version, revision: values.revision, healthProtocol: values['legacy-health'] ? 0 : 1, ...(runtime ? { runtime } : {}), ...(dataEpoch === undefined ? {} : { dataEpoch }) });
  }
  const root = values.root ?? process.env.CORTICO_TERRARIUM_DEPLOY_ROOT;
  if (!root) throw new Error('--root is required');
  const store = new ReleaseStore(root);
  if (action === 'status') return store.state();
  if (action === 'list') return store.list();
  if (action === 'verify') { if (!values.id) throw new Error('--id is required'); return verifyRelease(store.directory(values.id)); }
  // flock belongs to the CLI process tree and is released by the kernel after interruption.
  if (process.env.CORTICO_TERRARIUM_RELEASE_LOCKED !== '1') {
    const lock = join(store.root, '.deployment/lock'); await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
    const handle = await open(lock, 'a', 0o600); await handle.close();
    const code = await command('flock', ['--nonblock', '--conflict-exit-code', '75', lock, process.execPath, fileURLToPath(import.meta.url), ...args], { ...process.env, CORTICO_TERRARIUM_RELEASE_LOCKED: '1' });
    if (code !== 0) throw new Error(code === 75 ? 'Another release operation holds the deployment lock' : `Release operation failed (${code})`);
    return undefined;
  }
  if (action === 'install') { if (!values.source) throw new Error('--source is required'); return store.install(resolve(values.source)); }
  if (action === 'upgrade-controller') { if (!values.id) throw new Error('--id is required'); await store.upgradeController(values.id); return store.state(); }
  if (action === 'init') { if (!values.id) throw new Error('--id is required'); await store.initialize(values.id); return store.state(); }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*\.service$/.test(values.service)) throw new Error('Invalid user service name');
  const pending = action === 'recover' ? (await store.state()).pending : await store.queue(values.id, action === 'rollback' ? 'rollback' : 'activate');
  if (action === 'recover' && !pending) return store.state();
  const code = await command('systemctl', ['--user', 'restart', values.service]);
  if (code !== 0) throw new Error('Could not restart the runner; the journal is retained. Run recover after correcting the service.');
  const deadline = Date.now() + 2 * Number(process.env.CORTICO_TERRARIUM_START_TIMEOUT_MS ?? 20000) + 15000;
  while (Date.now() < deadline) {
    const state = await store.state();
    if (!state.pending) {
      const result = state.history.find(item => item.id === pending?.id);
      if (result?.status === 'failed') throw new Error(`Activation failed; restored ${state.current}: ${result.error}`);
      return state;
    }
    await delay(200);
  }
  throw new Error('Runner has not finished the transaction. Inspect status and service logs; the journal is retained.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) void releaseCli(process.argv.slice(2)).then(result => { if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2)); }).catch(error => { console.error((error as Error).message); process.exitCode = 1; });
