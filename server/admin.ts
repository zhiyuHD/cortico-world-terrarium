import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export async function runAdmin(args: string[]): Promise<unknown> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    server: { type: 'string', default: 'http://127.0.0.1:8787' }, 'token-file': { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, 'text-file': { type: 'string' }, to: { type: 'string', multiple: true }, 'expires-hours': { type: 'string', default: '168' }, help: { type: 'boolean' },
  } });
  if (values.help) return 'publish --text "公告内容" [--title "标题"] [--to box-id] [--expires-hours 168] | list | revoke <id>\nOptional: --text-file <file>, --server <url>, --token-file <file>. Default token file: ./data/admin-token.';
  const [command, id] = positionals;
  if (!['publish', 'list', 'revoke'].includes(command) || (command === 'revoke' ? !/^[1-9][0-9]*$/.test(id ?? '') || positionals.length !== 2 : positionals.length !== 1)) throw new Error('Use publish, list or revoke <id>; see --help');
  const url = new URL(`/api/admin/announcements${command === 'revoke' ? `/${id}` : ''}`, values.server);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Remote admin requests require HTTPS');
  const token = process.env.CORTICO_TERRARIUM_ADMIN_TOKEN ?? (await readFile(values['token-file'] ?? process.env.CORTICO_TERRARIUM_ADMIN_TOKEN_FILE ?? './data/admin-token', 'utf8')).trim();
  if (!token) throw new Error('Admin token is empty');
  let body: string | undefined;
  if (command === 'publish') {
    if (values.text !== undefined && values['text-file'] !== undefined) throw new Error('Supply --text or --text-file');
    const hours = Number(values['expires-hours']);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 720) throw new Error('Expiry must be greater than zero and at most 720 hours');
    const text = values['text-file'] ? await readFile(values['text-file'], 'utf8') : values.text;
    const targets = values.to?.flatMap(value => value.split(',').map(id => id.trim()).filter(Boolean));
    body = JSON.stringify({ text, title: values.title, targets: targets ? [...new Set(targets)] : 'all', expiresAt: new Date(Date.now() + hours * 3600000).toISOString() });
  }
  const response = await fetch(url, { method: command === 'publish' ? 'POST' : command === 'revoke' ? 'DELETE' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body, signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Announcements HTTP ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void runAdmin(process.argv.slice(2)).then(result => console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))).catch(error => { console.error((error as Error).message); process.exitCode = 1; });
}
