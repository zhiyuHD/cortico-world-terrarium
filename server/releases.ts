import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const RELEASE_DATA_EPOCH = 1;
const idPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const required = ['server.mjs', 'admin.mjs', 'release.mjs', 'runner.mjs', 'index.html', 'scene.js', 'console/index.html', 'console/client.js', 'console/client.css', 'console/assets/icons.svg', 'console/assets/MiSans-Regular.woff2', 'console/assets/MiSans-Semibold.woff2', 'console/assets/MiSans-LICENSE.pdf', 'console/assets/Lucide-LICENSE.txt'];
interface ReleaseFile { path: string; size: number; sha256: string }
export interface ReleaseManifest { schema: 1; id: string; version: string; revision: string; createdAt: string; dataEpoch: number; healthProtocol: 0 | 1; files: ReleaseFile[] }
export interface ReleaseTransaction { id: string; action: 'activate' | 'rollback'; from: string; to: string; phase: 'queued' | 'starting'; requestedAt: string }
export interface ReleaseResult { id: string; action: 'activate' | 'rollback'; from: string; to: string; status: 'succeeded' | 'failed'; finishedAt: string; error?: string }
export interface DeploymentState { schema: 1; controller: string; current: string; previous: string | null; pending: ReleaseTransaction | null; history: ReleaseResult[] }
export function validReleaseId(id: unknown): id is string { return typeof id === 'string' && idPattern.test(id) && id !== '.' && id !== '..'; }
function validPath(path: unknown): path is string { return typeof path === 'string' && (required.includes(path) || /^console\/assets\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(path)); }
function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
async function syncDirectory(path: string) { const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
export async function durableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`, handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temp, path); await syncDirectory(dirname(path)); } finally { await rm(temp, { force: true }); }
}
async function filesIn(dir: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(dir)) {
    const relative = prefix + item, info = await lstat(join(dir, item));
    if (info.isDirectory()) result.push(...await filesIn(join(dir, item), `${relative}/`));
    else if (info.isFile()) result.push(relative);
    else throw new Error(`Release contains a non-regular file: ${relative}`);
  }
  return result.sort();
}
async function fileBytes(dir: string, path: string): Promise<Buffer> {
  const info = await lstat(join(dir, path));
  if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error(`Invalid release file: ${path}`);
  return readFile(join(dir, path));
}
export async function verifyRelease(dir: string): Promise<ReleaseManifest> {
  if (!(await lstat(dir)).isDirectory()) throw new Error('Release must be a directory');
  const raw = await fileBytes(dir, 'release.json');
  if (raw.length > 65536) throw new Error('Release manifest is too large');
  const manifest = JSON.parse(raw.toString()) as ReleaseManifest;
  if (manifest.schema !== 1 || !validReleaseId(manifest.id) || typeof manifest.version !== 'string' || manifest.version.length > 80 || typeof manifest.revision !== 'string' || manifest.revision.length > 80 || !Number.isFinite(Date.parse(manifest.createdAt)) || !Number.isSafeInteger(manifest.dataEpoch) || manifest.dataEpoch < 1 || ![0, 1].includes(manifest.healthProtocol) || !Array.isArray(manifest.files) || manifest.files.length > 128 || !manifest.files.every(file => file && validPath(file.path) && Number.isSafeInteger(file.size) && file.size >= 0 && /^[a-f0-9]{64}$/.test(file.sha256))) throw new Error('Invalid release manifest');
  const names = manifest.files.map(file => file.path);
  if (new Set(names).size !== names.length || required.some(path => !names.includes(path)) || manifest.files.reduce((total, file) => total + file.size, 0) > 64 * 1024 * 1024) throw new Error('Incomplete or oversized release');
  const actual = await filesIn(dir);
  if (JSON.stringify(actual) !== JSON.stringify(['release.json', ...names].sort())) throw new Error('Release file inventory mismatch');
  for (const file of manifest.files) { const bytes = await fileBytes(dir, file.path); if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error(`Release checksum mismatch: ${file.path}`); }
  return manifest;
}
async function copyPayload(source: string, target: string, paths: string[]) {
  await mkdir(target, { recursive: true });
  for (const path of paths) { await mkdir(dirname(join(target, path)), { recursive: true }); await copyFile(join(source, path), join(target, path)); }
}
async function seal(dir: string) {
  for (const item of await readdir(dir)) {
    const path = join(dir, item);
    if ((await lstat(path)).isDirectory()) await seal(path);
    else { await chmod(path, 0o444); const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); } }
  }
  await chmod(dir, 0o555); await syncDirectory(dir);
}
async function removeStaging(dir: string) {
  try { await chmod(dir, 0o700); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const item of await readdir(dir)) { const path = join(dir, item); if ((await lstat(path)).isDirectory()) await removeStaging(path); }
  await rm(dir, { recursive: true, force: true });
}
export async function packRelease(source: string, output: string, metadata: Pick<ReleaseManifest, 'id' | 'version' | 'revision'> & { healthProtocol?: 0 | 1; dataEpoch?: number }): Promise<ReleaseManifest> {
  if (!validReleaseId(metadata.id)) throw new Error('Invalid release ID');
  const paths = [...new Set([...required, ...(await filesIn(join(source, 'console/assets'))).map(path => 'console/assets/' + path)])];
  if (paths.some(path => !validPath(path))) throw new Error('Unsupported release payload path');
  const temp = resolve(dirname(output), `.pack-${randomUUID()}`);
  await mkdir(dirname(output), { recursive: true });
  try {
    // Building only copies the declared server payload; deployment data never enters a release.
    for (const path of paths) { if (!(await lstat(join(source, path))).isFile()) throw new Error(`Invalid source file: ${path}`); }
    await copyPayload(source, temp, paths);
    const files = await Promise.all(paths.sort().map(async path => { const bytes = await fileBytes(temp, path); return { path, size: bytes.length, sha256: sha256(bytes) }; }));
    const manifest: ReleaseManifest = { schema: 1, ...metadata, createdAt: new Date().toISOString(), dataEpoch: metadata.dataEpoch ?? RELEASE_DATA_EPOCH, healthProtocol: metadata.healthProtocol ?? 1, files };
    await durableJson(join(temp, 'release.json'), manifest); await verifyRelease(temp); await seal(temp);
    await rename(temp, output); await syncDirectory(dirname(resolve(output))); return manifest;
  } finally { await removeStaging(temp); }
}
export class ReleaseStore {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private get stateFile() { return join(this.root, '.deployment/state.json'); }
  directory(id: string) { if (!validReleaseId(id)) throw new Error('Invalid release ID'); return join(this.root, 'versions', id); }
  async state(): Promise<DeploymentState> {
    const state = JSON.parse(await readFile(this.stateFile, 'utf8')) as DeploymentState;
    const pending = state.pending;
    if (state.schema !== 1 || !validReleaseId(state.controller) || !validReleaseId(state.current) || (state.previous !== null && !validReleaseId(state.previous)) || !Array.isArray(state.history) || state.history.length > 100 || !state.history.every(item => item && typeof item.id === 'string' && ['activate', 'rollback'].includes(item.action) && validReleaseId(item.from) && validReleaseId(item.to) && ['succeeded', 'failed'].includes(item.status) && Number.isFinite(Date.parse(item.finishedAt)) && (item.error === undefined || typeof item.error === 'string')) || (pending !== null && (!pending || pending.from !== state.current || !validReleaseId(pending.to) || pending.from === pending.to || !['queued', 'starting'].includes(pending.phase) || !['activate', 'rollback'].includes(pending.action) || typeof pending.id !== 'string' || !Number.isFinite(Date.parse(pending.requestedAt))))) throw new Error('Invalid deployment state');
    return state;
  }
  async manifest(id: string): Promise<ReleaseManifest> { const manifest = await verifyRelease(this.directory(id)); if (manifest.id !== id) throw new Error('Release directory ID mismatch'); return manifest; }
  async save(state: DeploymentState) { await durableJson(this.stateFile, state); }
  async install(source: string): Promise<ReleaseManifest> {
    const manifest = await verifyRelease(source), destination = this.directory(manifest.id);
    await mkdir(join(this.root, 'versions'), { recursive: true });
    try {
      const existing = await verifyRelease(destination);
      if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error('Release ID already contains different files');
      return existing;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temp = join(this.root, 'versions', `.install-${randomUUID()}`);
    try {
      await copyPayload(source, temp, ['release.json', ...manifest.files.map(file => file.path)]);
      if (JSON.stringify(await verifyRelease(temp)) !== JSON.stringify(manifest)) throw new Error('Release changed during installation'); await seal(temp); await rename(temp, destination); await syncDirectory(join(this.root, 'versions'));
    } finally { await removeStaging(temp); }
    return manifest;
  }
  async switchCurrent(id: string) {
    await this.manifest(id);
    const temp = join(this.root, `.current-${randomUUID()}`);
    try { await symlink(`versions/${id}`, temp); await rename(temp, join(this.root, 'current')); await syncDirectory(this.root); } finally { await rm(temp, { force: true }); }
  }
  async initialize(id: string) {
    await this.manifest(id);
    try {
      const state = await this.state();
      if (state.current !== id || state.controller !== id || state.pending || state.history.length) throw new Error('Deployment is already initialized');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.save({ schema: 1, controller: id, current: id, previous: null, pending: null, history: [] });
    }
    await this.switchCurrent(id);
    const temp = join(this.root, `.manager-${randomUUID()}`);
    try { await symlink(`versions/${id}`, temp); await rename(temp, join(this.root, 'manager')); await syncDirectory(this.root); } finally { await rm(temp, { force: true }); }
  }
  async queue(target: string | undefined, action: 'activate' | 'rollback'): Promise<ReleaseTransaction> {
    const state = await this.state();
    if (state.pending) throw new Error('A deployment transaction is pending; restart the runner to recover it');
    const to = target ?? (action === 'rollback' ? state.previous : null);
    if (!to || to === state.current) throw new Error('Choose a release different from current');
    const current = await this.manifest(state.current), next = await this.manifest(to);
    if (next.dataEpoch !== current.dataEpoch) throw new Error('Release data compatibility differs; an explicit data migration is required');
    const pending: ReleaseTransaction = { id: randomUUID(), action, from: state.current, to, phase: 'queued', requestedAt: new Date().toISOString() };
    await this.save({ ...state, pending }); return pending;
  }
  async starting(transaction: ReleaseTransaction) {
    const state = await this.state();
    if (state.pending?.id !== transaction.id) throw new Error('Deployment transaction changed');
    await this.save({ ...state, pending: { ...transaction, phase: 'starting' } });
  }
  async finish(transaction: ReleaseTransaction, error?: string) {
    const state = await this.state();
    if (state.pending?.id !== transaction.id) throw new Error('Deployment transaction changed');
    const result: ReleaseResult = { id: transaction.id, action: transaction.action, from: transaction.from, to: transaction.to, status: error === undefined ? 'succeeded' : 'failed', finishedAt: new Date().toISOString(), ...(error === undefined ? {} : { error: error.slice(0, 1000) }) };
    await this.save({ schema: 1, controller: state.controller, current: error === undefined ? transaction.to : transaction.from, previous: error === undefined ? transaction.from : state.previous, pending: null, history: [...state.history, result].slice(-100) });
    return result;
  }
  async list() {
    const state = await this.state(), releases: Array<{ id: string; current: boolean; previous: boolean; manifest?: ReleaseManifest; error?: string }> = [];
    for (const id of (await readdir(join(this.root, 'versions'))).filter(validReleaseId).sort()) {
      try { releases.push({ id, current: state.current === id, previous: state.previous === id, manifest: await this.manifest(id) }); }
      catch (error) { releases.push({ id, current: state.current === id, previous: state.previous === id, error: (error as Error).message }); }
    }
    return { ...state, releases };
  }
}
