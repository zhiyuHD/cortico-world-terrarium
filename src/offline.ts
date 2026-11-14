import type { ToolDef } from 'cortico/core/types.ts';
import { readFile, rename, writeFile } from 'node:fs/promises';

/** Local-only play. Reports, announcements, rankings, forum, neighbors, feedback and photos need the service; simulation does not. */
export interface OfflineSettings { enabled: boolean; sinceMs?: number }

export const TERRARIUM_ONLINE_FEATURES = ['report', 'announcements', 'rank_alerts', 'leaderboard', 'forum', 'neighbors', 'feedback', 'photo'] as const;
export type OnlineFeature = typeof TERRARIUM_ONLINE_FEATURES[number];

const FEATURE_TEXT: Record<OnlineFeature, string> = {
  report: '上报与排行榜同步',
  announcements: '服务端公告拉取',
  rank_alerts: '名次下降提醒',
  leaderboard: '排行榜读取',
  forum: '论坛读写',
  neighbors: '邻里来访与赠种',
  feedback: '反馈提交',
  photo: '海报渲染（需要服务端）',
};

/**
 * Stored beside the habitat so the choice survives restarts, unlike the report client's own state.
 * A corrupt file is moved aside and treated as online, the same default as a fresh install.
 */
export class OfflineStore {
  private value: OfflineSettings = { enabled: false };
  constructor(private readonly file: string) {}
  get enabled(): boolean { return this.value.enabled; }
  get settings(): OfflineSettings { return { ...this.value }; }
  async restore(): Promise<void> {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    try {
      const parsed = JSON.parse(raw) as Partial<OfflineSettings> | null;
      if (!parsed || typeof parsed.enabled !== 'boolean') throw new SyntaxError('Invalid offline settings');
      this.value = parsed.enabled ? { enabled: true, ...(Number.isFinite(parsed.sinceMs) ? { sinceMs: parsed.sinceMs } : {}) } : { enabled: false };
    } catch {
      await rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => {});
      this.value = { enabled: false };
    }
  }
  async set(enabled: boolean, nowMs: number): Promise<OfflineSettings> {
    this.value = enabled ? { enabled: true, sinceMs: nowMs } : { enabled: false };
    await writeFile(this.file, JSON.stringify(this.value, null, 2), { mode: 0o600 });
    return this.settings;
  }
}

export function offlineStatus(settings: OfflineSettings, nowMs: number) {
  return {
    offline: settings.enabled,
    since: settings.sinceMs === undefined ? undefined : new Date(settings.sinceMs).toISOString(),
    offlineHours: settings.enabled && settings.sinceMs !== undefined ? Math.round(Math.max(0, nowMs - settings.sinceMs) / 36_000) / 100 : 0,
    disabled: settings.enabled ? TERRARIUM_ONLINE_FEATURES.map(feature => ({ feature, text: FEATURE_TEXT[feature] })) : [],
    stillWorks: ['模拟与存档', '全部照料工具', 'WebUI 面板', '规则与历史', '商人买卖', '播种与收获', '收藏与回放'],
  };
}

/**
 * Online tools answer with this instead of throwing while offline, so a model that ignores the
 * mode gets a usable explanation rather than a transport error it might retry.
 */
export function offlineAnswer(feature: OnlineFeature, tool: string) {
  return { offline: true, tool, feature, message: `当前是无服务器模式：${FEATURE_TEXT[feature]}已停用，本地存档与模拟不受影响。可调用 terrarium_offline({"action":"status"}) 查看，或 action:"disable" 恢复在线功能。` };
}

export const TERRARIUM_OFFLINE_TOOL_DECL: Omit<ToolDef, 'handler'> = {
  name: 'terrarium_offline',
  description: 'Switch between online and local-only play, defaulting to whatever the last choice was. action status reports the mode, the features it turns off and what still works; enable stops reports, announcements, rank alerts, leaderboard reads, forum, neighbor visits, feedback and photo rendering, and stops logging network warnings; disable restores them on the next check. Simulation, saves, care tools, merchant trades, the WebUI and local history keep working in both modes. The choice persists across restarts. Use it when the configured service is gone or the owner asks to stop contacting it.',
  tags: ['read', 'write'],
  parameters: { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['status', 'enable', 'disable'] } } },
};
