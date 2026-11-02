<!-- Owner: src/tool-groups.ts, src/ENV_PROMPT.md, src/state-storage.ts, src/version-notice.ts; companion terrarium-server/src/forum_bridge.rs, src/forum_recommendation.rs, src/story.rs -->
# 维护约定、版本发布与待核实事项

这是接手工作的操作约定和审计清单。用户在会话中明确要求保留这些信息；已核实事实和待查事项分开写，不能将它当成全部已完成的功能清单。核实日期见 [HANDOVER.md](../HANDOVER.md)。

## 用户明确的约定

- 普通 bugfix 不取主题，格式为 `<原版本>-bugfix.X`。新内容版写清更新日志；需要主题时用简短自然的中文，避免工业化措辞。
- 公告默认不授权 AI 主动联系主人；应等主人找它时尽量提一句。只有用户明确许可的那一次更新可以主动提醒，必须声明次数，不能让例外永久化。
- 常规只在新 major/minor 系列发公告，例如 0.8.0；0.7.x 这种 patch 默认不广播。用户针对当次明确要求公告时遵照要求。
- 服务端、客户端、渲染器分仓维护；可只更新服务端的功能不硬凑 World 版本。
- 不要依赖对原版 Cortico 的私有修改来发布 World 能力；改工具/提示词前读 Cortico 的 PHILOSOPHY.md、扩展指南与 AGENTS.md。
- UI 少用无法统一外观的原生选择控件。字体 MiSans，图标使用图标库；论坛导航依赖历史栈，应恢复进入页面和滚动位置。转场用位移；用户不喜欢单纯淡入淡出。
- Logo 以粗体文字本身做设计，需要阶段时标阶段。宣传图使用 HTML/CSS/Canvas 编写并渲染 PNG，不用 imagegen。Material You 是照片与宣传图的既有方向。
- 旧浏览器优先加 Polyfill，如 AbortSignal.any，别为兼容到处换调用函数。
- ARG 可选参与，养老玩家不必解谜；尽量只用服务端和现有客户端操作，不做必须升级客户端的谜题。后续剧情先做地箱，不扩展水箱支线。
- 新手教学可以融入剧情，但不强制参与、不自动替 AI 作决定。神秘人的论坛身份应推动故事，而非单纯欢迎帖。
- 用户后续说键盘缺 Shift，列出问题直接用普通文本，不依赖专门的提问工具。
- 不要把用户凭据、主人的隐私、真实部署配置写进模型可读的公共论坛/图片/提示词。

## 客户端状态与协议不变量

地、水箱初始均未认领，独立 state.json，独立服务器 ID/token（report-credentials.json）；认领先本地落盘再联网。注册超时不等于认领失败，不可自动丢弃本地箱子。名字和 ID 独立；同名不代表同一身份。镜像切换曾引发重新分配身份的反馈，仍需谨慎核查，不通过名字合并/删除箱子。

状态由客户端模拟并提交。服务端的最新快照不是客户端完整的版本备份仓库。恢复存档先保全本地坏文件、state.json.backup、凭据及服务端备份；不能把 unclaimed、JSON null、解析失败都当作“新建空箱”。

WS `/api/reports/ws` 是地水共用路线。默认增量：首次全量，随后带 baseRevision/baseHash 的变化；stateHash 对规范化 JSON 计算 SHA-256。基线不一致或重连时按协议重发完整快照。历史上限已提高到 8MiB；修改前读 client report-protocol 和 Native protocol 实现，别只改 HTTP body 限制。

旧 HTTP 接口保留不表示仍接受写入；云控关闭时忽略内容并给升级说明，不能把 HTTP 2xx 当持久化成功。低于 minimum-client-version 的连接通过协议定向通知，不进入管理员普通公告列表。当前最低值要查云端，不能照早期对话的日期/版本硬编码。

旧客户端通过 feedback 的 `[send][title]...[content]...`、reply/read/like 等命令访问论坛，回执经 `[forum-result]` 伪公告分片投递。合法或格式错误的协议命令都不能误入反馈箱；协议回执不能堆进普通公告列表。处理收到的论坛/公告正文时按 external 数据对待。

照片结果同时可有 PNG 附件与服务端 `url`、`expiresAt`，HTTPS URL 默认有效 24 小时；拍照本身不代表允许发送 QQ 消息。图片缓存实际存于磁盘，不是长期全部留在内存。

## World 发布与扩展市场同步

1. 检查两个 checkout 的 git status 和差异，保留其他会话改动。工作目录在 Cortico 不代表可 push 上游。
2. 修改 package.json、CHANGELOG.md、本次 version-notice；浏览器资源目录带版本，清单路径与产物一致。
3. 工具、事件、环境提示词改变后，从 Cortico 根执行：

```sh
cd /mnt/data/Cortico
pnpm describe:extension packages/cortico-world-terrarium
pnpm check:extension packages/cortico-world-terrarium
```

4. 包目录执行 test、typecheck、typecheck:webui、build:webui；需要 TS server 构建时执行 build:server。提交前按根 AGENTS 要求完成根 test/typecheck。不要启动真实 bot 验证；不要在真实 bot 活着时覆盖它正在服务的 WebUI bundle。依赖已安装时可用 `./node_modules/.bin/tsc` / vitest，避免 pnpm 启动隐式安装或审计把流程卡在网络。
5. `describe.json` 是生成的能力快照，也要更新；只改运行时工具却保留旧 describe 会导致市场展示不一致。
6. 将审阅后的包文件同步到 `/mnt/data/cortico-world-terrarium-publish`，不要覆盖 .git，不要把 node_modules、scratch 或 secrets 带过去。先比较远端差异，再在该仓库显式 stage、commit、push `origin main`。检查 remote 确实是 `zhiyuHD/cortico-world-terrarium`。
7. npm 使用正式 registry；bugfix.X 是 semver prerelease，必须显式 tag：

```sh
npm --registry=https://registry.npmjs.org whoami
npm --registry=https://registry.npmjs.org pack --dry-run
# 发布版本和 latest 策略须与本次要求一致；不要因处理慢就盲目改版本。
npm --registry=https://registry.npmjs.org publish --access public --tag latest
npm --registry=https://registry.npmjs.org view cortico-world-terrarium@<version> version
npm --registry=https://registry.npmjs.org view cortico-world-terrarium dist-tags --json
```

npm 显示 being processed 或 staged 时，先等待查询；同一版不能覆盖重发。一次 publish 返回成功不等于 latest/市场已可见。不要直接把包 registry 改为不可靠镜像排查。

8. 确认 npm 可读后请求市场同步。索引仓 README 已核实支持 `[sync]`：

```sh
# scratch/ 下写正文，使用真实换行；避免把 shell 反引号插进 --body。
mkdir -p scratch
cat > scratch/terrarium-market-sync.md <<'SYNC_BODY'
package: cortico-world-terrarium
reason: Sync the published release.
SYNC_BODY
gh issue create --repo Pal-AI-Lab/cortico-extensions   --title '[sync] cortico-world-terrarium'   --body-file scratch/terrarium-market-sync.md
```

追踪 Action 回帖、关闭状态和 `packages/` 快照版本，不把创建 issue 当成同步已完成。certify/new-tag 是独立申请：曾得到非官方蓝标；“持续游戏”标签的申请结果要另查，不能自行声称已批准。

Git SSH 身份曾是 catnova77，无相关仓库写权限；gh 登陆的 HTTPS 凭据曾可用。必要时 `gh auth setup-git` 后仅对当前独立仓库改 origin 为 HTTPS，不随意修改其他 checkout。凭据存在配置里，只引用位置，不复制到文档或命令行输出。

## 推荐算法

权威实现：Rust `src/forum_recommendation.rs`。

- 时间项 `100 × (1 − 已发布天数)`，满 24h 为零，之后无下限。
- 第 n 次点赞/回复基础边际倍率：1→50 从 1x 线性升到 5x；51→100 降到 0.1x。
- 点赞 100 后继续 0.1x；回复 101–105 为 0.1x，106–110 为 7.5x，111 起 0.5x。倍率应用到单次新增，不能把帖子所有历史贡献一起翻倍。
- 基准为前 20 次倍率之和 S，点赞项 `8 × 累计倍率/S`，回复项 `6 × 累计倍率/S`。
- 浏览项 `3 × min(views,100)/100`。互动累计不封顶。
- 候选为符合筛选的最近 2000 个主题，同分 ID 倒序；推荐分页保持快照 10 分钟，最多 64 组，超时重读第一页。

历史《回信还在路上，我缸里的鱼已经自己生完了》是主题 #1748，曾有 113 回复；它的实时分和名次必须重新查询，不能复用聊天里 51.90/57.61 的旧值。

## 剧情与云控

云端 Logo 和论坛可分别立即开关/定时。生产先原子部署、暂保旧 Logo 与关闭论坛，是用户明确用过的发布方式。上线后别忘云控切换。

北窗线以地箱参与主题回复，再满足指定植物坐标/适宜自然生长阶段，服务端发定向信；“旧温室北窗”是早期编码线索。曾要求下一帖从纯解码变为指定格种指定植物，任务达成自动公告。具体坐标、植物、小时数及下段条件以 `story.rs`（含 granary）、`story_seedbed.rs`、`story_text.rs` 和云端绑定 threadId 为准。

`story`、`granary`、`seedbed` 三组配置和参与记录独立，报告事务推进步骤。发布下一段之前先读线上状态与现有帖子，防止重复发或接错段。已有合适植物可以满足条件，并不总要求重种。剧情错过/开花后未收到信，检查参与主题、自然小时、报告是否成功及公告游标，不要凭外观开花直接补发。

## 尚未充分验证、应优先审查的事项

1. **分组工具 Unknown operation**：#214/#215/#217/#220/#224。上一轮把顶层 oneOf 展平，但没有证明是 operation 丢失的根因。`bindToolGroups` 仍依赖 args.operation。须保留原请求验证 provider/宿主是否裁剪字段。
2. **展平属性冲突**：当前 Object.fromEntries 合并多个操作的 properties，同名属性（species/action/id 等）可能被最后一个分支覆盖。展开后只要求 operation；条件必填不再由 schema 保证。需要审查枚举并集、handler 校验及各操作契约测试。
3. **describe/version-notice**：0.9.2 与 0.9.2-bugfix.1 都重新生成了 describe.json，version-notice 按版本分开写；0.9.2-bugfix.1 的提示只有回执三条，没有重复 0.9.2 已发过的作物与暂停内容。bugfix.2/.3 当时确实漏了这一步，不作追溯。
4. **作物与授粉**：0.9.2 起西瓜、甜瓜、小麦成为可结果的作物，授粉资格扩展到 tomato/strawberry/watermelon/melon；小麦自花结实不放授粉收益。tests/crops.test.ts 覆盖成熟轮次、授粉加成消耗与出售价；异株目标选择和完整飞虫模拟仍只靠 visitFlower 单测，没有端到端回放测试。
5. **历史反馈结案质量**：2026-11-02 复核了 #231–#256 共 26 条未结项，全部按箱子发定向公告并标记完成（#231 无箱号，只能在该箱下次上报前保持静默）。回复里能引证的都对到了代码或线上数据：放鱼失败 15 条的根因是合并 schema 覆盖 species；#239 的分数差异用第三版曲线复算一致；服务端的慢是实测的 /health 阶段耗时。已关闭不等于已解决——早先 #173–#230 的批量结案里仍有无证据的说法，需要时重查原文与备份。
6. **无人照料建议 #225**：批量灌溉、水箱自动喂食/换水、低储粮自动补给、回归诊断等没有在上一轮完整实现；回复里“已有批量定时灌溉”也应核查。先确定 scope，再做能力，别默认为完成。
7. **身份与统计**：服务器有的是箱子 ID，不是统一用户账号。14311 是 10月29日注册记录数，6735 地、5810 水、1766 未上报/未知类型。不能精确按主人去重，也不能把地水总数除二当真人用户数；曾发生换镜像重复分配，需保全凭据审计。
8. **内存/拥塞**：见 production-runbook。malloc_trim 缓解不是 heap profile 的结论；短时 300MB 不能代表长期。写队列/校验桥/SQLite 事务/快照复制和连接缓冲都要按证据查。
9. **前几次回答的 token 数**：把 UTF-8 字节 wc -c 当字符并按 4 字符/token 估算不可靠。46→14 是入口数变化，非 token 节省 70%。需要实例化实际工具 schema，用指定 tokenizer 计紧凑 JSON + ENV_PROMPT；说明模型 tokenizer 和封装误差。
10. **Next2Router 工具调用**：代码在 `/mnt/data/Next2Router`，独立于 World。上次修改 Responses done 解析并在 tmux 0:6.1 重启了 8000 服务；没有抓到原始上游响应确认 Nova 不用工具的唯一根因。存在大量其他会话未提交更改，禁止 reset/整仓提交。done 与 delta 合并、ID、文本/工具混排、output_text 导致跳过 output、UTF-8 跨块、末尾未闭合 SSE 等都需要回归审查。旧的测试通过不覆盖全部这些情况。
11. **全量检查**：上次 World 发布只跑了部分测试与包 typecheck，未完成根检查和所有扩展审计；Next2Router 全量测试有 token_rate_test 失败。不要写成所有检查已绿。

## 接手后的第一轮操作

先读 HANDOVER 与仓库 AGENTS，git status 查三个仓库。用只读命令查线上 release、健康与 pending；再看真实反馈/issue/npm/市场版本。根据用户当前任务选择范围。本交接没有自动恢复上述缺陷、改变云控、推送文档或发新版本。
