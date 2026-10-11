# Collection cancellation and autonomous task recovery

## Observed problem

On 2026-10-11 the externally controlled game executor repeatedly timed out
while collecting wheat. `ActionManager.stop()` requested cancellation for
15 seconds, then logged `Code did not stop after 15s — forcing release +
reconnect (NO process exit).` The connection was replaced even though the
process stayed alive. A continuous 45-second observation also found no
movement, inventory change or active action, with health and hunger at 20.

The Neko host intentionally clears per-session outcome history on a new game
session. Thus these forced reconnects also removed failure feedback that the
planner needed. This is an executor cancellation defect, not evidence of a
server outage. Missing currency, insufficient wheat and absent pickaxes are
separate real planning prerequisites; cancellation alone does not solve them.

## Mechanism and change

`collectBlock()` checked interruption only at the bottom of its outer loop.
Failed/gone dig targets and several exceptions used `continue`, bypassing
that check. Asynchronous scans could also finish after cancellation and start
another equipment/dig operation. The reproduction performed 16 dig attempts
after the first attempt requested cancellation.

The primitive now checks interruption, death and action-generation ownership
at retry boundaries and after asynchronous preparation, before starting the
next body operation. It does not detach running promises. Real inventory gains
still determine its boolean result. Permission filters, safety gates, retry
limits, threat reflexes and the 15-second terminal stop watchdog are retained.

This improves the local main-brain/executor loop without adding model calls,
raising wake-up frequency, switching models or expanding the context budget.

## Validation and acceptance

- Initial regression: 11 tests, 3 pass / 8 fail. Error/gone cancellation
  expected one dig but observed 16; cancelled scans could still equip and dig.
- Focused cancellation, ore harvest and action-stop suites: 24 pass / 0 fail.
- Final contribution suite after two extra inventory/protection cases:
  `node --test`, 773 pass / 0 fail, exit 0. Counts overlap.

Deployment and natural observation are separate acceptance gates. The
falsifiable prediction is that cancelled collection stops without another
retry/body operation or an `action-refused-stop` reconnect caused by this
loop. A completed commission, useful collection, trade or combat requires its
own received result; motion or a correctly formatted command is insufficient.

## Received failure companion

The next real trade failure exposed a second boundary: the task outcome
included `Not enough payment items at the received current price. No trade
executed.` only in its command appendix. The 110-token feedback projection
removed that appendix entirely and left a generic repetition warning. The
same loss occurred for `Collected 0 wheat.` after a deadline and a missing
pickaxe refusal followed by successful navigation.

Plugin companion patch 0070 keeps one bounded received action result beside
the report, preferring the last explicit failure over later navigation-only
success. It marks that text as game data, not instructions; duplicate receipts
and inventory appendices do not consume the budget. Ordinary reports and raw
observation queries retain their existing behaviour. No model calls, tools or
permissions are added.

The three new reproductions fail before this change. Afterward the focused
suites pass 30 tests and 11 subtests; the complete Minecraft plugin suite
passes 230 tests and 26 subtests. Ruff and whitespace checks pass. The full
companion replay verifies all 86 patch hashes, the complete plugin tree and
46 scoped host files against the saved Neko source commit. Counts overlap.

The native cancellation fix was loaded at an observed safe idle boundary.
The main brain, plugin server, model, MindServer, voice unit and spectator
remained running. Its subsequent two-minute natural observation was online
throughout with health/hunger 20, but still had no inventory change or
displacement. This establishes that cancellation alone does not fix planning;
it is not productive-gameplay acceptance.

## 回归报告 / Regression Report: mixed execution rendering

**Change and necessity:** real callback batches combine `mc_keep_going` with
Minecraft player/notification attention. The existing scope classifier
already treats those trusted batches as execution turns, but the renderer
reintroduced the generic "respond to the master first" header for attention.
Host companion 0017 makes active event headers neutral only when that same
trusted Minecraft batch contains a deliverable execution cue.

**Before/after:** 16 cases across eight languages and both callback orders
reproduce the contradictory header. They now retain both the execution policy
and the exact player greeting/offered-equipment text without that wrapper.
Pure attention still invites a normal response; passive drain, foreign-source
batches and task-result reporting keep their previous semantics. Grouping,
message order, origin, stop policy and chat tools remain unchanged.

**Potential regressions:** mixed social/execution turns might respond less
promptly to players. The original player content and communication policy are
retained, with explicit ordering and source-boundary tests. No forced tool
choice, extra calls, new permissions or higher decision frequency is added.

**Validation:** the renderer suite passes 42 cases. Related proactive delivery,
callback origin, tool-loop, cancellation, joint-emotion and budget regressions
pass 1626 cases, with only existing deprecation warnings. Ruff passes. The
complete companion series replays to the saved source plugin tree and 46 host
files. Live deployment and actual productive gameplay remain separate gates.

## Final deployment and natural limits

- Native commit `810ae103635aefaed07e1c3541cd0c28ae999962` loads the cancellation
  change from contribution commit `6b56edab76abaaa18d7119e9b6129cd6524b6a05`.
  The actual runtime full suite passes 719 cases; contribution full suite 773.
- Neko commits `e501511852c0fb483a79b6d53cf74f9b7c842d61` (received feedback),
  `fb5f33f1c852e817d089291cdb9f7d17382127c1` (mixed rendering) and
  `06ffd04f36688184db05b9223fadcdbc917e5dca` (classified success) are deployed.
  Plugin patch 0071 uses the host-classified outcome status so a successful
  recovery does not replay an earlier failed attempt as a current blocker.
  This arose naturally when an initial chest-open timeout was followed by a
  successful four-bread storage operation. Two more regressions fail before
  the status-aware change; the final plugin suite passes 232 cases/26 subtests.
- The final complete companion replay matches the plugin tree and 46 host
  files, with all 88 patch hashes checked. The 1626 host regressions above
  cover the unchanged host rendering patch; counts are overlapping.
- A natural task stored four bread, and the received inventory changed from
  seven to three. This is an observed material transfer step, not a claim that
  the server accepted or settled the entire food commission.
- After all changes, 97 samples over three minutes stayed online with health
  and hunger 20. Maximum displacement was 21.17 blocks; observed actions
  included `showVillagerTrades` and self-preservation. Inventory did not change
  in that final window. The iron-selling task still ended at its deadline.
  Repeated planning around unmet merchant/material prerequisites remains open;
  successful trade, commission settlement and autonomous combat are unverified.
- One later LoginGuard network-loss reconnect occurred. It was not an
  `action-refused-stop` reconnect; a single loss does not establish a server
  fault. Session-scoped permissions/outcomes were not copied into a new world.
- Main/model/MindServer/voice/spectator continuity was preserved during the
  native reload; the host reload preserved the native process and game session,
  model and voice. The final plugin-only reload preserved its game session and
  every listener PID. No game action or chat was manually injected.
- The existing authenticated live listener was restored via its normal entry.
  An initial connection attempt hit actual DNS/transport errors; one bounded
  retry after DNS recovery returned authenticated receiving/listening. No QR,
  credentials or test messages were generated.
- Playback-end watchdog messages still occur; audible continuity and the
  associated delay remain open. The broad autonomy ticket is deployed, not
  verified or closed. No extra model calls, higher wake frequency, model switch
  or inference-slot changes were introduced.
- LAN observation received 183/182 avatar frames and 81 chunks on both viewer
  sockets, plus a skills snapshot containing mana 28/28 and nine abilities.
  That skills snapshot was marked stale, with nine unknown cooldowns; this
  verifies frame transport and preserved data, not fresh cooldown telemetry.
- A later purchase task received the server's specific supplier location.
  Navigation reported arrival, and a fresh state placed the agent within three
  blocks of that location, but the overall purchase task ended at its deadline
  without a verified purchase. Arrival must not be counted as settlement or
  mislabelled as a proven navigation failure. The following three-minute
  observation had no movement; continuous productive autonomy remains open.
- Closeout: the repair package was pushed and remote-head checked. T-0006
  retained its actual pre-change occurrence baseline 352; the maintainer API
  confirmed a `deployed` receipt. This records deployment without closing the
  ticket or asserting full runtime recovery. Private evidence and the hourly
  comparison baseline retain both productive and unsuccessful windows.
