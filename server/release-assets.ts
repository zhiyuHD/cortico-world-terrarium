import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validReleaseId } from './releases.ts';

export const CONSOLE_ASSETS: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'], '/client.js': ['client.js', 'text/javascript; charset=utf-8'], '/client.css': ['client.css', 'text/css; charset=utf-8'],
  '/assets/icons.svg': ['assets/icons.svg', 'image/svg+xml'], '/assets/MiSans-Regular.woff2': ['assets/MiSans-Regular.woff2', 'font/woff2'], '/assets/MiSans-Semibold.woff2': ['assets/MiSans-Semibold.woff2', 'font/woff2'],
  '/assets/MiSans-LICENSE.pdf': ['assets/MiSans-LICENSE.pdf', 'application/pdf'], '/assets/Lucide-LICENSE.txt': ['assets/Lucide-LICENSE.txt', 'text/plain; charset=utf-8'],
};
export function pinConsoleHtml(page: Uint8Array, id?: string): Uint8Array {
  if (!id || !validReleaseId(id)) return page;
  return Buffer.from(Buffer.from(page).toString().replace(/(href|src)="\/(client\.js|client\.css|assets\/[a-zA-Z0-9._-]+)"/g, `$1="/releases/${id}/$2"`));
}
export async function historicalAsset(root: string, path: string, privateAdmin: boolean): Promise<{ bytes: Buffer; type: string } | undefined> {
  const match = /^\/releases\/([^/]+)(\/.*)$/.exec(path);
  if (!match || !validReleaseId(match[1])) return;
  const asset = privateAdmin ? CONSOLE_ASSETS[match[2]] : match[2] === '/scene.js' ? ['scene.js', 'text/javascript; charset=utf-8'] : undefined;
  if (!asset || match[2] === '/') return;
  const file = join(root, 'versions', match[1], ...(privateAdmin ? ['console', asset[0]] : [asset[0]]));
  try { return { bytes: await readFile(file), type: asset[1] }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
