# NEKO YUI YSM 首版验证记录

2026-10-11，北京时间。目的：为 ag_NEKO 创建可部署的 YSM 外观，保持正在运行的游戏、模型、主脑、语音与观战连接连续。

## 实际通过的检查

- 7 个资源，合计 98,078 字节；JSON 为 UTF-8 无 BOM，路径与文件名大小写一致，所有资源 SHA-256 对应清单。
- 原始纹理与已批准的 64×64 YUI skin 字节完全一致；UV 均在范围内，饰品的颜色取样均为不透明像素。
- 主模型 49 个骨骼、168 个立方体；第一人称手臂 8 个骨骼、16 个立方体。骨骼无重名、无缺失父骨骼或环；装备/视角定位组存在。
- 31 个主动画、14 个手部条件动画、3 个轮盘动画的引用骨骼、数字关键帧与必要动作名称通过检查。
- 使用共享 renderer 源码（pin `b71e0f56`）的 `createNativeBedrockModel` 导入主模型与手臂。`applyPaperYsmAnimation` 对全部 31 个主动画各采样 5 个时刻，共 155 次，无非有限变换或不支持的通道。
- 用生产 `decodeYsmBundle` 检查明确标为离线构造的资源包：gzip 为 18,101 字节，源文件完整且哈希一致。没有把该离线包注入正式连接。
- 独立浏览器实际渲染导出的几何和原贴图，核验正面、侧面、背面、跑步、招手，控制台无 warn/error。首次预览发现裙摆缝隙与正背标签错误，修正后重验。`neko-yui-preview.png` 来自该实际渲染画布。
- ZIP 13,358 字节、7 个根资源条目，CRC 与解压字节逐项通过；根目录有 `ysm.json`。SHA-256：`dabb81be3a60a8a9927553e8ca53b975f8c5ab999bd5b71f8083d3e6e861b10e`。

运行命令：

```powershell
$env:NEKO_YSM_RENDERER_ROOT = '<已安装依赖的共享 renderer-src>'
node models/ysm/build-neko-yui.mjs
node models/ysm/verify-neko-yui.mjs
python models/ysm/pack-neko-yui.py
git diff --check
```

## 尚未验证的边界

本机没有可用的目标正式服 Worker 上传/管理入口，因此没有声称服务器已接受该包、ag_NEKO 已绑定，或原生客户端显示已通过。主/副手、第一人称、护甲/其他模组的最终显示，原生 YSM 动画控制器组合、潜行与睡眠的位置、服务器实时动画状态同步，均须安装后在实际客户端验收。

当前 Web 是 YSM 原始 Bedrock 几何和数字关键帧的支持子集。模型为该子集制作，无任意 Molang 表达式；这不等于原生 YSM 完整渲染一致性。正式服仍以权威外观包及真实资源哈希为准，没有设置本地假绑定或覆盖游戏皮肤回退机制。

只启动了独立 loopback 模型预览进程；未重启、接管或向主游戏/语音发送测试动作。
