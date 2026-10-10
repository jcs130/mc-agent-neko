# 使用 DSH 接入 Minecraft 工单监工

这层把现有 `ticket-server.mjs` / `botwatch.mjs` 接到真正的 DeepSeek Harness 子 Agent。
游戏驾驶员仍是 N.E.K.O.；DSH 创建相互独立的观察员、诊断员和复核员会话，负责取证、发现问题和工单分析。
DSH 负责 **巡检 → 诊断假设 → 独立复核 → 建单/评论 → 修复交接队列**。现有每小时维护任务负责核查源码、修复和部署，并提交修复回执；DSH 不获得任意改码/部署权限，也不把诊断报告当成修复成功。

## 启动

需要本机安装 `@deepseek-ai/dsh`（已验证 `0.1.5-rc.2`）、MC 项目的 Node 依赖，以及进程环境中的 `DEEPSEEK_API_KEY`。启动器缺少凭据时直接报错，不改用本地模型；密钥值不写入 profile、日志或仓库。

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

三个监工串行调用官方 `https://api.deepseek.com/v1` 的 `deepseek-flash`，对应 DeepSeek-V4.1-Flash。独立 profile 仅注册 `neko-deepseek` 一个 provider，不提供本地或局域网回退。游戏、聊天、视觉继续调用本机 `http://127.0.0.1:18030/v1` 的 `qwen3.8-flash-next-iq3_xxs`。
线上监工不再读取或等待 Strata `/metrics`，本机游戏推理忙碌或暂不可用不会阻塞监工。线上调用失败时保留工单并延期，重试仍受原有冷却约束，不抢占游戏模型。
每个角色调用前重新采集证据。每条观测含原始时间、来源和不可变 ID；后续角色只保留此前引用的事实，并重新计算其年龄，不用新快照的时间替旧内容续期。每个阶段的采样时间和推理耗时写入报告，线上服务内部排队计入请求耗时。跨登录会话立即中止本轮。
监工上下文单独限制为 16K 容量；实际证据通常约数千字，不复制整个游戏聊天历史。中文在工具调用中可能被 Unicode 转义，512 tokens 曾在摘要未写完时耗尽。三个监工角色开启低档思考，思考与结构化结论共用生成额度：观察员 6144、诊断员 4096、复核员 6144 tokens，provider 上限从角色预算推导为 6144。13:02 巡检核实六个截断会话：五个复核员耗尽原 2560、一个观察员耗尽原 3072，全部只有思考而未提交结构化结论；本次增加有限的结论余量。摘要最多40字、detail最多60字、候选最多2项，每项只引最多3条证据；不要求填满，也不提高巡检频率。哨兵告警和旧工单结论均须独立验证，不能相互背书。

候选问题区分 `scope=current` 和 `scope=execution`：前者只用 90 秒内的观测证明当前异常；后者可检查 30 分钟内的真实失败回执，但只能陈述过去发生的执行异常，不能推断现在卡死。任务失败不自动等于代码有 bug。重复失败按原始时间、错误摘要和不同任务数汇总；异常栈不会被长背包段挤出。事件 ID 稳定，不随本轮选择顺序变化。
审核员的 `acceptedKeys` 只枚举候选问题的 key，`evidenceIds` 只枚举实际事实 ID，两者分开验证。未发布的候选及原因也写入报告。
`acceptedKeys` 只表示事实成立；还必须进入 `actionableKeys` 才能建故障单。缺材料、没有相应商人报价或工程待验收等正常状态不因“确实发生过”就变成待修复问题；重复失败也须证明盲目重试或持续打断等实际损害。

### DeepSeek 监工思考参数

仅 DSH 的 observer/diagnoser/reviewer 使用线上 `reasoningEffort:'low'`。游戏驾驶员、聊天和视觉的非思考配置不变；本机服务全局默认也不改。三个监工串行运行，原有冷却与证据时效门仍生效。

pi-ai 使用 `thinkingFormat:'deepseek'`，实际发送 `thinking:{type:'enabled'}` 与顶层 `reasoning_effort:'low'`。工具对话保留历史 `reasoning_content`，普通端点禁用 beta strict 标记。能力表声明 `{off:'none', low:'low'}`，未来显式关闭时发送 `thinking:{type:'disabled'}`。参数依据[官方思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/)；模型名依据[官方模型列表](https://api-docs.deepseek.com/api/list-models/)。

生成额度是思考加结论的总上限，并非独立的硬思考 token 上限。每角色仍有90秒超时；线上延迟和可用性影响监工报告，但不占用本机游戏推理队列。是否提高诊断质量需要后续实证比较，不能只凭开启开关认定。

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
哨兵将真实日志的读取位置保存在 `bots/_supervisor/edge-cursor.json`。首次迁移使用此前 sentinel 的时间，正常重启不重放旧告警；工单写入未确认时不越过该事件，之后重试。同一毫秒的不同日志也分别确认，轮询不重叠且 HTTP 请求有超时。
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
# 实际模型验收，转发到官方线上端点，只记录模型名、思考开关、强度及耗时等元数据。
node services/dsh-supervisor/verify.mjs D:\neko-mc-trial\mc-agent-neko D:\neko-mc-trial\runtime\dsh-verification
```

单元回归覆盖指定线上路由、无本地回退、本机模型不可用时监工仍完成、证据预算、任务指引保留、过期/跨会话拒绝、复核引用和事件冷却。
本机已安装 DSH 时，兼容回归直接调用其实际 schema 校验器；未安装时只跳过该集成项。该版本不支持 `maxItems` 或数组 `const`，候选数量和引用预算由提示及协调器校验控制，不能随意增加标准 JSON Schema 关键字。
`-Once` 的真实模型验收必须同时检查两个或三个独立子会话均 `completed`、报告中的证据来自当前游戏、游戏没有被派发诊断任务。
只有角色真实执行过才能计入 `roleRuns`；未触发诊断员时不冒称诊断员已经实测。验收同时要求官方端点、`deepseek-flash`、思考 enabled/low，并收到真实 `reasoning_content` 流，不能只看配置文件。思考正文与凭据不写入验收证据或工单。

2026-10-10 切换前，本机 Qwen 低思考验收为观察员约38.9秒、诊断员26.8秒、复核员27.2秒；之后持续监工因本机忙碌出现111秒入场等待和复核延期。这是迁移到独立线上队列的依据，不是模型质量的对照实验。

同日线上验收中，观察员、诊断员、复核员分别约8.6秒、4.2秒、5.0秒，三个独立会话均 completed，真实线上思考流、工具调用与模型名均通过。持续监工随后独立完成一轮，分别约11.2秒、1.9秒、6.1秒，阶段入场等待仅3–5毫秒。针对性回归37项、完整发现回归622项均通过；缺凭据启动拒绝，模拟本机模型不可用的真实协调器仍完成三角色。专项迁移前后主服务、插件、模型、游戏和桌面进程身份一致；未操作游戏或关闭既有工单。这些是本次样本耗时，不代表固定延迟或质量提升。
