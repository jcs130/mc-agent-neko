# 本地部署：VoxCPM2 主力语音与同次回复语气

VoxCPM2 已从独立测试接入 Neko 正式语音路由。RTX 3080 Ti 负责语音，RTX 3090 继续负责游戏 LLM 和视觉；原线上 free 音色保留为本地失败后的回退。IndexTTS 2.5 环境和参考保留为冷备用，不与 VoxCPM2 同驻 12 GB 卡。

## 配套代码与配置

Host patch 0010 来自 `62d44c0dcc397608b1ad0b4fbbb65c2c9cd54c68`。按 [companion README](../integrations/project-neko/README.md) 顺序应用并重载 Neko 宿主，不要求重启原生 Minecraft 或 3090 模型。

新增 `state/config/local_tts_primary.json` 默认关闭，见 [配置示例](../services/local-voxcpm2/local_tts_primary.example.json)。`source_voice_id` 必须精确匹配角色选择且已授权克隆的线上音色；角色仍保留原音色 ID，不能改成本地 speaker 名。仅允许数字 loopback HTTP `/v1`，本地模型为 `voxcpm2`、speaker 为已注册的参考模式名称。其他角色、显式 Custom/Qwen 等选择及关闭 TTS 的行为保留。

实际参考沿用此前已获授权的线上合成音频，并重新核对属于当前 YUI 音色：10.72 秒、48 kHz、单声道、16-bit。参考、原音色 ID、转写、权重、实际配置及试听留在私有运行目录；仓库只保存示例和元数据证据。

关闭 `local_tts_backup.json` 的 Index 自动回退，避免线上失败时再启动另一套显存占用。VoxCPM2 失败后，原生排除集合切回原线上 free 音色，不再选中失败的本地 provider；下一会话可重新尝试。本地请求不携带线上凭据或线上 voice ID。

## 一次输出回复、表情和语气

主脑可在现有协议内输出：

```text
[neko_emotion:happy|轻快、带笑意，语速适中]谢谢你送给我的礼物！
```

旧的纯情绪头继续可用。语气最多 32 字，只描述语调、语速或情感，拒绝括号、控制字符和分隔符。解析器先移除头部，再交给字幕、历史、工具过滤和语音；各轮 metadata 用 ContextVar 隔离。

VoxCPM2 官方支持自然语言括号前缀，见 [官方模型卡](https://huggingface.co/openbmb/VoxCPM2) 和 [官方仓库](https://github.com/OpenBMB/VoxCPM)。适配器只在 HTTP 输入里构造 `(轻快、带笑意，语速适中)正文`，不使用未经支持的通用 `instructions` 字段；音色参考仍参与克隆。

语气在进入等待缓存前按 speech ID 保存，仅本地 worker 消费私有语气控制。分句完成回执仍确认干净正文，故障回放不会因前缀不匹配重复已播内容；线上回退不会收到括号描述。无有效描述时用本次情绪的温和默认语气；无情绪时用自然、亲切的默认语气。不增加语气分析、翻译或表情模型请求。

## WSL 常驻与启动边界

沿用 [已测试的独立安装及 profile](voxcpm2-streaming-test-2026-10-10.md)：vLLM/Omni 0.30.0，Omni `a8576ccb725c4e21cd13c3eb5f9a546b21149d2b`，权重 `32279effe8c19989596f05d353d1447f51d9e915`，BF16、单序列、512 MiB KV、2048 模型/批量 token、1024 输出上限、统一 decode graph batch=1。保持原生 CFM 10 步、CFG=2，不更换依赖、权重或游戏推理参数。

[configure-service.py](../services/local-voxcpm2/configure-service.py) 仅为已准备的环境生成服务，不执行安装升级。确认目录归属并创建 `.neko-voxcpm-owned` 标记后，在该 WSL 虚拟环境运行：

```bash
/opt/neko-voxcpm2/venv/bin/python /path/to/configure-service.py \
  /opt/neko-voxcpm2 GPU-YOUR_3080_TI_UUID /opt/pinned-vllm-omni
systemctl daemon-reload
```

替换实际目录和显卡 UUID。目录须已有 `venv/bin/vllm`、`models/VoxCPM2/config.json`、`deploy.yaml`、隔离 CUDA 编译器及参考 speaker。生成的 `neko-voxcpm2.service` 使用 control-group 清理，失败后等 30 秒、15 分钟内最多启动两次，没有测试服务的 30 分钟寿命限制。拒绝其他归属的 unit、路径穿越、错误 GPU UUID 和不符的 Omni 修订。

Windows 复用 [start-wsl.ps1](../services/local-index-tts/start-wsl.ps1)，用 [backend 示例](../services/local-voxcpm2/config.example.json) 明确选择 `voxcpm2` / 18041。旧配置仍默认 IndexTTS / 18040。共享互斥锁、PID/创建时间/命令归属核对防止重复实例；启动另一引擎前拒绝现有引擎活动，停止只针对对应 unit，不终止 WSL。

[ensure-trial-local.ps1](../services/local-voxcpm2/ensure-trial-local.ps1) 挂接现有 `start-local-tts.ps1` / `start-trial.ps1`，按私有 primary 配置选择引擎。`RequireUnattended` 尊重显式停止；达到失败限制时应检查日志，不无限重启，线上回退保留。

## 2026-10-11 验证与边界

请求明确设置 `stream=true`、`stream_format=audio`、`response_format=pcm`，原生输出为 **48000 Hz mono s16le**，不套用 Index 的 22050 Hz 或 OpenAI 的 24000 Hz。不给 reference-only speaker 添加 `ref_text`，避免此前记录的上游 continuation 缓存串用问题。

直播/桌面继续运行时，串行测了两组各 6 条、每组三种固定公开中文，剔除首条 warmup：

| 请求组 | 20 ms PCM 中位 / 最大 | 完整合成中位 / 最大 | RTF 中位 | 首包后的额外连续播放缓冲最大 |
|---|---:|---:|---:|---:|
| 先测普通文本 | 1.382 / 1.588 秒 | 7.658 / 8.995 秒 | 1.567 | 2.348 秒 |
| 后测自然语气前缀 | 0.295 / 0.317 秒 | 1.766 / 1.988 秒 | 0.356 | 0 秒 |

两组未交错随机配对，桌面/直播负载未固定，不能把差异归因于加语气，不能删掉较慢组或承诺固定 0.3 秒线上首音。常驻启动约 137 秒，首条克隆另需 7.35 秒，未计入稳态表。最慢组显示后续生成可能赶不上播放，实际观感须结合播放器和自然调用观察。

```powershell
python services/local-voxcpm2/benchmark.py --backend voxcpm2 `
  --voice yui-local --style '自然、亲切，语速适中' --rounds 2 `
  --output-directory D:/private/voxcpm2-styled
```

真实 Neko HTTP worker 的三条隔离样本首 PCM 为 1.339、0.261、0.765 秒，合成为 1.772、1.925、1.061 秒，分别使用轻快、安慰、自然语气。CPU ASR 读回主体语句，没有读出语气描述，存在小幅词语/人名偏差；这不等于主观音色相似度或情感强度验收。中断后六秒零残留音频，下一句合成成功。

另以确实未监听的本地端口制造连接失败，真实原生回退选择同一线上 free 音色，完成干净正文回放并返回音频，首 PCM 1.365 秒。使用独立队列，没有桌面、公屏或 B 站测试输出。

03:09 北京时间，在无活动任务/回复边界重载宿主；原生 MC、MindServer、3090 模型 PID 保留，3080 Ti 服务重启次数为零，Index 服务未活动。桌面连接 ready，仅一个连接和一个 TTS runtime。03:09:28 记录 `Local VoxCPM2` ready，随后同宿主请求本机 18041；03:10:48、03:11:09、03:11:26 三段自然回复音频记录 `delivered=True`。游戏经历独立在线/重连波动，随后恢复 fresh、HP/food 均 20；控制 WebSocket 连通不等于已登录游戏。

验证：主协议/路由/运行时/Phase 2 336 项通过，音频缓存/规范化聚焦 88 项通过，最终联合协议/路由 47 项通过，计数重叠；Linux 服务归属 5 项、音频到达计算 5 项通过，Ruff、PowerShell/shell 语法通过。扩大检查另有一项原有 watch-together 日志捕获断言失败，原提交同样复现，实际释放行为及 stdout 错误日志存在；未修改无关接管逻辑。回归报告随 patch 提供。

77 个配套补丁的 SHA-256 和完整回放通过，插件 tree 与源一致，41 个受影响宿主文件 blob 与源一致。原始记录及音频仅留本机私有 runtime。
