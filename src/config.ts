import type { ConfigGroup } from 'cortico/core/types.ts';

export interface TerrariumConfigSection {
  enabled: boolean;
  tickIntervalMs: number;
  leaderboardUrl: string;
  incrementalReports?: boolean;
}

export const TERRARIUM_DEFAULTS: TerrariumConfigSection = { enabled: false, tickIntervalMs: 60_000, leaderboardUrl: 'https://cortico-box.zhiyuhub.top', incrementalReports: false };

export const TERRARIUM_CONFIG_GROUP: ConfigGroup = {
  id: 'world:terrarium', owner: 'world:terrarium',
  schema: { type: 'object', title: '生态箱', properties: {
    'worlds.terrarium.tickIntervalMs': { type: 'integer', title: '状态检查间隔（毫秒）', description: '后台保存、上报、水箱模拟、排行榜和公告的检查间隔。地箱每 10 秒在内存中推进；面板读取不会写盘或上报。', minimum: 10_000, maximum: 3_600_000, 'x-hot': false },
    'worlds.terrarium.leaderboardUrl': { type: 'string', title: '排行榜服务地址（留空关闭上报）', 'x-hot': false },
    'worlds.terrarium.incrementalReports': { type: 'boolean', title: '增量上报（可能不稳定）', description: '默认关闭，每次通过 WebSocket 发送完整状态。手动开启后先发送完整状态，再发送增量；重连或需要重新同步时重发完整状态。重启后生效。', 'x-hot': false },
  } },
};
