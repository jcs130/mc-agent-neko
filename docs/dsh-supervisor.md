# 使用 DSH 接入 Minecraft 工单监工

这层把现有 `ticket-server.mjs` / `botwatch.mjs` 接到真正的 DeepSeek Harness 子 Agent。
游戏驾驶员仍是 N.E.K.O.；DSH 创建相互独立的观察员、诊断员和复核员会话，负责取证、发现问题和工单分析。
当前交付边界是 **巡检 → 诊断假设 → 独立复核 → 建单/评论**。没有自动改码或部署权限，不把诊断报告当成修复成功。

## 启动

需要本机安装 `@deepseek-ai/dsh`（已验证 `0.1.5-rc.2`）和 MC 项目的 Node 依赖：

```powershell
# 一轮实际巡检，结束后退出。不会向游戏发任务或聊天。
& .\services\dsh-supervisor\start.ps1 -NativeRoot D:\neko-mc-trial\mc-agent-neko -Once

# 持续巡检；用隐藏 PowerShell 启动，不弹出额外窗口。
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-File',"$PWD\services\dsh-supervisor\start.ps1"

# 停止监工；不停止游戏、本地模型或 N.E.K.O.。
New-Item -ItemType File -Path D:\neko-mc-trial\runtime\dsh-supervisor\stop -Force
```

`-RuntimeRoot` 可以另指定状态目录。启动器使用 OS mutex 防止重复运行，并创建独立 `DSH_HOME`，不改用户的全局 DSH 配置和凭据。
仅拉起需要的 ticket-server / botwatch，不运行上游整套 `watchdog.ps1`，避免其中旧世界/旧端口的重启策略接管当前游戏。

## 角色和触发

- `observer`：核对当前游戏状态、服务器消息和成果摘要，允许“没有新问题”。
- `diagnoser`：首次核对基线；之后存在候选异常或现有工单时才启动，提供标明未知的根因假设与下一项检查。
- `reviewer`：独立核对原始证据，决定是否确认候选问题。
- 宿主协调器：验证引用、会话和时间，调用窄范围工单 API。模型输出只作为 JSON 数据，不能执行代码或游戏指令。

结果通过 DSH 原生 `outputSchema` / `structured_output` 提交和校验，不依赖模型自由文本恰好写出合法 JSON。
协议提示明确区分 guild/market 试炼与 commission 合同，避免把不同命名空间的 ID 错用推断成服务器状态损坏。
未完成任务、`ready=false` 或未知是否尝试只能作为待办背景，不能单独建立故障单；缓存任务消息保留原始 `observedAt`，不会因为遥测刷新就变成新鲜证据。

遥测每 15 秒读取一次，使用 `query_game_state` 且 `conversationOwner:false`，不抢主会话的信息订阅。
被动保存 vitals 和真实任务/日志事件，供原生哨兵读取；状态轮询和定时广播不写入活动日志，避免用心跳掩盖冻结。
模型没有 10 秒心跳：首次巡检后，无变化时 15 分钟一次；新建/复发工单可提前触发，但两轮至少间隔 5 分钟。
每轮最多两个新候选问题，稳定 dedupKey 交由现有工单服务合并。只评论现有工单，不认领、不替其他工作者关单。
诊断一次聚焦一张工单，优先未复核/最久未复核的单，只记录实际复核过的条目，避免旧问题反复占位或把未处理单误记为已读。
原生执行日志中的任务失败、重试与命令回执也进入证据；工单带原始创建/更新时间与证据，引用 ID 由每轮 JSON schema 枚举限定。
诊断可以引用已标记时间的历史失败，评论明确提示不能据此认定故障仍持续。评论 API 确认成功才记为已处理；引用无效、网络失败或工单在诊断期间复发，均保留待处理并记录原因。失败尝试参与公平调度，仍受 5 分钟冷却约束。
升级会重置旧版未经写回确认的已读标记，重新核对未完结工单。

所有监工共用 `http://127.0.0.1:18030/v1` 的 `qwen3.8-flash-next-iq3_xxs`，模型调用串行。
每个角色启动前检查 Strata `/metrics`，有运行/排队请求时让路；这不是服务器的硬优先级，检查后的竞争仍可能发生。
每次最多输出 512 tokens，监工上下文单独限制为 16K 容量；实际证据通常约数千字，不复制整个游戏聊天历史。

### Qwen 不思考参数

pi-ai 的 `reasoningEfforts:false` **会省略** Qwen 的开关，Strata 随后默认开启思考。
因此模型能力保留 `{off:null, low:'low'}`，实际每个 Agent 固定 `reasoningEffort:'off'`，兼容格式使用 `qwen-chat-template`。
这会发送 `chat_template_kwargs.enable_thinking:false`，而不是依赖“模型不支持思考”的声明。

## 证据与运行状态

- `status.json`：PID、各角色成功次数、最近巡检、游戏连接、模型路线、子服务 PID。
- `worker-events.jsonl`：真实 DSH 子会话开始/结束与 stopReason，失败记录保留。
- `reports/<timestamp>.json`：原始事实、三个角色报告、实际创建的工单 ID。
- `dsh-home/sessions/`：DSH 原生持久化会话。
- 现有工单网页：`http://127.0.0.1:48920/`（本机访问）。原游戏局域网页面继续沿用原地址。

游戏离线、状态超过 45 秒、跨会话、引用未知/过期证据或复核不通过，都不会发布模型候选工单。
欢迎消息按登录时间、任务消息按原始接收时间计龄；旧事件过滤掉，哨兵的源遥测过期也按过期证据处理。
固定规则哨兵仍可直接建单；它的判断与 DSH 模型复核在报告中分开保留。
`gameCommandsSent` / `codeDeployments` 当前始终为 0：没有这两类执行通道。

## 验证

```powershell
node --test test/dsh_supervisor.test.mjs
node --check services/dsh-supervisor/app.mjs
# 实际模型验收，透明转发本机请求并只记录模型名、思考开关等元数据。
node services/dsh-supervisor/verify.mjs D:\neko-mc-trial\mc-agent-neko D:\neko-mc-trial\runtime\dsh-verification
```

单元回归覆盖本机路由、模型忙碌让路、证据预算、任务指引保留、过期/跨会话拒绝、复核引用和事件冷却。
`-Once` 的真实模型验收必须同时检查两个或三个独立子会话均 `completed`、报告中的证据来自当前游戏、游戏没有被派发诊断任务。
只有角色真实执行过才能计入 `roleRuns`；未触发诊断员时不冒称诊断员已经实测。
