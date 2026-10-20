import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE = {
  version: TERRARIUM_CLIENT_VERSION,
  theme: '新叶来信',
  improvements: [
    '地、水新手来信分别说明照料方法，每章附操作后的确认方法，第一封提醒避免过量浇水。',
    '操作回执提供当前引导任务；支持安全重试、地箱区域播种和浇水跳过统计。',
    '网络注册失败时保留本地认领；面板补齐积分分项、规则、扩建还差多少分与空格放回提示。',
    'Canvas 渲染拆成独立 terrarium-renderer 包，地、水、蚁巢和回放使用同一套画面代码。',
    '排名提醒默认间隔改为 120 分钟；显式配置保留。后续版本首次启动也会提供一次更新说明。',
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
