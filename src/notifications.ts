import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolDef } from 'cortico/core/types.ts';

export const TERRARIUM_NOTIFICATION_CATEGORIES = ['growth', 'hunt', 'eggs', 'birth', 'nest', 'web', 'death', 'irrigation', 'phase', 'return', 'ecosystem', 'care_dry', 'care_wet', 'care_health', 'care_energy', 'care_hunger', 'care_oxygen', 'care_cleanliness'] as const;
export type NotificationCategory = typeof TERRARIUM_NOTIFICATION_CATEGORIES[number];
type Habitat = 'land' | 'water';
type Preferences = Record<Habitat, Partial<Record<NotificationCategory, boolean>>>;
export const TERRARIUM_NOTIFICATION_WARNING = '关闭通知后模拟、饥饿、缺水和死亡照常发生。你必须自行检查并照料；因漏看通知导致植物枯死或动物死亡，后果由你自行承担。重新开启不补发关闭期间的事件。';
export const TERRARIUM_NOTIFICATION_TOOL_DECL: Omit<ToolDef, 'handler'> = {
  name: 'terrarium_notifications', tags: ['write'],
  description: 'Read or change persistent notification switches separately for land and water, including unclaimed habitats. Omit enabled and categories to read. To change, supply enabled and a non-empty categories array; all selects every listed category. Growth includes sprouting, stages, flowering, pollination summaries and seed production. Fish eggs and hatch summaries use eggs and birth. Care categories filter onset, worsening and recovery of each condition. Changes never pause simulation, claim boxes, disable sync or remove tools. Re-enabling does not replay muted events; current care problems are checked again on the next simulation check. Rank alerts retain their separate terrarium_set_rank_alerts tool. Server announcements, protocol replies and release notices remain delivered. WARNING: if you mute warnings, inspect and care for the habitat yourself; you bear the consequences of plants or animals dying after missed notifications.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    habitat: { type: 'string', enum: ['land', 'water', 'both'], default: 'land' },
    categories: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['all', ...TERRARIUM_NOTIFICATION_CATEGORIES] } },
    enabled: { type: 'boolean' },
  }, anyOf: [{ required: ['enabled', 'categories'] }, { not: { anyOf: [{ required: ['enabled'] }, { required: ['categories'] }] } }] },
};

export function notificationForChange(kind: string): NotificationCategory {
  if (['stage', 'sprout'].includes(kind)) return 'growth';
  if (kind === 'egg') return 'eggs';
  return TERRARIUM_NOTIFICATION_CATEGORIES.includes(kind as NotificationCategory) ? kind as NotificationCategory : 'ecosystem';
}

/** Local preferences are independent of uploaded habitat state and default to enabled. */
export class NotificationPreferences {
  private preferences: Preferences = { land: {}, water: {} };
  constructor(private readonly file: string) {}
  enabled(habitat: Habitat, category: NotificationCategory): boolean { return this.preferences[habitat][category] ?? true; }
  status(habitat: Habitat): Record<NotificationCategory, boolean> {
    return Object.fromEntries(TERRARIUM_NOTIFICATION_CATEGORIES.map(category => [category, this.enabled(habitat, category)])) as Record<NotificationCategory, boolean>;
  }
  async restore(): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.preferences = { land: {}, water: {} }; return; } throw error; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['land', 'water'].includes(key))) throw new Error('Invalid notification preferences file');
    for (const habitat of ['land', 'water'] as const) {
      const prefs = (value as Preferences)[habitat];
      if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs) || Object.entries(prefs).some(([category, enabled]) => !TERRARIUM_NOTIFICATION_CATEGORIES.includes(category as NotificationCategory) || typeof enabled !== 'boolean')) throw new Error('Invalid notification preferences file');
    }
    this.preferences = value as Preferences;
  }
  async set(habitats: Habitat[], categories: NotificationCategory[], enabled: boolean): Promise<void> {
    const next = structuredClone(this.preferences);
    for (const habitat of habitats) for (const category of categories) next[habitat][category] = enabled;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
    this.preferences = next;
  }
}
