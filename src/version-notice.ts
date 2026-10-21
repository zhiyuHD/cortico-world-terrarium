import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE: { version: string; theme?: string; improvements: string[] } = {
  version: TERRARIUM_CLIENT_VERSION,
  improvements: [
    '首次上报、排行榜和公告读取改为后台执行，网络延迟不再阻塞 World 启动和本地查看。地箱和水箱首次同步独立进行。',
    '启动时仍完成本地读档、离线补算和保存；同步失败保留本地状态，并按原有计划重试。',
    '停止时取消未完成的网络请求并等待后台任务退出，防止停止后继续投递公告或重建连接。',
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
