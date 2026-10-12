# 监工故障交接与维护领取

本地部署的监工把已独立复核的故障交给同一任务中的 Codex 维护器。
DSH 仍使用官方线上 DeepSeek，串行工作；游戏与视觉继续使用本机
RTX 3090，VoxCPM2 继续使用 RTX 3080 Ti。维护队列不发送游戏指令，
不额外调用游戏模型，不把生成的诊断当作已执行的修复。

## 精确证据与稳定故障

原生任务结束回执中的命令和结果分别解析。成功的背包表不会挤掉
后面的明确失败；相同命令、相同真实原因合并计数。`Action output:`
包装与 WebSocket 附加的库存尾注不参与错误指纹。不同拒绝原因，
例如窗口变更和目标空间不足，保留为不同事实。

投影保留实际停止状态、原始时间、任务 ID、完整结果长度、SHA-256
与不可变回执引用。较长细节明确标记未全部展开；缺失信息不能当作
成功。原文和游戏收到的信息不被这次监工改动删除。维护器可以查询：

```powershell
node services/dsh-supervisor/maintenance.mjs evidence D:/neko-mc-trial/runtime/dsh-supervisor native.execution.原始毫秒时间.原始12位哈希
# 查看默认投影里的 commandSections 后，读取某个真实命令的完整结果：
node services/dsh-supervisor/maintenance.mjs evidence D:/neko-mc-trial/runtime/dsh-supervisor native.execution.原始毫秒时间.原始12位哈希 '!window'
```

上述回执 ID 要从实际维护请求或工单事实取得。默认只返回失败事实与
来源元数据；按命令查询返回该命令的实际工具结果，不复制规划正文。
若原始回执已不在本任务日志及保留轮转中，入口明确报告不可用，须
继续查询原始任务存储，不能补猜。

故障标识由实际组件、主体和原因生成，模型写出的 key 仅作为标签。
不同任务再次遇到同一原因，补充真实发生证据；重复报告同一回执不
再增加次数。连续状态告警只记一次激活，实际恢复后再发生才重新
激活。已验证修复之前的历史失败不会冒充新的故障。

YSM 证据单独保留玩家标识、可用状态和原因。其他玩家的外观状态仅
作为上下文，不证明 NEKO 自身故障。历史工单可以关联，原工单与
评论不会因此关闭或删除；不同玩家与不同原因仍分别保留。

## 领取并处理维护请求

协调器将复核认可的故障持久写入 `maintenance-queue.json`。原来的
`repair-queue.json` 仍保留完整工单视图；快速维护无需每次重读所有
旧工单。队列事务有独占文件锁，重启不会丢失领取状态。
已由维护者提交实际提交和检查回执、仍等待部署或运行验收的修复也
形成后续请求，标为 `checked-repair-follow-up`；它不冒称来自新的模型
发现。新鲜故障优先于陈旧记录，待验收事项不会只留在评论中。

```powershell
node services/dsh-supervisor/maintenance.mjs gate D:/neko-mc-trial/runtime/dsh-supervisor
node services/dsh-supervisor/maintenance.mjs peek D:/neko-mc-trial/runtime/dsh-supervisor
node services/dsh-supervisor/maintenance.mjs claim D:/neko-mc-trial/runtime/dsh-supervisor codex-neko-maintainer
```

领取返回实际请求、各工单的 `baselines` 和 `lease`。租约默认30分钟，
同一故障只能由一名维护者处理。无人值守关闭时 CLI 拒绝领取；没有
新请求时不运行修复。领取以后先读相关原始证据并取得最新游戏状态，
再确认是否需要改代码，不能按模型摘要直接重启或部署。

耗时较长时，在租约到期之前续租：

```powershell
node services/dsh-supervisor/maintenance.mjs renew D:/neko-mc-trial/runtime/dsh-supervisor 请求ID 租约ID codex-neko-maintainer
```

同一故障出现新实际发生时，旧请求标为 `superseded`，有效租约仍阻止
第二名维护者开工。续租会转移到最新请求并返回 `baselineChanged`。
此时重新核对新证据和真实发生次数；旧基线的修复回执不能确认新版本。
原租约过期以后才允许其他维护者领取。

如果工单 API 的写入结果未确认，请求带 `requiresTicketConfirmation`，
或回执阶段为 `pending_api`。先核对对应报告、实际 API 与已存在的
故障标识，恢复确认；不得把缺少确认当成新的游戏故障反复建单。

## 写回与结束本次维护

代码修复沿用 `repair.mjs`，提交实际 SHA、检查日志、部署与运行
证据。先取得该脚本的已确认回执，再结束本次领取：

```powershell
node services/dsh-supervisor/maintenance.mjs finish D:/neko-mc-trial/runtime/dsh-supervisor 请求ID 租约ID codex-neko-maintainer verified D:/neko-mc-trial/runtime/dsh-supervisor/repair-receipts/实际回执.json
```

`prepared` 表示检查通过但尚未部署，`deployed` 表示尚待现场验收，
`verified` 必须有实际恢复证据。CLI 核对存放在本队列回执目录内的
记录、对应工单的发生次数、API 确认以及检查和运行证据哈希；旧租约、
旧请求和改变过的证据均不能完成验收。准备和部署后的请求继续保留，
可在后续短检查中领取，不需要等下一次完整巡检。

真实核查后不需代码修复时，维护器可以提交 `observed_clear` 或
`no_repair_needed`，提供实际观测证据文件；证据不足用
`needs_information`，修复失败用 `failed`。这些状态都不自动修改原
工单状态，更不等于代码修复已验证。相同版本已有证据的无改动处理
不会被旧部署记录反复唤醒；新实际发生仍生成新版本。

## 检查频率和验收

现有 Codex 心跳短检查先执行 `gate`，它只读状态、基线和队列元数据，
不探测游戏或模型。无到期请求且距离完整检查不足一小时就安静结束。
监工状态或队列异常则检查监工本身，不能把它当作游戏故障。有请求时
领取并核查，不抢占已有租约。每小时
仍执行游戏、模型、画面、语音和服务连续性的完整检查。通知仅用于
真实故障、实际修复、重要状态变化或需要人工处理的事项。

相关回归包含真实协调器到维护队列的交接、两个独立 CLI 进程竞争
领取、重启保持租约、过期接管、版本转移和拒绝变化的验证证据：

```powershell
node --test test/dsh*.test.mjs
```

部署验收还需核对真实报告、维护请求及实际领取回执。队列测试通过
不代表背包、导航、试炼或自主生存问题已全部解决。
