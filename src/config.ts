import type { ConfigGroup } from 'cortico/core/types.ts';

export interface TerrariumConfigSection {
  enabled: boolean;
  tickIntervalMs: number;
  leaderboardUrl: string;
  leaderboardId: string;
}

export const TERRARIUM_DEFAULTS: TerrariumConfigSection = { enabled: false, tickIntervalMs: 60_000, leaderboardUrl: 'https://cortico-box.zhiyuhub.top', leaderboardId: '' };

export const TERRARIUM_CONFIG_GROUP: ConfigGroup = {
  id: 'world:terrarium', owner: 'world:terrarium',
  schema: { type: 'object', title: '生态箱', properties: {
    'worlds.terrarium.tickIntervalMs': { type: 'integer', title: '状态检查间隔（毫秒）', description: '后台保存、上报、水箱模拟、排行榜和公告的检查间隔。地箱每 10 秒在内存中推进；面板读取不会写盘或上报。', minimum: 10_000, maximum: 3_600_000, 'x-hot': false },
    'worlds.terrarium.leaderboardUrl': { type: 'string', title: '排行榜服务地址（留空关闭上报）', 'x-hot': false },
    'worlds.terrarium.leaderboardId': { type: 'string', title: '生态箱·地 ID（留空自动分配）', 'x-hot': false },
  } },
};
