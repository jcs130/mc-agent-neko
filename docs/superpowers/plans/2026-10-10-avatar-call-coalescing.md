# Avatar Call Coalescing Implementation Plan

> **For agentic workers:** Execute sequentially with diagnosis, Git and verification skills. Do not delegate or create another game controller.

**Goal:** Avoid duplicate and obsolete avatar classification calls while preserving normal response, TTS and game execution.

**Architecture:** Keep the existing host turn finalizer. Bound its completed-turn identities, discard superseded queued classifications, and reject late results. Classification still feeds both Live2D expression and motion. Main-response emotion metadata is a later independent experiment, not part of this patch.

**Tech Stack:** Existing browser JavaScript, Node VM replay, Neko host companion patch series.

**Spec:** The user's 2026-10-10 request to inspect multiple model callers and optimize repeated expression/motion work.

## Global Constraints

- Keep local Qwen and RTX 3090 model configuration unchanged.
- Preserve streaming text, audio, subtitle handling, real social input and body ownership.
- Do not globally cancel model requests or interrupt active game tasks.
- Host code is delivered as a separate companion patch, as already authorized in this conversation.
- Store only timing/count metadata in audit artifacts; no prompt, response or credential logs.

## Review Focus

- Duplicate normal/callback completion for one stable turn must not submit another classifier or translation request.
- Separate turns with identical text remain separate; missing identities must not merge unrelated turns.
- A new turn may supersede a scheduled classification before dispatch, or an older in-flight result before application.
- Empty and structured turns retain current behavior; successful or failed classification clears its deadline timer.
- Replay count reductions are not evidence of aggregate production latency or rendered-avatar quality.

## Task 1: Reproduce and constrain optional work

**Files:**
- Modify: `N.E.K.O/static/app/app-websocket.js`, the existing `finalizeAssistantTurn` boundary.
- Test: `N.E.K.O/tests/frontend/test_avatar_turn_coalescing.mjs`.

- [x] Run the real finalizer in a VM with fake timers and deterministic classifier promises; reproduce duplicate requests and late avatar application before editing production code.
- [x] Add a 64-item bounded turn/text identity guard; increment an emotion generation only for new meaningful finalization; check current turn/generation before dispatch and after awaiting classification.
- [x] Clear the five-second timer in `finally`; do not claim this aborts already dispatched backend inference.
- [x] Replay normal/callback duplicates, distinct identical text, queued and in-flight supersession, newly started turns, missing/reused IDs, empty/structured/music-only turns and error cleanup. Existing CSRF retry checks pass; full Python contracts were not rerun.

## Task 2: Deliver evidence and preserve gameplay

**Files:**
- Create: `docs/neko-avatar-calls-2026-10-10.md`.
- Update: `bots/_supervisor/CHANGELOG.md`, `integrations/project-neko/manifest.json`, companion README.
- Append: one ordered host patch; do not rewrite previously published patches.

- [x] Aggregate finished timing records separately from dispatch records, and TTS character telemetry separately from LLM requests.
- [x] Export the scoped host change, verify all hashes, and replay the complete plugin/host bundle to the declared source.
- [x] Commit and push only owned files to the existing user fork branch; remote identity is checked as the final delivery gate.
- [x] Refresh only the owned desktop when its speech/main session is quiet; it reconnected at 21:38 with main/native/model preserved. Fresh game state remains online, HP 19/food 17. Five-minute plugin retention remains a separate prepared change.
- [x] Document exact call-chain behavior, replay results, live deployment and the remaining one-pass-metadata option without claiming unmeasured speedup.
