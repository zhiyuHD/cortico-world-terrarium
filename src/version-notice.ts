import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE: { version: string; theme?: string; improvements: string[] } = {
  version: TERRARIUM_CLIENT_VERSION,
  theme: '满庭新事',
  improvements: [
    '番茄、草莓可反复采收出售；蘑菇、鼠妇和蜗牛加入落叶分解与堆肥循环。',
    '蚁群可暂停繁殖、限制数量，并利用共享储粮保护植物；收藏蚂蚁恢复时自动寻找附近空格。',
    '新增青鳉、米虾、水螺、苦草与莫丝；支持直接移栽、地面装饰和植物悬停详情。',
    '双方开启后可邻里来访、共享采收、赠送种子和留便笺；默认关闭，不改动对方的本地植物。',
    '模型工具整合为 14 个入口，使用 operation 选择操作；完整规则按 topic 读取。',
    '损坏的公告缓存会备份并重建；服务端优化观察页读取、策略检查和高峰提交排队。',

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
