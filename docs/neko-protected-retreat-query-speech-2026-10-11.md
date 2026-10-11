# Protected retreat and autonomous query speech

The player remained stationary while native self-preservation repeatedly tried
to dig into a protected village house. The server had explicitly rejected the
same floor excavation; the existing confined-trap handoff did not cover this
open room. Some nearby endermen had stared-at metadata, so this repair does not
reclassify them as neutral or disable self-preservation.

The new native handoff requires an exact currently denied floor block,
unchanged world/target and less than two blocks of movement across at least
15 seconds and three observations. Only an authorized external planner can
receive the 60-second opportunity. Recent damage, low health, missing geometry,
low oxygen, fire, lava, interruption or a close creeper clear it immediately.
It emits one measured recovery event and retains the refusal and original
game state. It does not move, dig or cast on the player's behalf.

## Host Regression Report

**Before:** a single autonomous decision with three observation/server-query
rounds streamed the same inspection prelude three times. Each prelude was
eligible for TTS before the final answer, giving the impression of a repeated
audio file. The reproduced bug was duplicate generation delivery, not proof
of PCM playback duplication.

**After:** only the autonomous `minecraft_execution` scope temporarily buffers
pre-tool text. Actual receipts from `minecraft_observe`, or `minecraft_server`
with explicit `readOnly: true`, discard that round's spoken prelude. Results,
assistant/tool history and persistence markers remain intact. Ordinary chat
streams normally; action/mixed/unknown receipts and the final reply remain
deliverable. Cancelled generations cannot flush a stale prelude. There is no
extra model call, phrase blacklist or removal of received player messages,
private chat, gifts, server guidance or errors.

**Tradeoff:** autonomous game text waits until its round is classified. This
avoids speaking an inspection plan before knowing whether a real action was
issued. It is not a claim of improved model inference latency.

**Verification:** the query-prelude regression first failed in both observed
query cases; all 175 tool/cancellation/proactive-budget tests then passed.
Native production-dispatch and recovery boundaries pass in the complete
740-case suite. The companion is host patch 0011, source
`b218194ea8d3e4fff87e1a04fe395a6da9363814`; 67 plugin patches and 11 host
patches replay to the declared plugin tree and all 41 scoped host files,
with all 78 recorded hashes verified.

## Runtime acceptance

Deployment and natural observation are recorded here after the owned reload.
Unit tests alone do not establish successful trading, crafting or autonomous
survival. A transient connection reset during inspection recovered through the
existing guardian; no server-side cause is inferred. The separate desktop
play-end receipt watchdog remains a distinct acceptance item.
