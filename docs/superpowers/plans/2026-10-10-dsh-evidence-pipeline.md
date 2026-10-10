# DSH evidence pipeline implementation plan

> Execute sequentially in this authorized task, using the existing diagnostic and verification skills. Preserve the live game throughout.

**Goal:** Make real supervisor findings reach tickets reliably, with bounded, current evidence and an explicit repair handoff.

**Architecture:** Keep DSH observer, diagnoser and reviewer independent and read-only. The coordinator refreshes evidence after model admission, validates immutable citations and writes tickets; the hourly maintainer consumes a durable repair queue and records verified repair receipts. Neither a diagnosis nor a cleared detector constitutes a completed code repair.

**Tech Stack:** Node.js ESM, node:test, installed DSH, local OpenAI-compatible Qwen endpoint, existing ticket HTTP API.

**Spec:** `docs/dsh-supervisor.md`; user request to study and optimize the running supervision system.

## Global constraints

- Local `http://127.0.0.1:18030/v1`, `qwen3.8-flash-next-iq3_xxs`, RTX 3090, non-thinking; no model restart or provider change.
- No game commands or chat from monitoring. Model calls remain serial, yield to game inference, and have a five-minute minimum interval.
- Cached messages and previous-session events retain their original time; historical execution failures cannot prove a current freeze.
- Preserve unrelated working files and save changes to the user's `contribution-fork` branch.
- Deploy by restarting only the DSH coordinator and its owned monitoring children, after testing.

## Review focus

- An issue key differs from a fact ID: the reviewer must be able to accept that issue key.
- Model admission waits more than 90 seconds: capture after admission; preserve old citations without refreshing their timestamps.
- A failure is older than 90 seconds but happened since the last audit: allow explicitly historical execution analysis, never relabel it as a current stall.
- A session changes while roles run: reject the entire publication, even when current telemetry is fresh.
- A repair receipt is missing, failed, or refers to another ticket: retain the unresolved handoff; never auto-close.

### Task 1: Evidence and review contract

**Files:** `services/dsh-supervisor/core.mjs`, `services/dsh-supervisor/audit.mjs`, `test/dsh_supervisor.test.mjs`, `test/dsh_audit.test.mjs`.

**Interfaces:** `roleSchema(role, evidenceIds, issueKeys)`; `refreshEvidence(current, previous, now)` preserves timestamped IDs; `runAuditStages({ capture, runRole, tickets, ledger, now })` calls prompt factories after admission.

- [x] Add regressions for distinct issue keys, delayed admission, expired citations and changed sessions.
- [x] Run `node --test test/dsh_supervisor.test.mjs test/dsh_audit.test.mjs`; confirm the new cases fail against the existing implementation.
- [x] Separate accepted-key and citation enums. Timestamp observations, retain only cited previous facts, and re-age them before each role/publication.
- [x] Run the same tests and `node --check services/dsh-supervisor/app.mjs`.

### Task 2: Execution history and scheduling

**Files:** `services/dsh-supervisor/core.mjs`, `services/dsh-supervisor/app.mjs`, the same tests.

**Interfaces:** `executionRevision(events, now)`; issues carry `scope: current|execution`; `auditDue(state, tickets, now, executionRevision)` retains the existing cooldown.

On-site follow-up: the first real audit confirmed the repaired publication path but treated expected failures as repair work. Add independently constrained `actionableKeys` and require both factual acceptance and repair necessity. The sentinel also replayed old pin events after restart: add `bots/_supervisor/event-cursor.mjs` and `test/supervisor_event_cursor.test.mjs`, mirror these source files to the native checkout, and retain the exact timestamps/IDs until API confirmation. Validate with the installed DSH schema validator (`test/dsh_schema_compat.test.mjs`), since its subset rejects standard `maxItems`.

- [x] Add failures for repeated receipts with different task IDs, a fresh poll containing old failures, and unchanged failures during cooldown.
- [x] Preserve stable execution IDs and compact failure groups with first/last occurrence and distinct task counts. Permit bounded historical execution citations only for execution-scoped findings.
- [x] Capture the execution revision actually inspected; later failures remain pending. Rotate already-reviewed tickets fairly.
- [x] Clear resolved connection errors only when a real fresh game frame arrives; report rejected publication reasons.
- [x] Run targeted tests, then all `node --test` tests.

### Task 3: Repair handoff and deployment

**Files:** `services/dsh-supervisor/repair.mjs`, `services/dsh-supervisor/app.mjs`, `test/dsh_repair.test.mjs`, `docs/dsh-supervisor.md`, `bots/_supervisor/CHANGELOG.md`.

**Interfaces:** `buildRepairQueue(tickets, receipts, now)` produces unresolved work; `recordRepair` saves commit/check/deployment facts and writes a clearly labeled ticket comment without closing or taking ownership.

- [x] Add regressions for failed checks, wrong-ticket receipts, uncertain API writes and repeat receipt submission.
- [x] Produce a durable queue and a documented CLI receipt path for the existing hourly maintainer. Keep diagnostic and repair state separate.
- [x] Record evidence, hypothesis, falsifiable prediction and validation in the changelog.
- [x] Run targeted and full regressions; review the explicit diff and commit only the planned files.
- [x] Gracefully replace only this monitoring service. Observe real role completions, refreshed evidence and ticket API writes; prove deployment targeted only owned monitors and separately record any external process changes.
- [x] Push to `contribution-fork`, record inspection proof and report the actual result and remaining limits.

### Task 4: Live output-budget failure

The 10:17 observer hit its 512-token output cap during a Unicode-escaped Chinese summary, before serializing required fields. Preserve the failed acceptance record, use bounded role budgets (2048/1024/1536), shorten the requested prose, and synchronize provider limits. Keep non-thinking, serial admission and the five-minute cooldown. Treat detector/ticket conclusions as hypotheses rather than independent proof.

- [x] Reproduce the insufficient provider budget with a failing regression, then pass the targeted gate (41 tests).
- [x] Run full regressions, commit, and replace only the owned monitoring processes.
- [x] Observe three actual role completions, candidate/actionability validation and confirmed ticket writeback; record the final runtime proof.

Process continuity means this maintenance does not stop game or model processes. Separate model-process changes observed at 10:03 and around 10:23 must be recorded truthfully; they are not evidence that all process identities stayed unchanged.

## Final acceptance, 2026-10-10 10:35 CST

- Fork full suite: 621/621; native sentinel suite: 578/578; targeted suite including the installed DSH validator: 41/41. Logs are immutable under `D:/neko-mc-trial/logs/dsh-output-budget-{full,green}-20261010.log` and `dsh-optimization-native-cursor-20261010.log`.
- Actual audit `1791599620328`: observer, diagnoser and reviewer completed in distinct DSH sessions; all stage frames belonged to the restored game session and were 0.4–1.4 seconds old. Model inference was about 8 seconds per role; admission waits were 26.1/4.0/0.0 seconds. The coordinator confirmed diagnosis writeback to T-0004.
- The observer proposed two 48/58-minute-old failures. The 30-minute execution gate rejected both; the reviewer was uncertain and no new ticket was published. Raw model identifiers without a validated candidate do not grant publication authority. Normal failures/old freeze hypotheses were not treated as current engineering faults.
- Sentinel cursor survived both monitor replacements, without cached pin replay; the real new pin remained recorded. Repair receipt v4 was verified using hashed runtime proof; repeating the exact receipt kept comment count 9→9 and returned duplicate=true. T-0008 was closed by the external maintainer after this acceptance, not by a model.
- `D:/neko-mc-trial/logs/dsh-optimization-live-proof-20261010.json`, `dsh-repair-idempotence-live-20261010.json`, `dsh-optimization-process-final-20261010.json` and `dsh-optimization-viewer-final-20261010.json` preserve the actual checks. LAN stream after reconnect: 81 chunks, 179 avatar frames, no stream errors.
- Only owned monitoring processes were replaced. The server announced planned maintenance at 10:28; existing recovery restored the game around 10:31, and the cross-session audit correctly aborted. Separate local model PID replacements were observed at 10:03 and 10:21:57; this maintenance did not restart them. Main Neko/plugin remained running. Existing gameplay tickets and prior audio/live verification limits remain separate.
