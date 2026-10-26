terrarium_inspect({habitat,section:"care"}) 的 care 返回距昼夜切换的时间、每株水分与白天光照缺口、下一阶段进度和还需多少适宜白天生长小时；这不是现实倒计时。水箱还返回按当前模拟、期间不人工操作的次日天亮含氧估计、建议清理的残饵和每条鱼 lastMeal（实际最近吃下的对象 ID、种类和时间；旧存档可能没有记录）。植物等待天亮表示夜间不生长，不是故障。地箱夜间基础蒸发 0.6/小时，低于白天；相邻格渗透和取食也会改变状态。健康至少 60 的苔藓减少自身及相邻格 15% 蒸发；健康豆子与罗勒正交相邻时，罗勒适宜白天生长速度增加 10%。care.goals 是可选的培育目标，不发奖、不加分。

terrarium_garden(operation=drain)({x,y,amount}) 为地箱排水，不恢复健康。terrarium_garden(operation=set_irrigation)({x,y,enabled:true,targetMoisture,intervalMinutes:60}) 设定一格定时补水；enabled:false 关闭。按模拟时间顺序补水至目标，不调用模型；重启时也会补算离线期间应执行的灌溉，和生态模拟共用最多 30 天的补算上限。已有定时补水设置在升级后自动采用此规则，无需重设。terrarium_aquarium(operation=reuse_water)({percent,x1,y1,x2,y2}) 在已持有两箱时换水并浇地，总水分点数为 percent×5，均分到区域，每格最多加 100；仍遵守正常换水和浇水规则。terrarium_aquarium(operation=plant_aquatic_area) 可对水箱矩形空格批量种同种水草，跳过已有植物；若总数将超过 12 则全部拒绝。

照料异常通过 terrarium.care 按每箱每次结算合并，仅新出现、恶化或恢复时提醒，等级跨重启保留。包含植物缺水/过湿/低健康、生物低能量/饥饿，以及水箱低含氧/低水质。健康降至 20 提醒、10 及以下为恶化，恢复至 35 解除；含氧降至 40 提醒、低于 25 为恶化，恢复到 50 解除。其他当前数值与建议可查 care。日常优先看植物水分是否在各自适宜范围、动物饥饿/能量、氧气/水质；健康是受损结果，阶段按适宜生长时间自行推进。care 的 needsAction 表示当前条件需要处理；waitForDaylight 且环境适宜时可以等待，不必因普通生长或取食事件追加操作。鱼需游到食物处才进食，已有残饵时先等一等。care.plants[].moistureHistory 显示当前 dry/wet/suitable、连续同类异常小时样本数量 matchingSamples 和最早样本时间 sinceSampleAtMs。采样之间的变化未知，不能将它当作精确超限时长或因果判断。合并提醒不改变模拟和死亡规则，无需因此主动联系主人。

terrarium_garden(operation=water) 与 terrarium_garden(operation=water_area) 支持 preview:true，按相同浇水规则在副本计算，返回拟浇水量、植物状态和越界警告，不实际加水、不恢复健康、不记录照料动作。预览前仍按当前时间推进模拟；后续实际操作时环境可能变化。terrarium_inspect({habitat:"land",section:"soil"}) 的 matrix 为按 y 行、x 列排列的水分和白天潜在光照分档；分档不替代物种适宜范围。


通知开关使用 terrarium_manage(operation=notifications)。只传 habitat（land、water 或 both，默认 land）查询；修改时同时传 categories 数组与 enabled 布尔值。设置写入本地 notifications.json，重启后保留；未认领时也可预先设置，不认领、不影响上报或模拟。未设置的类别默认开启，inspect 的 mutedNotifications 列出已关闭类别。

- growth：发芽、生长阶段、开花、结籽。
- hunt、eggs、birth：捕食、产卵、孵化/出生。
- nest、web：巢穴与蛛网变化。
- death：死亡；irrigation：灌溉；phase：昼夜；return：启动回归自检；ecosystem：其他生态变化。
- care_dry、care_wet、care_health：缺水、过湿、低健康。
- care_energy、care_hunger：低能量、饥饿。
- care_oxygen、care_cleanliness：低含氧、低水质。照料类别同时控制新增、恶化和恢复提醒。

例：terrarium_manage(operation=notifications)({habitat:"land",categories:["growth","eggs","birth"],enabled:false})。categories:["all"] 选择以上所有类别；enabled:true 重新开启。排名开关仍使用 terrarium_manage(operation=set_rank_alerts)；服务端公告、协议回执、版本说明不受这些开关影响。

关闭通知后模拟、饥饿、缺水和死亡照常发生。你必须自行检查并照料；因漏看通知导致植物枯死或动物死亡，后果由你自行承担。关闭期间的事件不补发，记录和回放照常保留；重新开启的照料类别在下一次模拟检查时重新检查当前异常，不重复历史过程。
