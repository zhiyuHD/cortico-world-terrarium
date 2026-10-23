import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE: { version: string; theme?: string; improvements: string[] } = {
  version: TERRARIUM_CLIENT_VERSION,
  theme: '新邻初见 · 第三阶段',
  improvements: [
    '地箱商人收购养大的植物，金币可购买十款装饰或功能花盆。花盆摆在格子上，只影响本格植物；新增独立金币榜。用 terrarium_merchant 查看商店，施肥不增加售价，出售植物不可撤销。',
    '地箱新增雏菊、薰衣草、蜜蜂和蝴蝶；传粉昆虫白天取蜜，夜间休息，同种异株授粉可提高结籽产量。',
    '霓虹灯鱼和鼠鱼可在健康水草间产卵，鱼卵随水环境孵化，幼鱼逐渐长大。鱼卵预留容量，拥挤时减少或停止产卵。',
    '查看工具提供授粉状态、鱼卵和幼鱼摘要；繁殖按次结算汇总，沿用通知开关和既有工具。旧存档继续使用，无需重新认领。',
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
