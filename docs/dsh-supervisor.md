# 使用 DSH 接入 Minecraft 工单监工

这层把现有 `ticket-server.mjs` / `botwatch.mjs` 接到真正的 DeepSeek Harness 子 Agent。
游戏驾驶员仍是 N.E.K.O.；DSH 创建相互独立的观察员、诊断员和复核员会话，负责取证、发现问题和工单分析。
DSH 负责 **巡检 → 诊断假设 → 独立复核 → 建单/评论 → 修复交接队列**。现有每小时维护任务负责核查源码、修复和部署，并提交修复回执；DSH 不获得任意改码/部署权限，也不把诊断报告当成修复成功。

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
模型没有 10 秒心跳：首次巡检后，无变化时 15 分钟一次；新建/复发工单或尚未检查的真实失败回执可提前触发，但两次尝试至少间隔 5 分钟，失败重试也受冷却约束。
每轮最多两个新候选问题，稳定 dedupKey 交由现有工单服务合并。只评论现有工单，不认领、不替其他工作者关单。
诊断一次聚焦一张工单，优先未复核/最久未复核的单；全部已读时也轮换最久未复核项，只记录实际复核过的条目，避免旧问题反复占位或把未处理单误记为已读。
原生执行日志中的任务失败、重试与命令回执也进入证据；工单带原始创建/更新时间与证据，引用 ID 由每轮 JSON schema 枚举限定。
诊断可以引用已标记时间的历史失败，评论明确提示不能据此认定故障仍持续。评论 API 确认成功才记为已处理；引用无效、网络失败或工单在诊断期间复发，均保留待处理并记录原因。失败尝试参与公平调度，仍受 5 分钟冷却约束。
升级会重置旧版未经写回确认的已读标记，重新核对未完结工单。

所有监工共用 `http://127.0.0.1:18030/v1` 的 `qwen3.8-flash-next-iq3_xxs`，模型调用串行。
每个角色启动前检查 Strata `/metrics`，有运行/排队请求时让路；这不是服务器的硬优先级，检查后的竞争仍可能发生。
拿到模型之后才采集该角色的证据。每条观测含原始时间、来源和不可变 ID；后续角色只保留此前引用的事实，并重新计算其年龄，不用新快照的时间替旧内容续期。每个阶段的采样时间、排队和推理耗时写入报告。跨登录会话立即中止本轮。
每次最多输出 512 tokens，监工上下文单独限制为 16K 容量；实际证据通常约数千字，不复制整个游戏聊天历史。

候选问题区分 `scope=current` 和 `scope=execution`：前者只用 90 秒内的观测证明当前异常；后者可检查 30 分钟内的真实失败回执，但只能陈述过去发生的执行异常，不能推断现在卡死。任务失败不自动等于代码有 bug。重复失败按原始时间、错误摘要和不同任务数汇总；异常栈不会被长背包段挤出。事件 ID 稳定，不随本轮选择顺序变化。
审核员的 `acceptedKeys` 只枚举候选问题的 key，`evidenceIds` 只枚举实际事实 ID，两者分开验证。未发布的候选及原因也写入报告。

### Qwen 不思考参数

pi-ai 的 `reasoningEfforts:false` **会省略** Qwen 的开关，Strata 随后默认开启思考。
因此模型能力保留 `{off:null, low:'low'}`，实际每个 Agent 固定 `reasoningEffort:'off'`，兼容格式使用 `qwen-chat-template`。
这会发送 `chat_template_kwargs.enable_thinking:false`，而不是依赖“模型不支持思考”的声明。

## 证据与运行状态

- `status.json`：PID、各角色成功次数、最近巡检、游戏连接、模型路线、子服务 PID。
- `worker-events.jsonl`：真实 DSH 子会话开始/结束与 stopReason，失败记录保留。
- `reports/<timestamp>.json`：原始事实、三个角色报告、实际创建的工单 ID。
- `dsh-home/sessions/`：DSH 原生持久化会话。
- `repair-queue.json`：每张未完结工单的诊断假设、修复回执与下一阶段；供现有每小时维护任务读取。
- `repair-receipts/`：维护者提交的代码版本、检查日志哈希、部署与实际运行验证证据。
- 现有工单网页：`http://127.0.0.1:48920/`（本机访问）。原游戏局域网页面继续沿用原地址。

游戏离线、状态超过 45 秒、跨会话、引用未知/超出对应范围的证据或复核不通过，都不会发布模型候选工单。
欢迎消息按登录时间、任务消息按原始接收时间计龄；旧事件过滤掉，哨兵的源遥测过期也按过期证据处理。
固定规则哨兵仍可直接建单；它的判断与 DSH 模型复核在报告中分开保留。
`gameCommandsSent` / `codeDeployments` 当前始终为 0：没有这两类执行通道。
连接错误与最近一次历史错误分开显示；只有收到真实且新鲜的游戏帧才清除当前错误，断线后的旧帧不会继续显示在线。

## 维护者修复回执

维护者先读 `repair-queue.json`，核对真实游戏和源码；诊断是待验证假设，不是执行指令。修复后创建一份 JSON 输入，字段如下：

```json
{
  "schemaVersion": 1,
  "id": "recipe-null-20261010",
  "ticketId": "T-0008",
  "ticketOccurrences": 1,
  "phase": "deployed",
  "commit": "40位实际修复提交SHA",
  "checks": [{ "name": "regression", "exitCode": 0, "logPath": "D:/neko-mc-trial/logs/实际检查日志.log" }],
  "deployment": { "at": 1791562000000, "component": "native", "commit": "与commit相同的实际SHA" }
}
```

这是字段示例，必须替换为对应工单、修复前的 `occurrences` 和实际检查/部署记录。调用：

```powershell
node services/dsh-supervisor/repair.mjs D:/neko-mc-trial/repair-input.json D:/neko-mc-trial/runtime/dsh-supervisor D:/neko-mc-trial/mc-agent-viewer-contrib
```

CLI 验证提交确实存在、证据文件存在且非空，计算 SHA-256。阶段为 `prepared`（检查通过，待部署）、`deployed`（已部署，待运行验证）、`verified`（外部维护者提交实际运行验证）或 `failed`。`verified` 还必须包含 `verification:{passed:true,at:实际验证时间,evidencePath:绝对路径}`，其时间不能早于部署。测试退出码必须为 0 才能使用成功阶段。

回执评论带幂等标记：重复提交相同证据不会刷评论。API 写入未确认或工单已超过修复基线复发时，回执保留为 pending。队列明确区分等待部署、等待运行验证、修复后复发和写回失败。
本接口不认领、不修改工单状态、不自动关单；哨兵的 `auto-cleared→verifying` 也不等于有代码修复。维护者只有核实工单自己的验收条件后才能按原流程结束工单。

## 验证

```powershell
node --test test/dsh_supervisor.test.mjs
node --test test/dsh_audit.test.mjs test/dsh_repair.test.mjs test/dsh_schema_compat.test.mjs
node --check services/dsh-supervisor/app.mjs
# 实际模型验收，透明转发本机请求并只记录模型名、思考开关等元数据。
node services/dsh-supervisor/verify.mjs D:\neko-mc-trial\mc-agent-neko D:\neko-mc-trial\runtime\dsh-verification
```

单元回归覆盖本机路由、模型忙碌让路、证据预算、任务指引保留、过期/跨会话拒绝、复核引用和事件冷却。
本机已安装 DSH 时，兼容回归直接调用其实际 schema 校验器；未安装时只跳过该集成项。该版本不支持 `maxItems` 或数组 `const`，候选数量和引用预算由提示及协调器校验控制，不能随意增加标准 JSON Schema 关键字。
`-Once` 的真实模型验收必须同时检查两个或三个独立子会话均 `completed`、报告中的证据来自当前游戏、游戏没有被派发诊断任务。
只有角色真实执行过才能计入 `roleRuns`；未触发诊断员时不冒称诊断员已经实测。
