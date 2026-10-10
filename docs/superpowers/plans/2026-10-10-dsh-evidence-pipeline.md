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

- [ ] Add regressions for distinct issue keys, delayed admission, expired citations and changed sessions.
- [ ] Run `node --test test/dsh_supervisor.test.mjs test/dsh_audit.test.mjs`; confirm the new cases fail against the existing implementation.
- [ ] Separate accepted-key and citation enums. Timestamp observations, retain only cited previous facts, and re-age them before each role/publication.
- [ ] Run the same tests and `node --check services/dsh-supervisor/app.mjs`.

### Task 2: Execution history and scheduling

**Files:** `services/dsh-supervisor/core.mjs`, `services/dsh-supervisor/app.mjs`, the same tests.

**Interfaces:** `executionRevision(events, now)`; issues carry `scope: current|execution`; `auditDue(state, tickets, now, executionRevision)` retains the existing cooldown.

On-site follow-up: the first real audit confirmed the repaired publication path but treated expected failures as repair work. Add independently constrained `actionableKeys` and require both factual acceptance and repair necessity. The sentinel also replayed old pin events after restart: add `bots/_supervisor/event-cursor.mjs` and `test/supervisor_event_cursor.test.mjs`, mirror these source files to the native checkout, and retain the exact timestamps/IDs until API confirmation. Validate with the installed DSH schema validator (`test/dsh_schema_compat.test.mjs`), since its subset rejects standard `maxItems`.

- [ ] Add failures for repeated receipts with different task IDs, a fresh poll containing old failures, and unchanged failures during cooldown.
- [ ] Preserve stable execution IDs and compact failure groups with first/last occurrence and distinct task counts. Permit bounded historical execution citations only for execution-scoped findings.
- [ ] Capture the execution revision actually inspected; later failures remain pending. Rotate already-reviewed tickets fairly.
- [ ] Clear resolved connection errors only when a real fresh game frame arrives; report rejected publication reasons.
- [ ] Run targeted tests, then all `node --test` tests.

### Task 3: Repair handoff and deployment

**Files:** `services/dsh-supervisor/repair.mjs`, `services/dsh-supervisor/app.mjs`, `test/dsh_repair.test.mjs`, `docs/dsh-supervisor.md`, `bots/_supervisor/CHANGELOG.md`.

**Interfaces:** `buildRepairQueue(tickets, receipts, now)` produces unresolved work; `recordRepair` saves commit/check/deployment facts and writes a clearly labeled ticket comment without closing or taking ownership.

- [ ] Add regressions for failed checks, wrong-ticket receipts, uncertain API writes and repeat receipt submission.
- [ ] Produce a durable queue and a documented CLI receipt path for the existing hourly maintainer. Keep diagnostic and repair state separate.
- [ ] Record evidence, hypothesis, falsifiable prediction and validation in the changelog.
- [ ] Run targeted and full regressions; review the explicit diff and commit only the planned files.
- [ ] Gracefully replace only this monitoring service. Observe real role completions, refreshed evidence, ticket API writes and unchanged game/model process identities.
- [ ] Push to `contribution-fork`, record inspection proof and report the actual result and remaining limits.
