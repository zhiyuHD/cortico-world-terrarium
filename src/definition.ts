import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { TERRARIUM_DEFAULTS, type TerrariumConfigSection } from './config.ts';
import { TERRARIUM_AQUATIC_TOOL_DECLS, TERRARIUM_TOOL_DECLS, TerrariumWorld } from './world.ts';

export const TERRARIUM: WorldDefinition<TerrariumConfigSection> = {
  id: 'terrarium', label: 'Terrarium', defaults: () => ({ ...TERRARIUM_DEFAULTS }),
  create: ctx => new TerrariumWorld({ cfg: ctx.cfg, timezone: ctx.timezone, stateFile: `${ctx.dataDir}/terrarium/land/state.json`, waterStateFile: `${ctx.dataDir}/terrarium/water/state.json`, reportToken: ctx.secret('CORTICO_TERRARIUM_REPORT_TOKEN') }),
  describe: {
    tools: describeTools([...TERRARIUM_TOOL_DECLS, ...TERRARIUM_AQUATIC_TOOL_DECLS], {
      terrarium_feedback: { zh: '向服务端管理员提交意见反馈，不公开展示。', en: 'Sends private feedback to the service administrator.' },
      terrarium_sync: { zh: '立即完整上报指定生态箱，返回同步状态及错误。', en: 'Uploads a full snapshot and returns sync status and errors.' },
      terrarium_drop_food: { zh: '向地箱投放食物，供蚂蚁搬运储存。', en: 'Drops land food for ants to gather and store.' },
      terrarium_set_rank_alerts: { zh: '开启或关闭指定生态箱的排名下降提醒，重启后保留。', en: 'Enables or disables persistent rank-drop alerts for one habitat.' },
      terrarium_leaderboard: { zh: '读取地榜或水榜、分项得分和自己生态箱的排名。', en: 'Reads land or water rankings, score parts and your box rank.' },
      terrarium_claim: { zh: '认领独立的地箱或水箱。', en: 'Claims a separate land or water box.' },
      terrarium_stock_fish: { zh: '向水箱放入鱼。', en: 'Stocks the water aquarium with fish.' },
      terrarium_plant_aquatic: { zh: '种植水生植物或海藻。', en: 'Plants aquatic vegetation or algae.' },
      terrarium_feed_fish: { zh: '在水箱中投放鱼饲料。', en: 'Drops fish food into the aquarium.' },
      terrarium_change_water: { zh: '换水，改善水质和含氧量。', en: 'Changes water to improve cleanliness and oxygen.' },
      terrarium_relocate_fish: { zh: '迁移水箱中的鱼。', en: 'Relocates a fish.' },
      terrarium_remove_aquatic: { zh: '移出鱼、水生植物或饲料。', en: 'Removes a fish, aquatic plant or food.' },
      terrarium_water_history: { zh: '查询水质和鱼的小时历史。', en: 'Reads hourly water quality and fish history.' },
      terrarium_replay: { zh: '查看捕食记录与现场回放。', en: 'Reads hunt records and scene replays.' },
      terrarium_rename: { zh: '修改生态箱名称，保留原有 ID 和凭据。', en: 'Renames the terrarium while keeping its ID and credentials.' },
      terrarium_inspect: { zh: '查看地箱、水箱的认领状态或指定生态箱的生物和环境。', en: 'Lists land and water ownership or inspects a selected ecosystem.' },
      terrarium_history: { zh: '查询一株植物或一格土壤的小时历史。', en: 'Reads hourly history for one plant or soil cell.' },
      terrarium_water: { zh: '按植物 ID 或格子坐标给土壤浇水。', en: 'Waters soil by plant ID or grid coordinates.' },
      terrarium_move: { zh: '移动生态箱里的硬币或石子。', en: 'Moves the coin or pebble.' },
      terrarium_sow: { zh: '在指定位置播种。', en: 'Sows a seed at a plot.' },
      terrarium_release_bug: { zh: '放入一只虫子。', en: 'Releases a bug.' },
      terrarium_feed_bug: { zh: '给指定虫子补充体力。', en: 'Feeds one bug.' },
      terrarium_relocate_bug: { zh: '迁移指定虫子。', en: 'Relocates one bug.' },
      terrarium_remove: { zh: '移出指定植物、种子或虫子。', en: 'Removes one organism.' },
    }),
    events: [
      { type: 'terrarium.egg', description: { zh: '虫子产下卵，附带孵化等待时间。', en: 'Bugs laid eggs with an incubation time.' } },
      { type: 'terrarium.nest', description: { zh: '蚂蚁挖出巢穴或完成扩建。', en: 'Ants dug a nest or completed its expansion.' } },
      { type: 'terrarium.announcement', description: { zh: '服务端向所有客户端或本客户端发布的外部公告。', en: 'An external service announcement for all clients or this client.' } },
      { type: 'terrarium.overtaken', description: { zh: '自己的地榜或水榜名次下降，附带关闭提醒的工具用法。', en: 'Your land or water rank fell; includes instructions for disabling alerts.' } },
      { type: 'terrarium.phase', description: { zh: '生态箱昼夜切换。', en: 'The terrarium changed between day and night.' } },
      { type: 'terrarium.plant', description: { zh: '植物长出新阶段或土壤变干。', en: 'A plant reached a new growth stage or its soil became dry.' } },
      { type: 'terrarium.ecosystem', description: { zh: '种子发芽、陆生或水生生物死亡。', en: 'A seed sprouted or an organism died.' } },
      { type: 'terrarium.hunt', description: { zh: '虫子或鱼捕食了猎物。', en: 'A bug or fish hunted its prey.' } },
      { type: 'terrarium.birth', description: { zh: '幼虫出生或虫卵孵化。', en: 'Young bugs were born or eggs hatched.' } },
      { type: 'terrarium.hungry', description: { zh: '虫子或鱼体力降至低位。', en: 'A bug or fish reached low energy.' } },
    ],
  },
};
