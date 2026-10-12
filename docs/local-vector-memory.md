# Neko 本地向量记忆：部署与验收

2026-10-12，本机试跑使用 N.E.K.O. 源版本 `745939418a6727d5a06e021d6a540be80125d08b`。本次是原生记忆功能的配置恢复，没有修改 Neko/Minecraft 的 Python 或 JavaScript 行为，也没有修改上下文裁剪、任务调度或模型参数。

## 原因与处理

原启动脚本设置了 `NEKO_VECTORS_ENABLED=0`，本地也没有嵌入权重。运行日志明确记录 `disabled:user_disabled_via_config`；历史查询仍有 BM25 结果，但向量一路为零。这与“记忆服务器 HTTP 正常”可以同时发生。

现已安装上游原生 INT8 资源，把试跑启动环境改为 `NEKO_VECTORS_ENABLED=1`，并在空闲且语音播放完成的边界重载了任务所属的 Neko 宿主。原生游戏进程、游戏会话、观战、3090 模型、3080 Ti 语音和监工进程均保留。没有单独杀死记忆子进程：当前 launcher 将其死亡视为严重故障，会连带关闭宿主。

## 记忆的实际分工

Neko 的主脑记忆由每角色 JSON 和 SQLite 组成，不需要另外部署 Qdrant 或 Chroma：

- `time_indexed.db` 保存聊天原始记录，`recent.json` 提供近期工作上下文。
- `facts.json`、`reflections.json`、`persona.json` 保存事实、反思和人格知识；原生后台 worker 给它们回填兼容向量。
- 内置 `recall_memory(query, time)` 经记忆服务执行 BM25 + cosine，再用 RRF 合并。面向用户的查询没有额外 LLM 重排请求。
- 用户查询候选包括事实、反思及归档事实；人格已进入常规上下文，所以不重复加入这一召回池。后台维护对人格有另外的检索路径。
- 原生 Minecraft 的 `src/agent/memory_bank.js` 主要记地点；游戏原始证据、动作结果和原生日志查询是另一条链路。安装主脑向量模型不会自动把每条游戏原始日志都变成向量。

实机 `GET /api/tools?role=YUI` 同时存在 `recall_memory` 与五个 Minecraft 工具。主脑可按需回忆，不需要每轮注入整库或强制调用检索。工具可用和诊断查询成功不等于模型已经在自然游玩中主动调用它；本次没有据此宣称自主空转或重复语音已修好。

## 原生模型与硬件

使用项目原生匿名 profile `local-text-retrieval-v1`，本机缓存 ID 为 `local-text-retrieval-v1-256d-int8-mlen1024`。维度、tokenizer、池化、量化和长度策略沿用原生实现，不引入不兼容的向量空间。

资源来自 [Jina 上游模型卡](https://huggingface.co/jinaai/jina-embeddings-v5-text-nano-retrieval/blob/ac5d898c8d382b17167c33e5c8af644a3519b47d/README.md)，固定 revision `ac5d898c8d382b17167c33e5c8af644a3519b47d`。权重许可证见该模型卡；本 fork 只保存准备脚本和文档，不分发模型、向量、记忆正文或音色数据。

本机 i9-13900K 的原生 ONNX CPU 路径已经满足此次检索延迟要求，选择保留它。RTX 3090 继续用于 Qwen 与视觉，RTX 3080 Ti 继续用于 VoxCPM2。此次没有加载 GPU 嵌入服务，避免增加语音争用；不同 CPU、记忆规模或吞吐需要重新测量。

| 验证 | 实测 |
| --- | --- |
| 原生编码器冷加载 | 1072 ms；独立诊断进程 |
| 4 条合成中文文档批处理 | 195 ms |
| 单条中文 query 嵌入，顺序 12 次 | 中位数 109 ms，最大 124 ms |
| 4 组合成语义检索 | 4/4 首位匹配；仅小规模功能检查 |
| 独立诊断进程 RSS | 约 261 MiB，包含解释器/依赖，不是单独权重增量 |
| 实际 HTTP 查询，3 次 | 客户端 149–160 ms；服务端 139–142 ms |
| 实际查询的向量一路 | 每次对 65 个有效候选评分，4 条过阈值，融合后 5–7 条 |

样本数较少，没有并发或长时间吞吐保证。CPU 编码耗时与完整 HTTP 检索耗时分别记录；这些不是一次游戏决策的总等待时间。

## 重现安装

先按 [companion README](../integrations/project-neko/README.md) 准备对应 Neko 源码和已有 Python 3.11 环境。Windows 试跑可运行：

```powershell
./integrations/project-neko/scripts/prepare-memory-vectors.ps1 `
    -NekoRoot 'D:/neko-mc-trial/N.E.K.O' `
    -DataRoot 'D:/neko-mc-trial/state'

# 在真正启动 Neko 的进程环境中设置；当前进程临时设置不会改变旧服务。
$env:NEKO_VECTORS_ENABLED='1'
```

准备脚本调用上游 `scripts/prepare_embedding_model.py`，只下载固定 INT8 profile；不安装额外依赖，不改角色记忆，不重启服务。完整缓存优先从所选数据根的 `embedding_models/local-text-retrieval-v1/` 读取。只有权重、外置数据和 tokenizer 均完整才算资源就绪。

模型失败时原生记忆仍降级为 BM25；CPU、RAM 和依赖的原生故障保护保留。模型/profile 改动时不要拿新旧不兼容向量直接比较，也不要删除原始数据来“重建”。

## 本次实际验收与回退

10:48:27（北京时间），新宿主启动后的日志出现 `EmbeddingService: ready`。早先独立诊断进程也写过 ready，因此验收只使用本次宿主加载边界之后的记录。

- 58/58 事实、7/7 反思、13/13 人格条目的向量均通过原生文本哈希、维度和 profile 校验。
- 回填前后逐条核对原文哈希；78 条记忆原文全部保留。SQLite 中原有 216 行逐行哈希一致。
- 三次实际查询均记录 `emb_svc=ready`，向量评分和融合命中数均非零；没有向角色插入测试记忆。
- 149 项既有 embedding worker、hybrid recall 和 embedding schema 回归通过。PowerShell 准备脚本语法与固定资源缓存重跑通过。
- 10 个受保护进程的身份和原游戏会话均保留；VoxCPM2 unit 保持 active，MainPID 和重启次数未变。游戏、模型和 TTS 均未重启。

部署和私有备份仅留本机 `D:/neko-mc-trial/runtime/vector-memory-20261012/`。`runtime-verification.json` 保存上述元数据；正文备份不提交。

回退只需恢复原启动环境 `NEKO_VECTORS_ENABLED=0`，在正常维护边界重载所属 Neko 宿主。现有兼容向量可以保留，关闭时不会参与查询。不要用旧整库覆盖正在追加的新聊天；如果需要数据恢复，使用本次私有备份并逐项核对新增内容。
