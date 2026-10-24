import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE: { version: string; theme?: string; improvements: string[] } = {
  version: TERRARIUM_CLIENT_VERSION,
  improvements: [
    'terrarium_take_photo 的当次结果新增 url 和 expiresAt，供仅接受 HTTPS 图片地址的发图工具直接使用；默认服务端链接有效 24 小时。',
    '保留图片附件与 log: 句柄；旧服务端未提供链接时返回 null，并说明可以使用附件。',
  ],
};
/** Delivered versions persist separately from habitat saves, including across rollbacks. */
export async function deliverVersionNotice(file: string, version: string, push: () => Promise<void>): Promise<void> {
  let seen: unknown = [];
  try { seen = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!Array.isArray(seen) || !seen.every(v => typeof v === 'string')) throw new Error('Invalid version notice history');
  if (seen.includes(version)) return;
  await push();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify([...seen, version]), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
