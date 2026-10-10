# 面向本地部署的 VoxCPM2 流式语音测试

本次只评估本地备用语音候选，未替换线上 Lanlan free，也未将 VoxCPM2 写入 Neko 的生产路由。参考音频沿用已获用户授权的当前合成音色，与 IndexTTS 2.5 对比使用同一份参考及三条固定中文。音频、原音色 ID、参考转写和实际配置留在私有运行目录。

## 固定环境与复现

- WSL2 Ubuntu 24.04，RTX 3080 Ti 12 GB，按 UUID 隔离；Minecraft、主服务和 RTX 3090 上的本地游戏模型连续运行。
- vLLM / Omni 0.30.0，Omni 源码 `a8576ccb725c4e21cd13c3eb5f9a546b21149d2b`；独立 Python 3.12 环境，Torch `2.13.0+cu132`、`voxcpm==2.0.3`，没有修改生产 IndexTTS 环境。
- 官方模型 `openbmb/VoxCPM2` 固定修订 `32279effe8c19989596f05d353d1447f51d9e915`；权重及 AudioVAE 共约 4.7 GB，保存在 WSL 的 ext4 文件系统。
- BF16，单路请求，512 MiB KV，最大模型长度及批量 token 均 2048，生成上限 1024，TRITON_ATTN；统一 decode graph 最大 batch=1。保持原生 10 个 CFM 步、CFG=2，未通过减少步数换速度。
- 官方默认 profile 给 KV 缓存 6 GiB，并允许 8 路请求，不适合照搬到这张还负责桌面渲染的 12 GB 卡。本次用 `services/local-voxcpm2/make-deploy.py` 从固定上游 YAML 生成缩小后的 profile。

在独立环境中安装相同版本，而非改动正在运行的语音环境：

```bash
uv venv /opt/voxcpm2-test/venv --python python3.12
uv pip install --python /opt/voxcpm2-test/venv/bin/python \
  vllm==0.30.0 /path/to/pinned/vllm-omni voxcpm==2.0.3 \
  nvidia-cuda-nvcc==13.2.78 nvidia-cuda-crt==13.2.78 nvidia-nvvm==13.2.78 \
  --torch-backend=auto
```

本机固定为 cu132 后端只给 Torch/TorchVision 提供对应 wheel，不能假定同版本 TorchAudio 也有 cu132 wheel。初次安装因此失败，自动后端解析成功且实际 Torch 为 `2.13.0+cu132`、TorchAudio 为 `2.11.0+cpu`，导入通过。IndexTTS 安装脚本同步改用已验证的 `auto`；其运行 GPU UUID、现有环境和模型参数均未变。

使用 `huggingface_hub.snapshot_download` 下载上述固定修订，然后生成 profile：

```bash
python services/local-voxcpm2/make-deploy.py \
  /path/to/pinned/vllm-omni/vllm_omni/deploy/voxcpm2.yaml \
  /opt/voxcpm2-test/deploy.yaml
```

沿用 [IndexTTS 隔离 CUDA 配置](local-index-tts-backup.md)中仅作用于虚拟环境的 CUDA_HOME、lib64/cudart 链接和 `/usr/lib/wsl/lib`；指定实际 3080 Ti UUID 后启动：

```bash
CUDA_VISIBLE_DEVICES=GPU-YOUR_3080_TI_UUID \
SPEAKER_SAMPLES_DIR=/opt/voxcpm2-test/private/speakers \
/opt/voxcpm2-test/venv/bin/vllm serve /path/to/VoxCPM2 \
  --omni --trust-remote-code --host 127.0.0.1 --port 18041 \
  --served-model-name voxcpm2 --deploy-config /opt/voxcpm2-test/deploy.yaml
```

`register-voice.py REFERENCE.wav --port 18041 --consent AUTHORIZATION_ID` 注册参考模式的 `yui-local`；同一参考再以 `--voice yui-local-continuation` 注册带转写模式。两份 WAV 相同，名称隔离是为了避开下文的缓存串用。默认端口仍为 IndexTTS 的 18040；两种模型的音色目录各自独立。不要在显存不足时同时常驻两套模型。

## 测量口径

```powershell
python services/local-voxcpm2/benchmark.py --backend voxcpm2 `
  --rounds 2 --output-directory D:/private/voxcpm2/reference-only
python services/local-voxcpm2/benchmark.py --backend voxcpm2 `
  --reference-text-file D:/private/reference-transcript.txt `
  --rounds 2 --output-directory D:/private/voxcpm2/reference-and-transcript
```

客户端在 Windows 上使用 HTTPX，串行请求；首条明确标为 warmup，之后两轮、每轮三句话。VoxCPM2 请求明确设置 `stream=true`、`stream_format=audio`、`response_format=pcm`，输出按原生 48000 Hz / s16le 处理。音频可保存试听，测量记录只含字符数、长度、计时、样本统计及音频到达时间，不保存请求或回答正文。

分别记录第一段完整 PCM、达到 20 ms 可播放数据、首个幅度达到 256/32768 的样本所在数据包、完整结束和 RTF。第一包可能是静音；这些阈值不能代表人的听觉判断。HTTP 数据包也不能直接等同模型音频块。

连续播放的最早安全起点为 `max(数据包到达时间 - 此前已收到的音频时长)`；由此计算相对首包还需多少启动缓冲。此指标可发现“首包很快但后续跟不上”，其五个时间线回归还覆盖整文件拆成多个网络包、微小首包和非法时间线。没有用总 RTF 小于 1 单独宣称实时播放，也没有做浏览器或 Neko 实际听音验收。

## 2026-10-10 实测结果

下表全部来自实际客户端请求，每条仍使用三句中的一句；排除各组首条 warmup。参考模式在两个服务代际分别测两轮，共 12 条；带转写模式和 IndexTTS 各两轮、6 条。没有固定桌面渲染负载，因此这是本机运行环境中的观测，不能把全部差异归因于模型或克隆模式。

| 模式 | 样本数 | 20 ms PCM 就绪中位 / 最大 | 完整合成中位 / 最大 | RTF 中位 |
|---|---:|---:|---:|---:|
| VoxCPM2，参考音频 | 12 | 0.299 / 1.245 秒 | 1.647 / 5.545 秒 | 0.342 |
| VoxCPM2，参考音频与转写 | 6 | 0.974 / 2.032 秒 | 3.971 / 7.214 秒 | 1.096 |
| IndexTTS 2.5，当前非流式接口 | 6 | 2.036 / 5.771 秒 | 2.039 / 5.774 秒 | 0.371 |

VoxCPM2 参考模式第一组 6 条的首段为 0.226–0.302 秒，完整合成为 1.079–1.729 秒；随后切换过模式的对照组有更慢的尾部，合并后如上表，没有只选较快一组。IndexTTS 第二轮为 1.446–2.141 秒，但第一轮有 5.774 秒样本，同样保留。VoxCPM2 与 IndexTTS 生成的语速和音频长度不同，因此同时给出 RTF，不能把秒数视为相同波形的计算比较。

VoxCPM2 音频分多次到达，参考模式的到达跨度为 0.852–4.300 秒；IndexTTS 是完成后在 1.5–3.2 毫秒内收到整段音频。此差异连同明确的流式请求和服务端 `stream=true` 记录，支持“模型接口提供了提前音频”，而不是仅把整文件拆成网络包。额外 WAV 请求的头部实测为 48000 Hz、单声道、16-bit；未沿用 IndexTTS 的 22050 Hz 解码。

参考模式 12 条中有 2 条需要超过 50 ms 的额外启动缓冲，最大 1.151 秒；其中 1 条总 RTF 超过 1。带转写模式 6 条中有 3 条需要该缓冲，最大 1.176 秒，也有 3 条 RTF 超过 1。第一段快不代表全程无断音：实际接入应按收到的音频时长维护播放缓冲，并处理慢请求和取消归属，不能承诺固定 200 ms 缓冲覆盖这些尾部。没有实施或验收 Neko 流式播放器改动。

第一次进程启动到 API 完成启动为 23:14:42–23:19:53（北京时间，约 311 秒）；采样栈确认期间正在编译 AudioVAE，后来完成统一 decode CUDA Graph 捕获。第二次启动复用缓存，23:26:57–23:28:58，约 121 秒。两个参考组的首条克隆请求另耗 10.625 / 5.479 秒，带转写首条为 3.036 秒；IndexTTS 恢复后的首条为 21.898 秒。这些均单独记录，没有混入表中的中位数。常驻预热对低等待非常重要。

模型加载日志中的权重为 4.86 GiB，稳态整卡显存约 8.2 GB，含桌面渲染，不能当作模型自身分配峰值。24 条排除 warmup 的 PCM 样本都达到非静音/长度检查，未观察到 int16 削波。CPU Whisper-small 对四组各三条样本读回的主句完整，人名存在“结衣/潔衣/潔玉”等偏差；这只能核查可理解性，音色相似度、音质及说话情绪应通过私有试听判断，不能由 ASR 通过替代。

## 发现的上游缓存问题及绕行

先使用上传音色的参考模式，再给同一音色名添加 `ref_text`，实测触发：

```text
ValueError: VoxCPM2 chunked prefill exceeds the constructed prompt:
start=0 end=153 prompt_len=91
EngineDeadError: Stage-0 has no live replica
```

固定源码的 worker 按音色名、模型类型、创建时间读取 speaker cache；命中参考特征后直接构造 `mode=reference`，没有校验本次是否还要求 continuation。服务端却已按音频与转写计算更长的提示，最终长度不一致，损坏了测试引擎。问题出在这一版 Omni 的缓存模式串用，不能据此认定 VoxCPM2 模型本身不能克隆。

测试客户端给两种模式使用独立上传名称；新代际中带转写的 7 次请求（含 warmup）及随后参考模式的 7 次请求均返回完整音频，未复发该异常。未修改 Omni 源码、未把参考模式的缓存键逻辑当作已修复，也没有发布第三方问题或联系开发者。若集成任意转写切换，应进一步做服务端的模式兼容校验，而非依赖用户记住该限制。

## 验证范围

五个音频时间线测试、Ruff、安装 shell 语法检查通过，公开 profile 生成器输出与实际部署字节一致。真实合成、跨模式隔离、WAV 采样率、音频到达和 CPU ASR 均实际检查。测试中服务由单独的 transient unit 拥有，30 分钟上限，退出回调只恢复已核验归属的 IndexTTS unit；没有重启整个 WSL 或清除 systemd 启动限额。生产语音配置保持线上主用、IndexTTS 备用，测试没有向直播或游戏发送声音/消息。

结束时 IndexTTS unit PID 5509、active、NRestarts=0；音色注册仍在，真实中性 PCM 恢复探针成功，首条 22.149 秒包含新进程预热。VoxCPM2 测试 unit 已不存在，权重和独立环境保留供后续复测。生产备用 JSON 的 SHA-256 与测试前完全相同；主服务、原生游戏及 3090 模型的 PID/创建时间均保留，游戏在线 HP19 / food17。私有原始记录在 `runtime/voxcpm2-test/`；此次专项检查没有覆盖原先的全量小时巡检时间。

## 官方依据

- [OpenBMB/VoxCPM：克隆、原生 48 kHz 及流式接口](https://github.com/OpenBMB/VoxCPM)
- [官方模型](https://huggingface.co/openbmb/VoxCPM2)
- [固定 Omni 配方](https://github.com/vllm-project/vllm-omni/blob/a8576ccb725c4e21cd13c3eb5f9a546b21149d2b/recipes/OpenBMB/VoxCPM2.md)
- [官方部署说明](https://voxcpm.readthedocs.io/en/latest/deployment/vllm_omni.html)

官方 4090 的速度指标不直接用于推断本机 3080 Ti 的表现。
