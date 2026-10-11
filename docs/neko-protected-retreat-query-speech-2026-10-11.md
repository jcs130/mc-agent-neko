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

The live reload also exposed a separate local refusal: the global missing-pick
guard rejected the floor's andesite stairs before any server protection query.
That failure was swallowed inside the retreat, which retried immediately.
The guard now retains its actual exact target, block name, world and time.
The same measured handoff accepts this evidence for up to two minutes only
while the same floor remains and the inventory still has no pickaxe. Obtaining
a pickaxe invalidates it immediately. Recovery distinguishes missing tools
from server protection; it never reports the former as a server refusal.

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

After the live-discovered asset-startup and missing-pick cases, the complete
native suite passed 743 cases; focused recovery tests passed all eight cases.

## Runtime acceptance

The host source was loaded by owned main/plugin PIDs 42460/32340 at 09:40
Beijing time. The first lifecycle attempt encountered HTTP 500 on
`/api/agent/state` while bootstrapping; its existing recovery path restored
ready services. The attempted script itself was not a clean pass. Subsequent
deep health confirmed one ready desktop connection, one live TTS client and
an empty speech queue; natural voice delivery receipts were observed.
Physical audible completion and the separate desktop play-end receipt
watchdog remain unverified by the query-prelude change.

Before the final missing-pick reload, a 95-second natural observation captured
96 game frames with health/food 20. The protected-floor recovery emitted a
measured 15-second handoff, mobility became FREE and maximum displacement was
3.43 blocks. The public-supply task nevertheless failed its deadline; this is
not evidence of productive escape or completed provisioning. The first
capture's inventory list was unavailable because the collector used the wrong
field; it must not be interpreted as an empty inventory.

At 09:54, the missing-pick repair (fork `48eaed4`, native `9834ad2`) was loaded
at a measured idle boundary using the existing owned native-child lifecycle.
Native PID changed 38252 to 20220; main, plugin server, MindServer and local
Qwen PIDs were preserved. VoxCPM2 remained PID 6619 in WSL, with zero unit
restarts. A subsequent 95-second, 96-frame sample had health/food 20, unchanged
inventory and no displacement. Native logs identify this interval as a bounded
sealed night hold; no missing-pick retry occurred during it. That sample
therefore cannot verify the new tool-refusal handoff or successful survival.

T-0006's actual pre-reload occurrence baseline was 325. The maintenance bridge
retains a **deployed** receipt; writeback is pending because occurrences changed
before acknowledgement. No ticket was closed or promoted to verified.

Local evidence: `runtime/repair-20261011-0915/host-deployment.json`,
`native-final-deployment.json`, `natural-game-observation-before-tool-guard.json`,
`natural-game-observation.json` and the named regression logs. Unit tests alone
do not establish successful trading, crafting or autonomous survival. A
transient connection reset recovered through the existing guardian; no
server-side cause is inferred. No public chat or diagnostic game task was sent.

## Plugin handoff Regression Report

**Before:** the native's new `protected-retreat-stall` and `tool-retreat-stall`
were present in raw observations, but the focused view allowlist retained only
the older swimming recovery. A live daytime observation confirmed that the
body had yielded while the host continued query-only rounds. The older
natural-language busy latch could also consume the short handoff window.

**After:** plugin patch 0068 retains each measured type, constraint, original
times and next-step evidence within all four focused modes and the existing
token budget. A fresh, explicitly idle native handoff with a valid interval
of at most 60 seconds outranks only the old natural-language latch. Actual
activity and pending tasks still win; unknown, stale, expired and malformed
handoffs receive no exception. This does not authorize a task or force a skill.

**Validation:** the regression first failed nine assertions/subcases. Both
related files then passed 27 tests and eight subtests; the complete Minecraft
plugin suite passed 226 tests and 26 subtests. All 68 plugin patches and 11
host patches reproduce source `f21df6a0ac274ea77f9716c5f0ebb7e448903681`,
its declared plugin tree and all 41 affected host files, with 79 hashes checked.
The source change is plugin-only and needs no main/model/game restart.

Local regression evidence: `handoff-context-red.log`,
`handoff-context-green.log`, `plugin-full-handoff-regression.log` and
`bundle-final-proof.json` under `runtime/repair-20261011-0915`.

## Final query opportunity and current recovery priority

Natural observation after patch 0068 still showed catalogue-only decisions and
no displacement in 96 frames over 95 seconds. The ordinary tool loop was
classified, but its last optional tool opportunity still streamed a prelude
before the actual receipt. The exact observed `/mycli village villagers`
catalogue also lacked read-only reply metadata. The new regression reproduced
both gaps; no query is accepted as quest completion or proof of escape.

Host patch 0012 applies the same receipt-based buffer to that existing final
opportunity. Explicit read-only queries are quiet; actual actions, unknown
receipts, real final answers and stop remain deliverable. Cancellation after
the receipt cannot flush an old prelude. Native reply metadata recognizes only
the exact village-list form; `serverQuery` permissions are unchanged and
mutation/unknown suffixes remain conservative. Six final-opportunity speech
cases, the complete 140-case tool suite, 137 cancellation/budget cases and all
13 server-command tests passed. The final native discovery suite passed 743.

Plugin patch 0069 routes only a currently valid, explicitly idle measured
retreat window to the existing survival context. Its current escape priority
precedes unrelated quest/catalogue work in both the cue and observation
decision contract. It preserves stop/authorization, prerequisites and player
communication; outside that window normal gameplay context remains unchanged.
The model still chooses a feasible action: no skill, coordinate or forced tool
is injected. Full plugin regression passed 227 tests and 26 subtests after a
red priority-routing case.

The final companion series has 69 plugin and 12 host patches. All 81 hashes,
the declared plugin tree and 41 affected host files replay to N.E.K.O. source
`bf4b3c6fdb72fe13a5787cbffd5c6470c009b0b7`. The final deployment and natural
acceptance must be assessed separately from these regression results.

At 10:24 Beijing time the final source was loaded once at an observed idle
boundary. The previous natural trade task had already ended. Main/plugin/native
PIDs became 39784/44304/26184; Qwen 37292, MindServer 37492 and VoxCPM2 6619
(zero restarts) were preserved. Startup needed one bounded API-readiness retry.
Both actual LAN streams then delivered 183 avatar frames, 81 chunks, 28/28 mana
and nine abilities without errors; the rendered page confirmed 28/28.
A 95-second/96-frame observation still had zero displacement and unchanged
inventory, with health/food 20. A nearby merchant was opened naturally, but its
offers did not buy iron. Neither that failure nor an open window proves escape.

## Mixed game callback Regression Report

**Before:** after the final reload, actual host metadata still recorded
`minecraft` for batches containing idle/completion and game-attention cues.
The host required every key to be an execution key, so received player/server
feedback bypassed the execution receipt and query-prelude paths when batched
with an idle cue. This is an additional routing bug, not evidence that incoming
messages should be discarded. The separate 45-second voice-play-end watchdog
also occurred and is not fixed by a scope change.

**After:** host patch 0013 retains `minecraft_execution` when an already
deliverable, entirely trusted Minecraft batch includes an idle/completion cue.
Attention-only batches stay `minecraft`, foreign batches remain unscoped, and
expired/retracted cues are still removed before classification. All delivered
player/server text is retained. Task authorization, stop, current body ownership
and optional tool choice remain unchanged; there is no extra model request.

**Validation:** the real callback delivery regression failed the two mixed cases
before the fix; the five boundary cases already passed. All 492 callback,
delivery, tool, cancellation and budget tests then passed. Scoped companion
replay and live acceptance are recorded separately from those unit results.
