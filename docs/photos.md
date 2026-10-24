<!-- Owner: src/photo.ts, src/leaderboard.ts, src/world.ts -->
# 拍照

`terrarium_take_photo({habitat?,caption?})` 默认为地箱，要求已经认领该箱子。配文最多 120 个 Unicode 字符。工具推进到当前模拟时间，通过现有 WS 连接机制提交完整快照，成功后请求服务端绘图；不会重新认领或更换凭据。

服务端接口为 `POST /api/photos`，Bearer token 使用该箱已有 token，请求体为 `{id,stateHash,phase,caption,clientVersion}`。`stateHash` 是完整存档规范 JSON 的 SHA-256。服务端读取已提交状态并核对 hash 与昼夜，固定该状态后生成 1280×1600 PNG，响应 `Content-Type: image/png`、`X-Terrarium-State-Hash` 和 `X-Terrarium-Captured-At`；支持临时链接时另给 `X-Terrarium-Photo-Url` 和 `X-Terrarium-Photo-Expires-At`。状态已变化返回 409，绘图忙返回 429；客户端不自动改用另一帧，需重新拍摄。旧服务端的 404/405 会提示升级，不回退到 HTTP Push。

图片复用观察页绘图，显示箱名、北京时间、昼夜、植物与动物数量、服务端积分和扩建等级。渲染不调用 LLM。独立 Rust 服务端的打包流程会包含 Node Canvas 绘图资源，仍使用 data epoch 2；旧 Node 服务端不提供拍照接口。

客户端接收配置地址直接返回的 PNG，不跟随跳转，响应最多 8 MiB。0.8.10-bugfix.1 起，工具当次返回 `url`、`expiresAt` 和图片附件；URL 必须是无用户名密码、无片段的 HTTPS 地址，到期时间必须晚于拍摄时间。地址可以是配置服务端提供的另一源站，客户端不自动下载该 URL，也不向其转发箱子凭据。缺少两个链接响应头的旧服务端仍可使用，工具返回 `url: null`、`expiresAt: null` 和 `urlUnavailableReason`，图片附件照常可用；只缺一个响应头或元数据非法会拒绝此次响应。Core 保存图片附件并提供 `log:` 句柄，AI 可将它传给已有 QQ 工具的 `image` 参数，并按对话填写收件人与配文。拍照本身不发送消息。支持临时链接的服务端将照片临时落盘，默认 24 小时后失效并自动清理。仅支持 HTTPS 图片的发图工具可直接使用 `url`；支持图片句柄的工具继续使用附件。Core 附件的保留规则独立于临时 URL，需长期保存时发送或下载图片。
