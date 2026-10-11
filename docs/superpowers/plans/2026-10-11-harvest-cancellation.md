# Harvest cancellation and autonomous recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop cancelled collection work before another scan or body action, so task deadlines do not force game reconnections and discard the main brain's failure context.

**Architecture:** Keep the existing main-brain/native-executor split. Repair cancellation at the collection primitive's retry and asynchronous boundaries, then observe natural task outcomes before deciding whether another layer needs a change. Keep inventory-delta completion, permissions, threat reflexes and the bounded stop watchdog.

**Tech Stack:** Node.js ES modules, node:test and VM fixtures; Windows PowerShell lifecycle; Python Neko host.

**Spec:** User's request for autonomous commissions/combat; docs/HANDOFF.md sections 1, 2 and 9.1. Evidence: runtime/autonomy-20261011-1500 under the private trial root, including 45 seconds without movement or inventory changes and action-refused-stop reconnections after collectBlocks deadlines.

## Global Constraints

- Use the local Qwen service on RTX 3090; no model, inference, heartbeat or cloud-routing changes.
- Do not drive the game manually or fabricate quest, inventory or world state.
- Preserve unrelated working-tree files and the spectator client.
- Use owned lifecycle recovery only, with safe deployment conditions; do not interrupt a healthy long action.
- Keep failure observations scoped to their session; no unverified transfer across worlds.
- Execute sequentially in this session under the user's existing repair authorization.

## Review Focus

- Cancellation while an asynchronous scan resolves must prevent subsequent equipment/digging.
- Failed/gone dig branches must not bypass cancellation through continue.
- Death or replacement action ownership must prevent old-body work from resuming.
- Legitimate retry and successful inventory gains must still work.
- Empty scans, absent tools and protection refusals must remain failures, not fabricated progress.

### Task 1: Collection cancellation regression and fix

**Files:** Create test/collect_block_cancellation.test.mjs; modify src/agent/library/skills.js; update bots/_supervisor/CHANGELOG.md.

**Interfaces:** Consume collectBlock(bot, blockType, num, exclude, veinFollow), return its existing Promise<boolean>. Consume interrupt_code, death_abort, health and action generation; preserve the original inventory-delta result.

- [x] Add functional tests executing the actual extracted collectBlock function with controlled world scans, equipment and safeDig. Include `assert.equal(calls.digs, 1)` after safeDig requests interruption and returns error/gone; assert no equipment or dig when a scan is cancelled; assert successful retry returns true only after an inventory increment.
- [x] Run `node --test test/collect_block_cancellation.test.mjs` and retain the failing output outside Git.
- [x] Add an interruption predicate scoped to the captured action generation. Check it at loop entry, after scans/yields and before subsequent body actions. Do not reset interruption inside the loop or abandon running promises with Promise.race.
- [x] Run the new tests plus ore-harvest and action-stop regressions, then the complete `node --test` suite. Record commands, pass counts and exit codes.
- [ ] Document mechanism, falsifiable prediction and actual limits; commit only this change, its tests and documentation to the contribution fork.

### Task 2: Deploy and evaluate autonomous progress

**Files:** Private runtime/autonomy-20261011-1500 deployment/observation artifacts; docs/local-autonomy-cancellation.md for sanitized results.

**Interfaces:** Existing trial-lifecycle.ps1 and start-trial.ps1; Invoke-TrialPluginEntry 'game_agent_status'; native WebSocket read-only observations.

- [ ] Cherry-pick the verified native change into the trial executor while preserving unrelated modifications; run the runtime full test suite.
- [ ] Reload only the owned native executor at a safe idle boundary using the existing lifecycle deployment pattern and verify the loaded commit, online state and retained main/model/voice/spectator PIDs.
- [ ] Observe at least 90 seconds of natural state and task changes. Distinguish cancelled-action recovery from actual productive gathering, commission or combat success.
- [ ] If the brain still repeats an impossible plan, inspect the actual received failure/context boundary and add a separate failing test before changing that mechanism.
- [ ] Save sanitized evidence, update the inspection log and any applicable DSH receipt with the actual phase, then push the contribution fork. Do not claim completed commissions without server/inventory evidence.
