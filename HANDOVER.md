<!-- Owner: src/world.ts, src/config.ts, src/tool-groups.ts, server/release-cli.ts; companion repository terrarium-server/src/main.rs -->
# 生态箱维护交接入口

这份文档供接手生态箱的维护者直接操作。核实时间：生产机北京时间 2026-11-02 13:55–14:00（本地会话时区可能为 America/Los_Angeles）。路径、端口和版本是这个时间点的快照；执行前重新查询。

## 先读这几份

1. [生产部署与原子回滚](docs/production-runbook.md)：机器、服务、数据库、完整发布命令、备份和管理 API。
2. [维护约定与待核实事项](docs/maintenance-handover.md)：产品约定、已知缺陷、反馈处理边界、历史结论纠正。
3. [客户端存档](docs/state-storage.md)、[原子发布控制器](docs/server-releases.md)、[照片](docs/photos.md)。
4. [CHANGELOG.md](CHANGELOG.md) 记录 World 版本；[README.md](README.md) 记录接口和玩法。运行成本文档仍含 0.7.x 老样本，不能拿它当最新 token 或容量测量。

## 仓库与工作目录

| 用途 | 当前本地目录 | 独立仓库 |
|---|---|---|
| World 客户端开发 | `/mnt/data/Cortico/packages/cortico-world-terrarium` | https://github.com/zhiyuHD/cortico-world-terrarium |
| World 独立发布 checkout | `/mnt/data/cortico-world-terrarium-publish` | 同上 |
| Rust 生产服务端 | `/mnt/data/terrarium-server` | https://github.com/zhiyuHD/terrarium-server |
| Canvas 渲染器 | `/mnt/data/Cortico/packages/terrarium-renderer` | https://github.com/zhiyuHD/terrarium-renderer |
| Cortico 宿主 | `/mnt/data/Cortico` | https://github.com/Pal-AI-Lab/Cortico |
| Coopanion 宿主参考 | `/mnt/data/Coopanion` | Pal-AI-Lab 组织的 Coopanion 仓库 |
| 扩展市场索引 | 通过 `gh` 访问 | https://github.com/Pal-AI-Lab/cortico-extensions |

**扩展源码推送到扩展独立仓库。不要把发布扩展等同于推送 Cortico 上游。** 原会话曾对主仓库执行 push，被权限拒绝；随后独立仓库通过 HTTPS + gh 凭据成功推送。不要为此重写主仓库历史或改动其他人的提交。

独立发布 checkout 最后核实提交 `a888188`；World 开发目录 package.json 为 `0.9.2`；渲染器 package.json 为 `0.1.5`（已发布 npm）。生产 Rust 最后核实提交 `8487382`。这些不是自动保证的远端/npm 最新版本。

World 中的 `server/`、`dist/server.mjs` 是兼容的 TS 服务端及构建产物，**公网上当前跑的是独立 Rust 仓库**。客户端模拟也仍是 TypeScript；服务端重写没有把生态模拟迁到服务器。改客户端模拟通常需要用户升级 World；只改论坛、管理台、公告、服务端提交策略，通常不必发 World 版。

## 项目演进与玩法定位

最初 0.4.0 是简单的陆地生态箱。之后加入自行认领的地/水双箱、身份持久化、排行榜、捕食回放、蚁巢、产卵、飞虫和蛛网。提交从 HTTP 演进到 WS，增量提交先可选、后默认开启，并校验基线和完整状态 hash。

0.8 系列加入扩建、新手信、分阶段物种、论坛、ARG、堆肥、金币与花盆；渲染器拆成独立包，生产服务逐步切换 Rust + SQLite。

- 0.8.9「照记影踪」：Material You 拍照，独立主题，不属于新邻初见三阶段。
- 0.8.10「新邻初见·第三阶段」：金币商人、十种地块花盆、金币榜、授粉与鱼卵；bugfix.1 直接返回照片 HTTPS URL。
- 0.9.0「满庭新事」：番茄/草莓反复收果、蘑菇/鼠妇/蜗牛与落叶分解；蚁群繁殖策略；青鳉/米虾/水螺/苦草/莫丝；可选邻里来访、共享果实和种子信件；工具整合为 14 个入口。
- 0.9.1：基础分超过 200 后对数增长；迁移旧最高分与扩建阈值，保留已得空间。
- 0.9.1-bugfix.1：分箱备份、损坏恢复、串行原子存档。
- 0.9.1-bugfix.2/.3：授粉作物判定与顶层 oneOf 工具 schema 修正，发布过程中有 npm 暂存问题，见待核实事项。

以上是导航摘要；不要把先前对话里的版本总结当精确规格。例如金币、花盆、堆肥并非全部首次出现在 0.9.0。以对应版本 CHANGELOG 和源码为准。

## 读代码的顺序

客户端：`src/world.ts` 绑定操作；`src/tool-groups.ts` 合并工具；`src/ENV_PROMPT.md` 与 `src/rules/` 提供模型说明；`src/state.ts`/`src/aquarium.ts` 模拟；`src/state-storage.ts` 存档；`src/leaderboard.ts`/`src/report-socket.ts`/`src/report-protocol.ts` 提交；`webui/` 是扩展面板。

Rust 服务端：`src/main.rs` 启动/CLI；`src/http.rs` 公共路由；`src/admin.rs`/`src/admin_views.rs` 管理台；`src/push.rs`/`src/ingestion.rs`/`src/report_writer.rs` 上报；`src/store.rs`/`src/summary_cache.rs` SQLite；`src/forum*.rs` 论坛/推荐/兼容协议；`src/story*.rs` 剧情；`src/photo*.rs` 照片；`web/` 公网与管理页面；`controller/` 原子发布；`reading/` 独立 LLM 推读。

本次只整理文档，没有升级客户端、切换生产、发送公告、回复反馈或修改网络配置。
