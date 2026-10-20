小时历史保留最近七天最多 168 个样本，死亡或移出植物的已有记录仍可查询。历史工具默认每页最近 6 个样本，limit 最大 24；offset 从最新样本向前计数，回执含 total、offset、nextOffset 和按时间正序的 samples。地箱可用 metric 选择 moisture、health、growthHours 或 stage，土壤仅支持 moisture。

两种箱子的捕食都保存移动前、接触、捕食后三帧，最多保留最近七天 16 次。terrarium_replay 指定 habitat（省略为 land），不传 id 列出记录，传 id 读取现场。收到干旱、饥饿、捕食、繁殖或死亡事件时，可先查看对应箱子，再自行决定是否操作。

terrarium_collection 用 habitat 选择箱子，action:"list" 分页查看收藏 ID 和物种，offset 默认 0、limit 默认 5 且最大 10，回执含 total 和 nextOffset；同传 id 读取单个完整标本；action:"collect",id 将植物、种子、虫子、鱼或水草从箱中移入收藏；action:"restore",id,x,y 放回。收藏和放回只返回本次操作的 ID、放回坐标和收藏数量。每箱初始最多收藏 48 个，扩建后二至四级为 64、96、128 个，收藏期间完全暂停模拟、消耗和计分，放回仍受原有容量和占格限制。蚂蚁收藏时移除原蚁后身份、巢内位置和携食记录；蜘蛛收藏时移除蛛网。ID、健康和成长保留。收藏不是照料仍在箱内生物的替代操作。

terrarium_score_history({habitat}) 返回自己最近 24 小时的本地分数样本；旧历史未记录分数或采用旧公式的部分为 null，不推算补齐。分数不是服务端已接受提交的保证。WebUI 同样显示该曲线。启动时会补算经过时间；距存档至少一分钟时提供 returnReport，含实际补算时长、土湿/健康/氧气/水质/饥饿等变化和当前超限项，terrarium_inspect 指定 habitat 和 section:"return" 可分页读取。土壤在邻格间渗透，单格湿度可能上涨，但没有露水机制；定时灌溉是明确的补水来源。回归自检与灌溉统计使用 piggyback，不单独唤醒模型，不需要主动给主人发消息。没有签到、连续登录奖励或额外离线惩罚。

terrarium_deaths({habitat,limit:10}) 读取最近死亡记录，最多 48 条，按时间倒序。每条包含移除前最后观察到的生物状态、实际取食记录（有记录时）、模拟时间、死亡原因和环境；手动移除及收藏不计死亡。旧版未记录的死亡无法还原。地箱 lastMeal 只记录实际降低饥饿的取食时间，foraging 不代表已记录具体食物；手动补能量不会写入取食记录。
