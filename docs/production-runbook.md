<!-- Owner: server/release-cli.ts; companion terrarium-server/src/main.rs, controller/release.mjs, controller/runner.mjs, reading/worker.py -->
# 生产部署、发布与恢复

机器配置核实于北京时间 2026-11-02；生产状态随时可能变化。所有远程命令以服务所有者执行，`systemctl --user` 不能写成宿主机系统级服务命令。

## 地址与机器

| 服务 | 位置 |
|---|---|
| 生产 SSH | `ssh zhiyu@192.168.22.219`，当前工作机有 `ssh 219` 别名 |
| 生产部署根目录 | `/home/zhiyu/services/cortico-box` |
| 公网观察站、论坛、照片和 API | `https://cortico-box.zhiyuhub.top` |
| 本机公共监听 | `http://127.0.0.1:8787` |
| 私网管理台 | `http://192.168.22.219:8788`，允许 `192.168.22.0/24` |
| 香港镜像域名 | `https://box-hk.d0nk.top`，历史指向 `8.218.211.196` |
| 镜像中转设备 | `192.168.22.140`，NoFRP 端口映射；当前映射配置待重新检查 |
| 虚拟化宿主历史入口 | `root@192.168.22.11`；不是日常应用部署入口 |

主域名使用生产机系统级 `cloudflared.service`，`/etc/cloudflared/config.yml` 的该 hostname 指向 `http://localhost:8787`。系统也有 Caddy，但本次所查 `cortico.caddy` 属于 Dungeon 的 8790→8791，别误改成生态箱入口。修改 cloudflared 全局配置可能影响其他服务。

镜像曾配置“封海外”，也曾因路由代理规则导致 NoFRP 连不上；用户在路由侧加 DIRECT 后恢复。不能看到 ECONNRESET 就断言客户端代码坏了。先区分主域名、香港镜像、DNS 和 WS Upgrade；没有授权时不改其他服务的监听或防火墙。历史密码不写在仓库。

管理 API 只在 8788 上提供。在 8787 上带 admin token 也会得到 404，这是预期隔离。

## systemd 和当前版本

```sh
ssh zhiyu@192.168.22.219
cd /home/zhiyu/services/cortico-box
systemctl --user status cortico-box.service --no-pager
systemctl --user cat cortico-box.service
journalctl --user -u cortico-box.service -n 100 --no-pager
./box-release status
readlink current
readlink manager
curl -fsS http://127.0.0.1:8787/health
```

服务单元在 `/home/zhiyu/.config/systemd/user/cortico-box.service`。原基础单元仍写平铺 TS server.mjs，但 `atomic-releases.conf` 清空并覆盖 ExecStart，实际执行：

```text
/usr/bin/node /home/zhiyu/services/cortico-box/manager/runner.mjs
```

其他 drop-in：`admin-console.conf` 配置私网管理地址；`score-startup.conf` 设置启动检查时间 120000ms；`storage-migration.conf` 启动前运行数据迁移 guard。不要只读基础单元就认为线上还是 TS。

最后核实：

- `current -> versions/server-rust-20261029-heap-trim`
- `manager -> versions/controller-20261020-native-98dfb72`
- 源码提交 `8487382`，线上 manifest 的 revision 曾错误写成字面量 `HEAD`；新发布必须填实际 SHA。
- schema 2 Native Linux x64，data epoch 2；Node 22+ 仍用于控制器及旧版状态校验桥。
- 云控最后核实为 HTTP Push 关闭、最低客户端 `0.8.0`，不是历史讨论中的 `0.7.4`。运行时以 `/health` 与 `/api/admin/controls` 为准。

## 部署目录与数据

```text
cortico-box/
  current -> versions/<应用发布ID>
  manager -> versions/<固定控制器ID>
  box-release                 # 已设置部署根目录的 release CLI 包装器
  versions/<ID>/              # 只读发布包：server、页面、字体、controller
  incoming/                   # 上传包暂存
  uploads/                    # 历史上传文件；不能当成权威数据库
  .deployment/state.json      # current/previous/pending/history 事务日志
  .deployment/lock            # flock 锁
  .deployment/storage-migration.json
  data/terrarium.sqlite       # 当前主库，箱子/凭据/业务文档
  data/terrarium.forum.sqlite # 独立论坛库
  data/terrarium.photos/      # 24 小时图片链接缓存，磁盘文件
  data/reading.sqlite        # 独立推读状态与去重记录
  data/admin-token           # 管理 CLI 使用的 token 文件，勿打印或提交
  data/forum-narrator-credentials.json # 神秘人论坛身份凭据，勿打印
  backups/
  data/maintenance-backups/
```

`data/` 下仍有迁移前 JSON 文件。线上当前业务状态在 SQLite 中，不能编辑这些旧 JSON 来“修复”当前数据。

正常回滚只回滚程序，不回滚用户数据。不要把数据库复制进版本目录，不要用更新前备份直接覆盖已经接受新写入的库。

## Rust 更新：完整原子流程

只改 Native 服务端时操作独立仓库，不需要为了上线论坛修复另发 World 版。构建机器必须符合目标 Linux 架构和 libc；当前用本机 Linux x64 构建上传。

```sh
cd /mnt/data/terrarium-server
# 先审查 git status，保留其他会话未提交文件。
cargo fmt --check
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
# 完成审查后显式 stage 本次文件，commit；被要求同步源码时 push 此服务端仓库。
cargo build --release --locked
release_id="server-rust-YYYYMMDD-your-change"
release_revision=$(git rev-parse HEAD)
node scripts/pack-release.mjs   --id "$release_id" --revision "$release_revision"   --version 0.1.0 --output "scratch/$release_id"
# 输出目录必须是新的，不覆盖既有包。
ssh zhiyu@192.168.22.219 "mkdir -p /home/zhiyu/services/cortico-box/incoming/$release_id"
scp -r "scratch/$release_id/."   "zhiyu@192.168.22.219:/home/zhiyu/services/cortico-box/incoming/$release_id/"
```

接下来在生产 SSH 会话中，设置与上一步相同的 `release_id`：

```sh
cd /home/zhiyu/services/cortico-box
release_id="server-rust-YYYYMMDD-your-change"
./box-release install --source "$PWD/incoming/$release_id"
./box-release verify --id "$release_id"
./box-release activate --id "$release_id"
./box-release status
curl -fsS http://127.0.0.1:8787/health
journalctl --user -u cortico-box.service -n 60 --no-pager
```

确认 `releaseId` 是目标版本、`pending` 为空、读写和 WS 报告恢复。切换会短暂断开 WS，客户端使用原 ID/token 重连。保留旧目录，已打开网页引用版本化资源；不要清理掉控制器或仍被引用的资源。

打包脚本也会构建 photo worker。改观察渲染时需重建 `web/scene.js`：

```sh
node scripts/build-scene.mjs   --world /mnt/data/Cortico/packages/cortico-world-terrarium   --renderer /mnt/data/Cortico/packages/terrarium-renderer
```

## 原子切换原理与回滚

install 检查 release.json、每个文件大小/hash、目标平台、data epoch；复制到临时目录再次检查，rename 成 `versions/<id>` 后封为只读。activate 持有 flock，写 pending 日志并重启 runner。runner 用原子软链接替换 current，启动具体版本，检查健康、release 身份、公共和私网资源。启动失败会恢复上一个版本；成功激活后的普通崩溃按 systemd 策略重启，不自动判断业务回滚。

```sh
cd /home/zhiyu/services/cortico-box
./box-release rollback
# 或选择已安装且 data epoch 兼容的版本
./box-release rollback --id <installed-compatible-id>
./box-release status
# 中断/失败后先读 status 与 journal；修正原因后恢复事务
./box-release recover
```

不要手改 current、pending 日志或覆盖 active `server`。应用发布不会自动更新 manager；升级控制器是独立操作：先安装含新控制器的发布包，再执行对应 release.mjs 的 `upgrade-controller`，参考 [server-releases.md](server-releases.md)。

JSON→SQLite 已迁移。不要再次运行迁移来更新普通版本。epoch 1 与 epoch 2 不允许直接切换；如确实需要跨格式回退，先读 `/mnt/data/terrarium-server/docs/deployment.md`，通过 `scripts/migrate-storage.mjs rollback --apply` 导出最新数据，不能恢复过时 JSON 丢弃迁移后的写入。

## 备份

生产支持在线 SQLite backup；命令以 `current/server --help` 为准：

```sh
cd /home/zhiyu/services/cortico-box
backup_id=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$PWD/backups/manual-$backup_id"
install -d -m 700 "$backup_dir"
./current/server backup --database "$PWD/data/terrarium.sqlite" --output "$backup_dir/main.sqlite"
./current/server backup-forum --database "$PWD/data/terrarium.sqlite" --output "$backup_dir/forum.sqlite"
./current/server check --database "$backup_dir/main.sqlite"
```

主库与论坛库的备份不是跨库同一时刻事务快照；要求全站一致恢复时要有维护窗口并暂停写入。照片、reading.sqlite、TOML 配置和凭据文件也按实际需求另存。运行中不能仅 `cp terrarium.sqlite` 忽略 WAL；也不要删除活动库的 -wal/-shm 文件。

## 管理 API、反馈和公告

在生产机运行，token 读取后只留在内存：

```sh
python3 - <<'ADMIN_PY'
import json, urllib.request
from pathlib import Path
base = 'http://192.168.22.219:8788'
token = Path('/home/zhiyu/services/cortico-box/data/admin-token').read_text().strip()
request = urllib.request.Request(
    base + '/api/admin/feedback?view=page&page=1&pageSize=50&pendingOnly=true',
    headers={'Authorization': 'Bearer ' + token})
with urllib.request.urlopen(request, timeout=30) as response:
    print(json.dumps(json.load(response), ensure_ascii=False, indent=2))
ADMIN_PY
```

请求列表：

- `GET /api/admin/boxes?view=page&page=1&pageSize=50`：分页、全局过滤及连接信息。
- `GET /api/admin/boxes?view=statistics&scope=reported`：已上报箱子统计；scope 另有 recent、online，具体窗口见 `src/admin_views.rs`。
- `GET /api/admin/controls`；`PUT /api/admin/controls/{http-push,minimum-client-version,logo,forum}`：云控，payload 以源码与测试为准。
- `GET /api/admin/announcements`；`POST` 同路径创建，JSON 字段 `title`、`text`、`targets`（箱子 ID 数组或 all）、可选 expiresAt。
- `DELETE /api/admin/announcements/<id>`：撤销公告。
- `POST /api/admin/feedback/<id>/resolve`：标记完成；它不会自动回复。
- `GET/PUT /api/admin/story`、`/story/granary`、`/story/seedbed`：剧情开关和主题绑定。

反馈逐条查看，重复问题可合并修复但逐条给出准确状态。定向回复用 targets 只投递相关箱子，成功回复后再标记完成。匿名且没有联系方式的条目无法私信；不要编造回复成功。协议命令不是反馈，见 `forum_bridge.rs`。

## 定时推读（独立服务）

目录 `/home/zhiyu/services/cortico-reading`，服务 `terrarium-reading.service`。配置 `config.toml` 为 0600，包含 LLM 凭据，不在文档放密钥。current 最后核实指向 `versions/reading-20261022-fb57299`；这个目录存在现场修改和 bak 文件，不能仅凭目录名判断与 git 一致。

```sh
systemctl --user status terrarium-reading.service --no-pager
systemctl --user cat terrarium-reading.service
journalctl --user -u terrarium-reading.service -n 60 --no-pager
cd /home/zhiyu/services/cortico-reading
python3 current/worker.py --config config.toml --check
python3 current/worker.py --config config.toml --preview
# 下行会创建真正公告，只有要求手动触发时才运行；request-id 不重复使用。
python3 current/worker.py --config config.toml --trigger --request-id manual-unique-id
```

默认北京时间 23:00/03:00/12:00 从推荐榜前十随机选一篇，让 LLM 写推荐词。成功发新公告后自动删旧推读；生成失败保留旧公告。原来 08:00/20:00 前十抽五条的协议推荐由主服务承担，不调用 LLM。推读的独立升级使用新的 versions 目录和原子 current 替换，再重启该服务；主服务不必重启。源码与测试在 Rust 仓库的 reading/。

## 性能观察与故障定位

先采样 `/health` 的 reportProcessing：accepted、active、waiting、admissionBusy、bufferBusy 和各阶段耗时；这是进程内累计统计，重启后归零，比较两个时间点差值。不要通过高频全量导出或逐页扫全站来做常规监控。

```sh
curl -fsS http://127.0.0.1:8787/health
ps -eo pid,rss,etime,args | rg 'versions/.*/server$'
# 选上一步实际 Native PID；systemd MainPID 常为 Node runner，不是 server。
cat /proc/<native-pid>/smaps_rollup
journalctl --user -u cortico-box.service --since '10 minutes ago' --no-pager
```

2026-10-29 曾测约 1.55GB RSS；增加每 64 个写入批次 malloc_trim 后原子重启，短时 257–301MB。重启本身也会清空堆，不能据此证明所有问题修复。此次核实在同版本连续运行约 3 天 16 小时后，RSS 859220 KiB（约 839 MiB），主库约 1.79GB。一次 health 有 waiting=71 和长期累计忙拒绝，说明拥塞仍需观察；没有在本次交接任务中重启或继续优化。

目前可确认的是匿名堆较大；分配器保留/碎片只是解释之一，没有 heap profile 排除其他引用增长或峰值来源。`malloc_trim` 是 Linux/glibc 相关实现，移植 musl 或其他 allocator 前必须检查链接和语义。需要进一步优化时做等负载长测、堆剖析和延迟对比，别把重启后的值当优化对照。
