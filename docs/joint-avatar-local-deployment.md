# One main-brain reply with emotion: local deployment

The matching N.E.K.O. companion patch now implements the experiment proposed in [the avatar call audit](neko-avatar-calls-2026-10-10.md). It targets deployments where game execution, the main brain and optional UI classifiers share one local inference service.

The main offline reply emits a short canonical emotion header followed immediately by normal streamed text. The backend removes the header before speech, subtitles, history and tool bookkeeping, and sends a structured `reply_emotion` field with the visible turn. The frontend uses the existing emotion-to-expression/motion mapper directly. Missing or invalid metadata falls back to neutral; it does not trigger another emotion request. Realtime-provider compatibility is retained.

Ordinary replies, task callbacks and proactive Phase 2 replies are covered. Tool calls retain their native schemas, and actual tool feedback can still require another model turn. No model, thinking depth, GPU, KV cache or inference-slot setting is changed. Idle animation, blinking and lipsync remain frontend behavior.

The companion's `docs/regression-reports/2026-10-11-joint-reply-emotion.md` records rationale, before/after behavior and regression boundaries. Targeted validation passed 395 Python and 19 frontend cases. One-request replay and zero-classifier frontend replay establish request removal; end-to-end aggregate speed and subjective expression quality still require observation under normal play.

## Shared visualization refresh

Renderer pin: `79ddc629` from `jcs130/mc-visual-console` (five commits after `06ca0f16`). The reviewed Cortico host pin is retained; unrelated gameplay changes are not imported. The Java 1.20.6 browser assets are rebuilt, rather than merely updating provenance JSON.

The update includes occupied-session recovery, photo mode (`/?photo=1`), OBS transparent native-HUD overlay (`/?obs=1`), and server-supplied YSM appearance/assets. The appearance bridge observes the existing action connection and releases subscribers/listeners on shutdown. Spectator-state registration is explicitly opt-in (`modern_viewer_observer_state: true`), intended for a server-supported observer integration; normal ag_NEKO viewing remains passive. The server must supply supported packets for observer/YSM content to appear. Neither renderer updates nor a successful HTTP page load prove server support.

An optional local own-avatar skin can be configured with `modern_viewer_self_skin` (64×64 PNG, at most 128 KiB) and `modern_viewer_self_skin_model` (`slim` or `classic`). It affects the connected bot in this visualization and preserves other players' server skins. This is separate from uploading a skin to the Minecraft server.

The local adapter serves this texture through the renderer's trusted hashed `/head-texture/<sha256>.png` route. An arbitrary image URL is deliberately rejected by the shared renderer; receiving skin metadata or successfully fetching a PNG alone does not establish that it was applied.

## Deployment evidence, 2026-10-11 (Beijing time)

At 02:32 the owned Neko host was restarted at an idle reply/task boundary, followed by the desktop at 02:34. The native game, MindServer and local inference process identities were preserved. The desktop reconnected ready with one live connection. Natural main-brain replies emitted turn-scoped emotion metadata at 02:32:41 and 02:35:55. The matching served frontend source was checked against the committed file. These observations establish deployment and metadata delivery, not a human assessment of rendered Live2D expressions or an aggregate latency improvement.

The renderer was refreshed without reconnecting the Minecraft action player. LAN verification checked the rebuilt browser bundle SHA-256, both socket paths with three fresh avatar frames each, original chunk packets, and the exact YUI skin bytes. An isolated browser loaded the texture and reported the matching slim skin as `applied`; the dungeon view and OBS overlay rendered without page errors. The first screenshot caught a default-skin fallback caused by the unsupported URL shape, which prompted the trusted-route correction and another integration/visual check. This is why skin application is verified separately from HTTP availability.

The [YUI skin and front/back preview](../skins/README.md) follow the active `yui-lolita` Live2D: dark twin tails, blue eyes, pale blue/white dress and black accents. The visualization now uses it. An offline server's global skin requires its supported upload mechanism; this change does not publish a local filesystem path or change what other players see.
