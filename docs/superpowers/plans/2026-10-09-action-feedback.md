# Action feedback and reflex ownership implementation plan

**Goal:** Return failed or overlong command batches to the model at a completed action boundary and prevent a reflex from interrupting its own still-running invocation.

**Architecture:** Preserve existing command APIs and healthy skill execution. Carry explicit local action failure in the command result instead of parsing player/server text. Limit fixed command batches and use invocation tokens for mode ownership. Audit code generation separately from runtime optimization.

**Tech Stack:** JavaScript ESM, Node test runner, existing VM fixtures.

**Spec:** Current user request to continue optimizing autonomy and explain script/self-improvement support; observed repeated failed discard batches and self-preservation self-interruption.

## Global constraints

- Local Qwen at `http://127.0.0.1:18030/v1`; preserve model/persona/memory and live arbitration state.
- No injected diagnostic game commands, chat or tasks. Use offline tests and passive runtime observation.
- Keep N.E.K.O. platform source unchanged; deliver native changes in the existing contribution fork.
- Do not enable arbitrary generated code merely to answer whether it exists.

## Review focus

- Failed discard followed by a dependent action: skip the remainder and let the model see the actual failure.
- Recovered internal warnings: no text keyword matching that mistakes a warning for terminal failure.
- Healthy long skill: wait for its real result; yield only between commands.
- Reset `mode.active` while the same reflex still runs: no duplicate action or stop pulse.
- Reconnect or superseding mode: an old completion must not clear a new invocation's state or ownership.

### Task 1: Explicit failed action feedback and bounded batches

**Files:** `src/agent/commands/actions.js`, `src/agent/agent.js`, `src/agent/commands/index.js`, `test/action_batch_feedback.test.mjs`.

- [ ] Add offline integration fixtures executing the real wrapper, parser and `handleMessage`.
- [ ] Reproduce a false `discardAway` result followed by dependent commands; assert only the failed action runs and a subsequent model turn receives the result.
- [ ] Cover successful short batches, invalid arguments, interruption, and a completed action crossing the 30-second batch boundary.
- [ ] Preserve boolean results from relevant primitive skill wrappers. Prefix only explicit false/exception/timeout/preflight refusal with a local action outcome marker.
- [ ] Default to three commands per fixed batch; stop on explicit local failure or validation rejection and skip the remaining commands. After a completed action crosses 30 seconds, obtain a fresh decision before more commands. No forced timeout for a progressing skill.
- [ ] Run `node --test test/action_batch_feedback.test.mjs test/command_invocations.test.mjs test/standby_mission_budget.test.mjs`, then commit this slice.

### Task 2: Reflex invocation ownership

**Files:** `src/agent/modes.js`, `test/reflex_execution_ownership.test.mjs`.

- [ ] Use real `execute()` with an unresolved action in an offline fixture. Simulate a watchdog clearing `mode.active`; a second invocation must not call `runAction` or stop the first.
- [ ] Add rejection cleanup, different reflex, normal subsequent invocation and reconnect generation cases.
- [ ] Bind each invocation to its original body and a unique token. Release only that invocation's ownership and do not reprompt from a retired/superseded invocation.
- [ ] Run the focused tests and commit this slice.

### Task 3: Capability audit, deployment and contribution

**Files:** `docs/neko-action-feedback-and-learning-2026-10-09.md` in the contribution checkout.

- [ ] Document `!newAction` code-model generation, lint/SES compartment, retry limits and current disabled settings; generated files are debugging artifacts, not automatically promoted skills.
- [ ] Document actual persistent memory/custom skill discovery and the absent evaluation/promotion/evolution loop. Do not claim online weight training.
- [ ] Run the full native suite, cherry-pick to contribution, run that full suite, then reload the owned native process through existing lifecycle scripts.
- [ ] Passively verify services, fresh inventory/activity and autonomous progress; push the existing fork branch and verify remote HEAD.
