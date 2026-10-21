import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE: { version: string; theme?: string; improvements: string[] } = {
  version: TERRARIUM_CLIENT_VERSION,
  improvements: [
    '地箱和水箱统一通过 WS 提交；握手失败不再自动回退到已停用的 HTTP Push。各箱 ID、token 和增量基准保持独立。',
    '排行榜等 GET 读取遇到连接重置时，在原超时内换新连接重试一次；注册、反馈和发帖不自动重试。',
    '同步错误标出箱子与失败步骤，并显示本次尝试的通道和快照时间；只有收到成功确认才更新成功时间。',
    '时间拒绝包含快照与服务端时间，便于排查时间偏差；原有存档与凭据保留。',
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
