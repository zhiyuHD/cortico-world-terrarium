import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE = {
  version: TERRARIUM_CLIENT_VERSION,
  theme: '闲看生机',
  improvements: [
    '照料诊断区分补水、排水、调整光照与等待天亮；详细规则可按主题查询，缩短日常提示词。',
    '观察页每页展示 4 个生态箱，搜索和排序覆盖全部箱子。',
    '列表仅下载当前页画面数据，点击后才加载捕食回放；历史和收藏不随列表下载。',
    '离屏卡片和后台页面暂停绘制，后台停止轮询；当前页每 15 秒刷新。',
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
