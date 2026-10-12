# Supervisor repair handoff implementation plan

> Execute in the current authorized maintenance session, with failing regressions before each implementation and separate commits for evidence, scheduling and handoff. The user has requested implementation; no additional approval or delegation is required.

**Goal:** Make confirmed supervisor findings carry their actual failure cause, converge on stable incidents, and reach the existing maintenance executor promptly without repeatedly diagnosing unchanged old tickets.

**Architecture:** Keep the cloud observer/diagnoser/reviewer and game processes separate. Project matched native command failures and source references; derive incident identity from observed component, subject and failure. Keep original tickets and evidence, associate aliases without closing them, and write a durable priority queue with bounded leases for the existing maintenance automation.

**Tech Stack:** Node.js ESM, node:test, existing DSH and ticket HTTP API, existing Codex heartbeat automation.

**Spec:** The 2026-10-12 user request to repair the monitoring system and the preceding audit: 650-character excerpts omitted a backpack refusal at character 3184; six appearance tickets used different keys; old tickets dominated review; the maintenance executor only polled hourly.

## Global constraints

- Preserve all original received game data, matched task results and existing tickets. A compact projection must identify omissions and retain an immutable original reference.
- Preserve the local RTX 3090 game/vision route and RTX 3080 Ti VoxCPM2; no additional local inference, game commands or speech.
- A confirmed historical failure is not proof of a current freeze. Normal protection and missing resources are not automatically bugs.
- Other players' appearance status must not become a NEKO outage. Incident identity includes the actual subject.
- Preserve user stop state, maintenance leases and existing uncommitted files; only reload the owned monitor when required.
- Never automatically close a ticket or accept a model claim as a deployed/verified repair. Receipt checks, commit and runtime proof remain mandatory.

## Review focus

- A long successful inventory result before a short failed command must retain the latter's exact error.
- Reworded model keys, repeated reports and retries after an uncertain API response must not create or increment the same occurrence twice.
- Different subjects, distinct failure causes and failures after a verified repair must remain distinguishable.
- Comments and unchanged old records must not cause continual five-minute diagnosis; genuine fresh failures and recurrences must retain priority.
- Queue persistence, restart, expired leases and stale completion receipts must not lose a request or authorize duplicate repairs.

## Task 1: Exact failure evidence

**Files:** `services/dsh-supervisor/execution_evidence.mjs`, `core.mjs`, `test/dsh_execution_evidence.test.mjs`.

- [x] Reproduce a task result containing a long `!window` table followed by five `!moveBackpackItem` failures. Require the exact refusal, command, occurrence count, original length/digest/reference, and the fact that execution stopped.
- [x] Implement matched command/result projection and structured failure summaries. Keep original times/session ownership and existing JavaScript exception handling.
- [x] Project appearance channel state with subject and exact reason independently of generic event excerpts; exclude unrelated players from own-fault evidence.
- [x] Run `node --test test/dsh_execution_evidence.test.mjs test/dsh_audit.test.mjs test/dsh_supervisor.test.mjs test/dsh_schema_compat.test.mjs` and inspect actual private sample projections without copying model prose or credentials into the repo.
- [x] Commit the independently verified evidence repair.

## Task 2: Stable incidents and bounded diagnosis

**Files:** `services/dsh-supervisor/incidents.mjs`, `core.mjs`, `audit.mjs`, `app.mjs`, `test/dsh_incidents.test.mjs`.

- [x] Add regressions for two model keys referencing the same failure; same cause in later tasks; different causes; appearance subjects; uncertain publication retry; and a new occurrence after verified repair.
- [x] Associate existing tickets using actual failure identities and preserve aliases/history. Publish only new source occurrences; link ambiguous historical records for maintenance review rather than silently closing or declaring them identical.
- [x] Base review scheduling on evidence/occurrence revisions, not diagnosis comments. Prioritize fresh actionable and recurrent incidents, snooze unchanged reviews, and reduce healthy rounds to the roles needed for an actual decision.
- [x] Run incident, audit, repair and schema regressions, including original timeout/session/citation tests; commit the verified increment.

## Task 3: Durable maintenance dispatch

**Files:** `services/dsh-supervisor/maintenance.mjs`, `app.mjs`, `repair.mjs`, `test/dsh_maintenance.test.mjs`, `docs/dsh-supervisor.md`.

- [x] Test a reviewer-approved incident reaching the maintenance queue, durable restart, bounded exclusive claim, expiry, renewal, and rejection of a stale repair receipt after a new occurrence.
- [x] Write a metadata-only priority queue and CLI claim/renew/status flow. Consume existing checked repair receipts; retain prepared/deployed/verified distinctions and API-pending state.
- [x] Update the existing heartbeat through its native automation tool: short queue checks may occur every five minutes, full health inspection stays hourly, and no due work stays quiet. Do not create another task or invoke an arbitrary shell repair from model output.
- [x] Run all `test/dsh*.test.mjs` regressions, syntax checks and `git diff --check`; commit code and operating documentation to the user's fork.
- [x] Reload only the exact owned DSH monitor, verify fresh role evidence, canonical publication and actual maintenance request persistence, then record deployment/acceptance without claiming unresolved gameplay is fixed.

## Task 4: Observed legacy sentinel false positives

**Evidence:** During final runtime acceptance, T-0004 continued to gain occurrences while matched server time packets advanced. The legacy frozen-alive detector confused quiet command logs with a frozen game loop.

- [x] Add regressions for an idle player with advancing server packets, writer-only timestamps, fixed daylight, changed sessions, wrong positions and a partial file read.
- [x] Require a matching recent server-packet advancement proof before excluding a suspected data freeze; retain the independent autonomy progress watcher and original tickets.
- [x] Pass 99 DSH and event-cursor regressions, syntax checks and diff checks. Commit the isolated sentinel change in the fork and native repository.
- [x] Reload only the owned sentinel through the existing coordinator, preserving its coordinator, ticket server, game, main service, model, voice and clients.
- [x] Complete measured recurrence observation and sealed repair receipts. Final documentation push and inspection baseline are included in this maintenance completion.

## Acceptance scope

The coordinator now retains exact failure causes and original references, associates actual subjects and causes, bounds unchanged diagnosis, and persists claimable maintenance requests. The existing native automation performs short queue checks every five minutes and full health inspection hourly. Actual leases and current-condition triage have been exercised without closing the source tickets. This is not a claim that gameplay progression, all historical tickets or audible speech continuity have been resolved.

Final source: fork `72e9e963e521574f30f2d9cb4e16a8d2f3d28cde`; native sentinel `b7e4c78c99e04fed6f3a08520e65510baea4bfa0`. Coordinator files are unchanged from its loaded `e3433a385d298da4936d3e9c0d15549080824609` version. Related DSH/event-cursor regressions: 99 passed, 0 failed. During 180.5 seconds and 13 actual observations, the false frozen-alive alert gained zero occurrences while server age advanced; one movement sample correctly declined mismatched position evidence. T-0004 and T-0085 have API-confirmed scoped runtime receipts, and the actual maintenance lease was released. No game command, local inference probe or automatic ticket closure was performed.
