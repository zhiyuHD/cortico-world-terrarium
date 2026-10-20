import type { ConfigGroup } from 'cortico/core/types.ts';

export interface TerrariumConfigSection {
  enabled: boolean;
  tickIntervalMs: number;
  leaderboardUrl: string;
  incrementalReports?: boolean;
  rankAlertMinDrop?: number;
  rankAlertCooldownMinutes?: number;
  requestTimeoutMs?: number;
}

export const TERRARIUM_DEFAULTS: TerrariumConfigSection = { enabled: false, tickIntervalMs: 60_000, leaderboardUrl: 'https://cortico-box.zhiyuhub.top', incrementalReports: true, rankAlertMinDrop: 3, rankAlertCooldownMinutes: 120, requestTimeoutMs: 15_000 };

export const TERRARIUM_CONFIG_GROUP: ConfigGroup = {
  id: 'world:terrarium', owner: 'world:terrarium',
  schema: { type: 'object', title: '生态箱', properties: {
    'worlds.terrarium.tickIntervalMs': { type: 'integer', title: '状态检查间隔（毫秒）', description: '后台保存、上报、水箱模拟、排行榜和公告的检查间隔；榜单公告轮询与上报错开半个周期。地箱每 10 秒在内存中推进；面板读取不会写盘或上报。', minimum: 10_000, maximum: 3_600_000, 'x-hot': false },
    'worlds.terrarium.rankAlertMinDrop': { type: 'integer', title: '排名累计下降提醒阈值', description: '默认累计下降 3 名才提醒；同分 ID 排序不计入下降。', minimum: 1, maximum: 1000, 'x-hot': false },
    'worlds.terrarium.rankAlertCooldownMinutes': { type: 'integer', title: '排名提醒最短间隔（分钟）', description: '默认 120 分钟；间隔内继续累计下降，之后合并提醒。', minimum: 0, maximum: 1440, 'x-hot': false },
    'worlds.terrarium.requestTimeoutMs': { type: 'integer', title: '网络请求超时（毫秒）', description: 'HTTP、WS 握手和提交确认的等待上限，默认 15000。', minimum: 1000, maximum: 120000, 'x-hot': false },
    'worlds.terrarium.leaderboardUrl': { type: 'string', title: '排行榜服务地址（留空关闭上报）', 'x-hot': false },
    'worlds.terrarium.incrementalReports': { type: 'boolean', title: '增量上报', description: '默认开启。首次发送完整状态，后续提交已确认状态的增量；校验失败或重连时重新发送完整状态。关闭后每次提交完整状态。重启后生效。', 'x-hot': false },
  } },
};
