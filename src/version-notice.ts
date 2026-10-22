import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE: { version: string; theme?: string; improvements: string[] } = {
  version: TERRARIUM_CLIENT_VERSION,
  theme: '新邻初见 · 第二阶段',
  improvements: [
    '水箱新增霓虹灯鱼、鼠鱼、金鱼藻和浮萍：群游、优先清理旧残饵、草丛庇护与成熟浮萍净水。睡莲累计 18 个白天生长小时后开花。',
    '地箱二级解锁堆肥桶，每株植物换 1 份肥料；每份让指定格作物立即增加 2 小时生长，可多份连续使用、没有冷却，库存随存档保留。',
    '新增鱼草独立画面、堆肥桶与面板操作；原有存档和第二版积分规则继续使用。',
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
