import type { ToolDef } from 'cortico/core/types.ts';

/** Operations keep their individual schemas while sharing a smaller set of model tools. */
export const TERRARIUM_TOOL_GROUPS: Record<string, string[]> = {
  terrarium_inspect: ['inspect'],
  terrarium_rules: ['rules'],
  terrarium_manage: ['claim', 'rename', 'progress', 'sync', 'notifications', 'set_rank_alerts'],
  terrarium_garden: ['water', 'water_area', 'sow', 'sow_area', 'move', 'drain', 'set_irrigation', 'compost', 'transplant', 'harvest', 'decorate', 'garden_status'],
  terrarium_residents: ['release_bug', 'feed_bug', 'relocate_bug', 'remove', 'drop_food', 'cleanup_food', 'set_ant_foraging', 'feed_nest', 'fill_ant_hole', 'ant_policy'],
  terrarium_aquarium: ['stock_fish', 'plant_aquatic', 'plant_aquatic_area', 'feed_fish', 'change_water', 'relocate_fish', 'remove_aquatic', 'reuse_water'],
  terrarium_collection: ['collection'],
  terrarium_merchant: ['merchant'],
  terrarium_records: ['history', 'water_history', 'score_history', 'deaths', 'replay'],
  terrarium_leaderboard: ['leaderboard'],
  terrarium_forum: ['forum_read', 'forum_post', 'forum_like', 'forum_follow'],
  terrarium_feedback: ['feedback'],
  terrarium_take_photo: ['take_photo'],
  terrarium_neighbors: ['neighbors'],
};
const descriptions: Record<string, string> = {
  terrarium_inspect: 'Read compact box state; select a section for detail. Never claims a box.',
  terrarium_rules: 'Read detailed rules by topic before unfamiliar operations.',
  terrarium_manage: 'Claim, rename, expand or sync a box; configure notifications and ranking alerts. Muted care risks are your responsibility.',
  terrarium_garden: 'Care for land plants, transplant, harvest fruit or decorate plots. Coordinates are zero-based. Read land/care rules for conditions.',
  terrarium_residents: 'Manage land insects, food and nests; control ant breeding and plant protection. Feeding energy alone does not cure hunger.',
  terrarium_aquarium: 'Manage water residents, plants, feeding and water quality. Read water rules for species and behavior.',
  terrarium_collection: 'Store, list or restore frozen specimens; stored residents do not grow or score.',
  terrarium_merchant: 'Sell cultivated plants or harvested fruit; buy and place pots. Pot effects apply only to plants on their plot.',
  terrarium_records: 'Read paged history, scores, deaths or recorded hunt replays.',
  terrarium_leaderboard: 'Read ecology rankings or the separate land coin ranking.',
  terrarium_forum: 'Read/search forum threads or profiles; post, reply, like and follow as your box.',
  terrarium_feedback: 'Submit feedback about the ecosystem.',
  terrarium_take_photo: 'Photograph your box as a captioned poster. Returns an image and, when supported, a 24-hour HTTPS URL. Does not send messages.',
  terrarium_neighbors: 'Opt into neighbor visits, share ripe crops, leave notes and exchange seed packets. Both parties must opt in.',
};
function concise(value: unknown): any {
  if (Array.isArray(value)) return value.map(concise);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description' && key !== 'default').map(([key, v]) => [key, concise(v)]));
}
export function groupTools(tools: ReadonlyArray<Omit<ToolDef, 'handler'>>): Array<Omit<ToolDef, 'handler'>> {
  return Object.entries(TERRARIUM_TOOL_GROUPS).flatMap(([name, operations]) => {
    const entries = operations.map(operation => tools.find(t => t.name === `terrarium_${operation}`)).filter((t): t is Omit<ToolDef, 'handler'> => !!t);
    if (!entries.length) return [];
    if (entries.length === 1 && entries[0].name === name) return [{ ...entries[0], description: descriptions[name], parameters: concise(entries[0].parameters) }];
    const properties = Object.fromEntries(entries.flatMap(t => Object.entries(concise(t.parameters).properties ?? {})));
    return [{ name, description: descriptions[name], tags: [...new Set(entries.flatMap(t => t.tags ?? []))], parameters: {
      type: 'object', additionalProperties: false, properties: { operation: { type: 'string', enum: operations }, ...properties }, required: ['operation'],
    } }];
  });
}
export function bindToolGroups(tools: ToolDef[]): ToolDef[] {
  return groupTools(tools).map(decl => ({ ...decl, handler: async (args, context) => {
    const operations = TERRARIUM_TOOL_GROUPS[decl.name];
    const operation = operations.length === 1 && `terrarium_${operations[0]}` === decl.name ? operations[0] : args.operation;
    if (typeof operation !== 'string' || !operations.includes(operation)) throw new Error('Unknown operation; use the tool schema');
    const tool = tools.find(t => t.name === `terrarium_${operation}`);
    if (!tool) throw new Error('Unavailable operation');
    const { operation: _, ...input } = args;
    const result = await tool.handler(input, context);
    return result;
  } }));
}
export function toolReference(name: string): string {
  const operation = name.slice(10), entry = Object.entries(TERRARIUM_TOOL_GROUPS).find(([, operations]) => operations.includes(operation));
  return entry ? entry[0] === name ? name : `${entry[0]}(operation=${operation})` : name;
}
