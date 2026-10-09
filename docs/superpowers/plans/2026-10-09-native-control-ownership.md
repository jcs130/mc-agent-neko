# Native control ownership repair implementation plan

**Goal:** Prevent expired native task continuations and overlapping old/new body skills while retaining explicit Neko tasks, player commands and survival reflexes.

**Evidence:** The live log replay `D:/neko-mc-trial/replay-interrupt-evidence.py D:/neko-mc-trial/mc-interrupt-before-20261009.log` fails on three system commands after mission `365f5a19a0aa420497d5a96bcfbf6837` ended. A fresh snapshot also shows `action:collectBlocks` alongside old kernel `chopWood` digging oak while the current mission requests copper. The log contains necessary creeper survival interrupts as well; these must remain enabled.

**Architecture:** `Agent.handleMessage` admits autonomous native turns only while they have authority, and rechecks after asynchronous boundaries. `AdminMission.end` invalidates its generation synchronously. `AdminMission._drive` starts only after confirmed body release; timeout/error is reported honestly rather than starting a competing action.

**Tech stack:** Node.js ES modules, node:test VM fixtures using the actual Agent/AdminMission implementations; existing Windows trial services.

**Scope:** Reuse the MC information worktree. Preserve the Neko plugin, local model, public/private chat policy, protection checks, survival modes and runtime arbitration data.

## Steps

- [x] Capture the live interruption evidence and establish a reproducible failing replay.
- [x] Add `test/native_control_ownership.test.mjs` reproductions for orphan system prompts, delayed model replies after mission completion or owner changes, and refused/failed body handoffs. Include positive standalone and current-mission controls. Before the fix, 9 of the first 12 tests failed on the observed race; the 3 positive controls passed.
- [x] Update `src/agent/agent.js` to recheck native authority after awaits before producing or executing output. Update `src/agent/admin_mission.js` to invalidate ended turns and fail closed on incomplete body preemption.
- [x] Run the regression tests before/after the fix, affected lifecycle/chat/protection tests, and inspect the diff before committing. All 89 tests passed; evidence: `D:/neko-mc-trial/native-control-ownership-tests-20261009.tap`.
- [ ] Deploy the committed change to the owned MC service, restore unattended play, verify fresh Neko/model/viewer health, and capture a new read-only observation. Keep the historical failing trace intact.

### Live follow-up: cancellation signal

The first deployed observation confirmed that unsafe overlap was blocked, but a real new task was refused because the old `chopWood` had not released within two seconds. Source tracing found `digToSurface` can clear the shared flag while its persistent `_superseded()` guard remains unchanged: native `Agent.requestInterrupt` did not bump `_chopGen`, unlike the existing external WebSocket cancel. Two added regression tests initially failed: the actual skill guard remained false after native cancellation, and a dig exception prevented downstream path/PvP cancellation. Repair the shared native cancellation entry, retain the confirmed-release guard, and redeploy after the affected suite passes.

## Review focus

- An ended mission cannot revive its old goal after a slow model call returns.
- A native system prompt in a gap between kernel skills cannot start a second autonomous controller while Neko owns decisions.
- A new owner/skill taking the body during a model await cancels the stale response before publishing or executing it.
- A current mission and a standalone agent must still execute valid commands.
- A failed body handoff must leave the old lock intact and avoid starting new work or ending a replacement mission.
- Survival reflexes continue independently; this repair does not remove real threat interruptions or solve every pathfinding failure.
