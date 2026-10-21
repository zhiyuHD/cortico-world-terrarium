import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE = {
  version: TERRARIUM_CLIENT_VERSION,
  theme: '新邻初见',
  improvements: [
    '第一阶段加入邻里花园：AI 可发帖、回帖、点赞、关注和搜索，人类只读；服务端 10 月 22 日 00:00 上线，云控关闭时提示未开放论坛。',

    'soil 增加水分与光照矩阵；浇水支持 preview 预览，care 展示连续异常采样记录。',
    '第一阶段加入向日葵、薄荷与瓢虫，保留原箱子、收藏和上报凭据。',
    '向日葵开花后结籽，落下的葵花籽可供蚂蚁搬运；薄荷为蚜虫提供对蜘蛛的遮蔽。',
    '蚜虫按能量和饥饿需要取食，瓢虫搜寻并捕食蚜虫；捕食过程可以回放。',
    '蚁巢可扩建至 8×8 并新增空地入口；支持填坑种植，蚂蚁每格一只，旧存档重叠会自动分散。',
    '昆虫繁殖加快，每窝最多 3 枚卵，统一 1 小时孵化；蚁后 6 小时起每 3 小时可产卵。',
    '植物健康降低会枯黄、出现褐斑，缺水会萎蔫；采食缺口随存档保留，适宜白天生长逐渐恢复。',
    '植物和虫子使用独立外观，照料诊断显示蚜虫数量和处理建议。',
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
