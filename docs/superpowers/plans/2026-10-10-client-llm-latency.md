# Minecraft client LLM latency implementation plan

> Execute natively in this session, as authorized by the user's optimization request. Keep measurement and prompt changes in separate commits and deployments.

**Goal:** measure preparation-to-validated-command latency without collecting content, then test moving the ordinary autonomous goal without changing its wording.

**Architecture:** optional request-local traces travel through Prompter, GPT and the command validation callback. Existing bounded asynchronous telemetry owns storage. A separate opt-in template projection moves only `$SELF_PROMPT`; external missions retain their existing projection.

**Tech stack:** Node.js, OpenAI-compatible SDK, node:test, existing Qwen tokenizer and Strata service.

**Spec:** the user's eight-part MC Agent optimization brief in this conversation; prior results in `docs/neko-llm-prefill-2026-10-10.md` are historical evidence, not a new end-to-end baseline.

## Constraints

- Retain the local service, GPU, weights, sampling/thinking settings, output limits and cache budget. Do not restart Strata or clear its caches.
- Diagnostic output contains numeric timing/token fields, generated request IDs, numeric task generations and fixed enums only. No prompts, replies, command arguments, task text, URLs or credentials.
- Non-streaming calls cannot expose first-content arrival: report null. SDK dispatch is not proof of socket transmission or engine admission. Unknown server queue/input/output times stay null.
- Keep continuous checkpoints. Do not change prefix pin ownership, command descriptions or history policies during the goal-position experiment.
- Preserve unrelated changes; mirror native changes to the user's contribution fork. No messages to third parties.

## Review focus

- Concurrent requests must not share trace state; stale answers still encounter the existing mission epoch guard before command execution.
- Missing/invalid cache usage stays unknown rather than zero; never subtract invalid counts.
- Context retry attempts are distinguishable and logger failures cannot fail an otherwise successful request.
- Incomplete commands and rejected lifecycle controls must not be recorded as usable commands.
- All template placeholders and fixed text survive the goal-position change, including duplicate occurrences and templates without a goal or memory section.

## Task 1 — measurement only

Files: `src/utils/llm_timing.js`, `src/utils/telemetry.js`, `src/models/gpt.js`, `src/models/prompter.js`, `src/agent/agent.js`, `test/llm_timing.test.mjs`, `test/gpt_local_prefill.test.mjs`.

- [x] Add failing tests with injected monotonic/wall clocks and a recording sink. Assert `100 ms` preparation wait, `20 ms` assembly, `500 ms` SDK interval and `15 ms` return-to-validation independently; ensure secrets passed as extra fields never appear in serialized records.
- [x] Implement `createRequestTrace(agent, callType)` and trace methods `mark`, `dispatch`, `returned`, `finish`, `failed`. The sink uses only an explicit schema and existing rolling worker storage.
- [x] Strip `requestTrace` before SDK dispatch; record numeric usage and distinguish recursive context retries. Keep request body and retry policy unchanged.
- [x] Thread optional traces through conversation/code/memory calls. Finish execution traces at the existing validated-command callback, or record rejection/stale/empty outcomes.
- [x] Run `node --test test/llm_timing.test.mjs test/gpt_local_prefill.test.mjs test/native_context_budget.test.mjs test/telemetry-worker.test.mjs`, then the relevant full native/contribution regressions.
- [x] Commit, mirror, deploy at a proven safe idle boundary through the existing lifecycle, enable only metadata timing, and collect natural calls. Record model PID/config hashes before and after.

## Task 2 — ordinary goal position, isolated opt-in experiment

Files: `src/agent/context_budget.js`, `test/native_context_budget.test.mjs`, performance documentation.

- [x] Write failing tests: fixed rules/docs precede every goal occurrence; the goal precedes dynamic memory/state; all original literal fragments and placeholder counts remain intact; external mode and flag-off remain byte-identical.
- [x] Implement goal relocation only when `MC_SELF_PROMPT_TAIL=1`, independently of local Strata formatting. Do not create a second system boundary or claim an explicit pin.
- [x] Compare final formatted requests through the actual tokenizer for unchanged/changed goals and growing history. Discard all generated text and send no game commands if an inference probe is warranted.
- [x] Compare metadata distributions only within the same call family and settings. Report sample count and limits; do not claim cache replay is game latency or correctness.
- [x] Keep or roll back this flag based on evidence, and commit/push the isolated result and documentation.

## Later experiments

Command-description compression, finer history projection, host call admission and explicit prefix changes require their own baselines and quality checks. Existing mechanisms remain active; their projected token savings are not attributed to the two tasks above.

## Recorded outcome

Native/contribution regressions passed (589/632). The additional host adapter
timing companion passed 181 client/session tests and Ruff; all 65 companion
patches replayed to the declared source. Native timing is live, and host timing
was loaded through a terminal-mission host-only reload followed by official
guardian recovery. The native game and current model processes were retained.
An earlier, unexplained Strata restart splits the natural measurement baseline;
the declared engine parameters remained equal. Goal relocation improved the
token common-prefix projection but did not improve changed-goal reuse or latency,
so the flag stays off. See [the dated observations](../../llm-client-latency-observations-2026-10-10.md)
for samples, deployment evidence, missing timing stages and concurrency limits.
