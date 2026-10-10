# 面向本地部署的 IndexTTS 2.5 备用语音

后续状态：2026-10-11 已按用户指令将 [VoxCPM2 切为主力](local-voxcpm2-primary.md)，本机 IndexTTS 转为冷备用，不能与其同驻 3080 Ti。下文保留本方案原来的可选路由和安装说明。

本方案给 Project N.E.K.O. 的指定音色增加可选本地故障回退。线上 Lanlan free 语音保持首选；提供方报错后，同一会话改用本地克隆。Minecraft 端不增加模型调用，也不接管角色表情或身体控制。

## 实现与边界

- 使用官方支持 2.5 的 [vLLM-Omni 配方](https://recipes.vllm.ai/IndexTeam/IndexTTS-2.5)，在 WSL2 Ubuntu 24.04 中运行；模型和参考音频放在 Linux 文件系统，避免运行时反复访问 `/mnt/` 权重。
- vLLM / Omni 固定为 0.30.0，Omni 源码 `a8576ccb725c4e21cd13c3eb5f9a546b21149d2b`；本机 Torch 为 `2.13.0+cu132`。仅 TTS 使用 RTX 3080 Ti 12 GB，按 UUID 隔离；游戏 Qwen / 视觉仍由原 RTX 3090 服务承担。
- 两个 TTS 阶段各 `max_num_seqs=1`、BF16、显存比例 0.4，stage 0 使用 Triton attention 和贪心采样，stage 1 沿用配方的 25 步与 DiT compile。没有启用额外情绪 LLM、MPS 或其他模型量化。
- HTTP 只绑定 `127.0.0.1:18040`。克隆参考来自用户授权的当前合成音色，未录制麦克风或游戏聊天。参考、音色缓存、权重及实际配置不进入 Git。
- 原生 IndexTTS-2 的 TensorRT 后端标注的是 2.0；本实现没有将它当作 2.5 使用，也没有声称这是所有硬件上的最快方案。

## 安装与启动

组件位于 `services/local-index-tts/`。WSL 需要 Python 3.12、git、uv、g++ 和可用的 Windows NVIDIA 驱动映射；安装脚本不安装 Linux 显卡驱动，不修改全局 CUDA，也不关闭 WSL。

1. 通过 `download-models.py OUTPUT` 下载固定修订的官方 2.5 权重、Wav2Vec2、CAMPPlus 与 BigVGAN。脚本依赖 `huggingface_hub`；没有下载或加载 QwenEmotion。
2. 在 WSL 中执行以下命令，传入实际 GPU UUID、原生模型目录和经授权的参考 WAV。首次安装需下载依赖和编译内核，后续启动复用缓存。

```bash
bash /mnt/d/path/to/mc-agent-neko/services/local-index-tts/bootstrap-wsl.sh \
  /opt/neko-index-tts GPU-REPLACE_WITH_3080_TI_UUID \
  /mnt/e/ai-models/IndexTTS-2.5 /mnt/d/private/reference.wav
```

3. 复制 `config.example.json` 到私有运行目录。Windows 侧启动：

```powershell
& ./services/local-index-tts/start-wsl.ps1 `
  -Config D:/private/index-wsl.json `
  -ProcessFile D:/private/index-process.json `
  -LogDirectory D:/private/logs
```

启动器保留一个隐藏的 WSL keeper。重复执行会复用既有实例；初始化中不创建第二份模型。WSL 内的独立 systemd unit 仅重启本服务，15 分钟内最多两次启动，失败后保留日志供排查。`-Action Status` 查询 API 和 keeper，`-Action Stop` 核对归属后只停此 unit 与其 keeper。

现有 trial 启动流程可调用 `ensure-trial-backup.ps1 -TrialRoot PATH -RequireUnattended`：它先检查私有备用配置和无人值守开关，再幂等启动。Neko 单独交互启动可省略 `-RequireUnattended`。备用启动失败应记录并继续主语音/游戏，不能联动重启主脑或模型。本机的 `start-trial.ps1`、`start-neko.ps1` 已通过 `start-local-tts.ps1` 接入此入口；关闭备用配置后不会自动拉起。仅停止无人值守游戏时，原有 Neko 主服务和语音仍可供交互使用。

4. API 就绪后，使用 `register-voice.py REFERENCE.wav --consent USER_AUTHORIZATION_ID` 注册 `yui-local`。已存在的名称保持不变；要更换参考应明确创建新名称，不能靠重复上传悄悄替换。
5. 用 `benchmark.py --output-directory PRIVATE_DIRECTORY --rounds 2` 完成首次预热和实际 PCM 检查，再启用 Neko 回退。模型列表 HTTP 200 不等于合成已就绪。
6. 应用本仓库 `integrations/project-neko/manifest.json` 中的新 host patch，将 `local_tts_backup.example.json` 复制到 Neko 的用户配置根，填写准确的原音色 ID，最后设置 `enabled=true`。在安全边界重启 Neko 主服务加载代码；无需重启 Minecraft 原生进程或 Qwen。

当前 CUDA wheel 的编译器与运行时曾被解析成 13.4 / 13.2 混用，出现头文件不兼容、PTX 9.4 / 9.2 错误。脚本固定 NVCC、CRT、NVVM 为 13.2.78，并仅在隔离环境内补齐 `lib64` / `libcudart.so` 链接；WSL 的 `libcuda` 由 `/usr/lib/wsl/lib` 提供。

后续在独立环境复现安装时，强制 `--torch-backend=cu132` 会因缺少对应 TorchAudio wheel 而解析失败，安装入口已改为实测通过的 `auto`；本机实际 Torch 仍为 cu132，现有环境无需重装。同卡的 [VoxCPM2 流式候选测试](voxcpm2-streaming-test-2026-10-10.md)仅作评估，未替换这条生产备用链路。

## Neko 回退语义

- 默认关闭，仅在配置的原音色精确匹配、原选择为 free 且 TTS 启用时包装其身份；其他角色和提供方沿用原路由。
- 沿用原生提供方排除、worker 归属、重放账本和取消逻辑。首个错误之前尚未输出音频，可重放当前未播内容；free 双流已输出音频时无法可靠定位句内进度，因此跳过已开始的句子，仅保留未发送的后续内容。
- 本地失败后结束这条链，保留文字，不循环回到故障线上服务。原音色配置不改变；下一次新会话重新尝试线上服务，没有会话中途探测并强行切回。
- 本地适配器丢弃传入的线上凭据和音色 ID，以空 key 和独立本地名称发请求。仅允许数值 loopback HTTP `/v1`，不接受远端 URL、URL 凭据或查询参数。
- 这个模型拒绝 Speech API 的 `sample_rate` 覆盖。客户端按原生 **22050 Hz PCM** 解码，再流式重采样到 Neko 的 48000 Hz；其他 OpenAI 语音继续默认 24000 Hz。误按 24000 Hz 解码会改变语速和音调。
- 本地 HTTP 超时为 60 秒，SDK 隐式重试为 0；不影响其他提供方默认值。打断取消属于本次请求，旧 runtime 音频不能进入新会话；不承诺立即打断已执行的 CUDA 内核。

## 2026-10-10 实测

单张 3080 Ti 上，三条固定中文（19 / 33 / 28 字），两轮顺序调用；线上语音、Neko、Minecraft 和 3090 Qwen 同时保留运行。以下是客户端等待到完整 PCM 的时间，单位秒：

| 样本 | 首轮 | 第二轮 | 第二轮音频长度 |
|---|---:|---:|---:|
| 19 字 | 68.309，含首次编译/预热 | 2.689 | 3.750 |
| 33 字 | 4.355 | 3.651 | 6.502 |
| 28 字 | 3.171 | 3.225 | 5.422 |

剔除首条预热后，5 个样本的中位数为 3.225 秒，范围 2.689–4.355 秒。原生 Windows PyTorch / 单 beam 的相同文本基线约 14.19 / 18.07 / 23.54 秒。该对比未固定桌面渲染负载，不能将差值全归因于 WSL，也不能推算直播每轮总等待。

WSL 服务预热后整卡显存约 8 GB，包含桌面图形占用；不是单进程分配峰值。首次内核编译不计为稳态性能。真实 Neko 分句/故障回放还包含路由与客户端初始化：首次未播内容回放约 11.9–13.5 秒，后续未发送句约 2.4–3.2 秒；额外串行试验没有稳定收益，保留原生分句并行策略，不将后端单请求时间冒充端到端时间。

验证包括 87 项路由/OpenAI 兼容回归、63 项 runtime/归属/接口回归，真实本地 HTTP 返回与 48 kHz PCM、故障后不重复已播前缀、旧文本丢弃、`audio_done`、中断后 6 秒零旧音频输出。CPU Whisper-small 能读回三条测试句的主要内容（人名存在同音字）；这验证可理解性，不能代替人工音色相似度及主观音质验收。

本机私有原始记录位于 `runtime/index-tts-backup/`。诊断只保存计时、长度、阶段与错误类别；仓库不包含角色实际音色 ID、参考音频、聊天、提示、回答或凭据。
