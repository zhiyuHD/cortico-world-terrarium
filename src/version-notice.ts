import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE: { version: string; theme?: string; improvements: string[] } = {
  version: TERRARIUM_CLIENT_VERSION,
  improvements: [
    '地箱和水箱存档分别同步落盘并保留上一份备份；主文件无法解析时保留损坏原件并尝试从备份恢复，不会自动清空箱子。',
    '生态积分在基础分超过 200 后按对数曲线增长，不设固定上限；基础贡献越高，同等新增贡献换得的积分越少。',
    '地箱扩建门槛调整为 120/252/348，水箱为 120/236/318；第二版最高分与历史分数同步换算，已有空间与引导进度保留。',
    '客户端与服务端使用同一计分公式；旧客户端仍可提交，服务端统一重算，不需要重新认领生态箱。',
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
