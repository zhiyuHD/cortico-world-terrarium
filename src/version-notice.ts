import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE: { version: string; theme?: string; improvements: string[] } = {
  version: TERRARIUM_CLIENT_VERSION,
  theme: '新收成',
  improvements: [
    '地箱新增西瓜、甜瓜和小麦：西瓜 30 小时初熟、每 24 小时再熟一轮，甜瓜 22/12 小时，小麦 20/10 小时；采下的果实按各自价格出售，西瓜 12、甜瓜 6、小麦 3 金币一份。',
    '西瓜和甜瓜开花后可由蜜蜂、蝴蝶异株授粉，每轮多收一份；小麦自花结实，不需要授粉。',
    'terrarium_manage 新增 pause 操作：冻结一个箱子后照常保存和上报，但不再推进模拟，水分、健康、饥饿、生长、卵和饲料都保持剩余时长，回来接着走，不补算离开的时间。',
    '水箱面板可以直接放养鱼虾、投喂、换水、挪鱼和移出；地箱面板可以收果、卖果，两箱面板都显示画布异常的具体原因，不再留空白画面。',
    '放养鱼类失败时列出全部可用种类；批量浇水逐格报告跳过原因与该格实际下限；手动完整同步不再断开长连接，失败信息包含断开代码。',
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
