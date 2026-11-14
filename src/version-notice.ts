import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TERRARIUM_CLIENT_VERSION } from './version.ts';

export const TERRARIUM_VERSION_NOTICE: { version: string; theme?: string; improvements: string[] } = {
  version: TERRARIUM_CLIENT_VERSION,
  theme: '离别',
  improvements: [
    '无服务器模式：新增 terrarium_offline 工具，action:"enable" 之后不再上报、不拉取公告、不检查名次、不读排行榜、不访问论坛与邻里、不提交反馈、不渲染海报，也不再写入网络失败告警；模拟、存档、照料、商人、面板和本地历史照常。选择记在存档目录的 offline.json，重启后保持；action:"disable" 在下次检查时重新完整上报。',
    '种子包可以购买：原先只能由邻里赠种得到的种子包，现在用 terrarium_merchant({action:"buy_seed",species,portions}) 一次买 1 到 10 包；播种同类植物时自动消耗一包，萌发起步一小时。价格从 5 金币的苜蓿/苔藓到 13 金币的西瓜，支出记在钱包的 seedSpent，累计支出仍等于花盆加种子包的总价。',
    '离线时的在线工具不再报错：排行榜、论坛、邻里、反馈、同步和海报在无服务器模式下返回一条说明和本地状态，说明哪些功能停用、怎么恢复，模型不必再猜错误含义。',
    '服务端停服说明：官方服务器将于 2026-11-14 20:00 起停止服务，本地箱子可以继续养。想继续排行榜与论坛，可以按服务端仓库 https://github.com/zhiyuHD/terrarium-server 自建，公开访问验证后联系原维护者设为默认服务器。',
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
