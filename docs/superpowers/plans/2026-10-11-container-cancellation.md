# Container cancellation Implementation Plan

> **For agentic workers:** Execute this plan task by task in the existing session under the user's authorized hourly repair workflow. Preserve the running local model, main brain, voice and spectator.

**Goal:** Let chest inspection yield promptly to safety interruption without forcing a reconnect or reporting an unopened container as empty.

**Architecture:** Keep ActionManager's terminal watchdog. Replace the chest skills' non-cancellable open wait with an owned, bounded wait for Mineflayer's initialized window event; gate interaction on successful navigation and preserve foreign windows.

**Tech Stack:** Node.js, Mineflayer 4.37.1, prismarine-windows, node:test.

**Spec:** docs/HANDOFF.md sections 1, 2 and 7; docs/local-autonomy-cancellation.md. Actual observations: 2026-10-11 Beijing 20:26:36, 20:34:47 and 20:43:28, viewChest preempted by self_preservation then action-refused-stop reconnect. Mineflayer waits 20 seconds while the terminal stop watchdog waits 15 seconds.

## Global Constraints

- No extra model calls, game tasks, chat, server commands or inference changes.
- No dependency updates; preserve unrelated source and runtime data.
- Do not infer server failure or a protection denial from an absent window.
- Do not remove the terminal stop watchdog or change safety preemption.
- Stop/reload only the exact owned native executor at a fresh safe boundary.

## Review Focus

- Missing/rejected window must fail within six seconds, without listener leaks.
- Cancellation, death and disconnection must settle before the 15-second watchdog.
- A late or unrelated window must never be closed by a retired operation.
- Unreachable targets and existing foreign menus must cause no new interaction.
- Successful opening must retain Mineflayer's real initialized container methods and inventory data.

### Task 1: Cancellable chest interaction

**Files:** Create src/agent/library/container_windows.js and test/container_cancellation.test.mjs; modify src/agent/library/skills.js, bots/_supervisor/CHANGELOG.md and docs/local-autonomy-cancellation.md.

**Interfaces:** openChestWindow(bot, block, {timeoutMs=6000, pollMs=100, generation}={}) resolves an initialized container window or rejects a coded error. closeOwnedChestWindow(bot, window, generation) closes only when bot.currentWindow is that exact object and the captured action generation is current. Existing viewChest/putInChest/takeFromChest retain their Promise<boolean> interfaces; !viewChest now propagates false through runAsAction.

- [x] Reproduce viewChest ignoring interruption and failed navigation using its actual source function. Eight tests fail before the change without hanging the suite.
- [x] Implement the owned wait using windowOpen/end events, interrupt polling and a six-second deadline. Remove only owned listeners/timers at settlement. Observe activateBlock rejection, and use the already extended event window instead of leaving openContainer's hidden waiter behind.
- [x] Gate each chest skill after navigation; log explicit opening failure and never call a timeout an empty container. Close successful windows in finally only while still owned; propagate the command's boolean result.
- [x] Cover success, timeout, cancellation/death/end/generation, activation rejection, late/foreign windows and unreachable navigation; real Mineflayer inventory packets prove slot and method initialization.
- [ ] Run focused container, action reconnect, combat window and collection cancellation suites; inspect diff and commit only scoped files.

### Task 2: Deployment and attribution

**Files:** Private runtime/hourly-20261011-2043 evidence, logs/hourly-inspection.log and hourly-check-state.json; no private artifacts committed.

- [x] Record T-0068 occurrences=1 before source changes in the private container-ticket-baseline.json.
- [ ] Transfer the tested commit to the existing native checkout while preserving its unrelated arbitration file. Check native tests and file hashes.
- [ ] Use the existing owned native-child restart mechanism once, after repeated full-health safe idle observations; verify main/plugin/model/voice/spectator identity continuity.
- [ ] Observe natural online actions and results, separate unit proof from actual successful container opening. Submit prepared/deployed/verified receipt only for evidence actually obtained.
- [ ] Push to contribution-fork, confirm remote SHA, update the inspection comparison baseline and report the actual remaining acceptance limits.
