# 游戏各模型角色的独立思考设置

Mindcraft 已分别创建 `chat_model`、`code_model`、`vision_model`；原试跑 profile 虽然配置了三条路径，但它们的 `reasoning_effort` 都是 `none`。本次沿用框架已有的分工，只修改代码角色配置。

| 用途 | 配置入口 | 思考强度 | 输出总预算 |
| --- | --- | --- | ---: |
| 原生短目标决策、对话、记忆 | `model.params` | `none` | 2048 token |
| `!newAction` 生成或纠正动作脚本 | `code_model.params` | `low`，思考预算 512 token | 3072 token |
| 按需看图 | `vision_model.params` | `none` | 384 token |

三条路径仍指向本机 `http://127.0.0.1:18030/v1` 的 `qwen3.8-flash-next-iq3_xxs`，使用同一份模型。模型及视觉编码继续在同一 RTX 3090；视觉部署见[同卡编码记录](neko-same-3090-vision-2026-10-10.md)。Strata 的全局默认仍是 `none`，Neko 上层自主分析和人物对话的配置未改。线上 DeepSeek 监工的独立配置见 [DSH 文档](dsh-supervisor.md)。

```json
"code_model": {
  "api": "openai",
  "url": "http://127.0.0.1:18030/v1",
  "model": "qwen3.8-flash-next-iq3_xxs",
  "params": {
    "max_tokens": 3072,
    "temperature": 0.6,
    "reasoning_effort": "low",
    "reasoning_budget_tokens": 512
  }
}
```

`reasoning_budget_tokens` 是本机 Strata 支持的请求参数。`max_tokens` 包含思考及答案，因此代码角色增加了输出余量；它不是上下文长度。仍沿用每次代码请求 45 秒、三次纠错和现有隔离执行限制。低思考只在代码生成调用发生时使用，不增加定时决策、截图或脚本任务。

## 验证

- 通过现有模型工厂、GPT 适配器和 OpenAI SDK 序列化请求，分别检查 chat/code/vision 的实际 JSON：`none / low / none`，512 token 思考预算只出现在 code 请求中；代码调用同时经过 `Prompter.promptCoding`。
- 在模型空闲时执行一次本地代码生成请求，HTTP 200，实际返回独立思考内容和完整代码块，语法检查通过，耗时 3945 ms。只保存思考长度等元数据，代码没有在游戏中执行。
- 原生端和贡献分支的代码生成生命周期、脚本执行和视觉请求相关回归各 16/16 通过。本次没有修改模型路由或执行器源码。
- 该短探针只有 267 个输入 token，不能当成真实任务的稳定延迟或质量提升证明；真实代码调用仍受当前上下文、代码复杂度和本地队列影响。

11:53 等到白天、满血、无附近敌人且没有当前任务的空档，经既有生命周期重载原生执行器。运行中的 MindServer 设置和 agent 启动保存的 profile 均确认 `none / low+512 / none`；Strata `/settings` 的全局默认仍为 `none`。上层 Neko、插件宿主、桌面及线上监工保持原进程。

部署后在线状态新鲜，生命/饱食均为20；自然派发的交易任务读取到了商人的真实报价，因缺少要求的煤换绿宝石选项而如实返回失败。没有人为注入测试任务，也尚未观测到部署后自然触发的代码生成，不能把此记录当成代码质量提升或交易成功。等待部署期间模型在11:50更换过进程，原因未确认，单独记入维护日志；不能声称整个观察窗口模型从未重启。

本机证据：`logs/game-role-reasoning-verification-20261010.json`、`logs/game-role-reasoning-tests-20261010.log`、`logs/game-role-reasoning-loaded-after-20261010.json`、`logs/game-role-reasoning-runtime-final-20261010.json`。部署与进程比较另记维护日志。
