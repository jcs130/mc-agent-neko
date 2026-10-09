# Local code and vision implementation plan

**Goal:** Enable Mindcraft's separate local conversation, code-generation and screenshot-understanding paths for Neko's existing autonomous Minecraft session.

**Architecture:** Keep conversation, coding and visual understanding on the existing RTX 3090 Qwen3.8 Flash Strata service. Restore its existing `strata-vision` encoder and matching projector, with CPU image encoding as requested by the user (no secondary GPU). Execute generated JavaScript in a disposable worker with bounded, serialized calls to documented game skills; capture the existing modern browser renderer on demand, outside the Mineflayer process.

**Tech stack:** Node ESM, worker_threads, SES, existing ESLint, playwright-core, llama.cpp CUDA, Node test runner.

**Spec:** User request to open the project's existing chat/code/VLM abilities; preceding requirement to avoid frequent interruptions and excessive context.

## Constraints

- Preserve local Qwen main endpoint `http://127.0.0.1:18030/v1`, persona, communication policy and external Neko decision ownership.
- No injected game tasks, chat or skill probes. Verify generated code with offline fixtures and model requests; verify live capture through read-only observation.
- Preserve the LAN viewer and desktop/voice services. No Neko platform-layer changes.
- Push native source and companion documentation to the existing personal fork branch.
- Enable abilities only after their real endpoint and execution path have passed checks; never send images to Strata's text-only endpoint.

## Review focus

- Infinite generated JavaScript and interrupted/replaced game bodies must not freeze the parent or issue later calls.
- Generated code must not bypass communication policy or invoke retired/developer-only custom skills.
- A failed coding request must release its single-flight gate and permit a later attempt.
- Vision content arrays must survive request formatting; chat-completions must receive `text`/`image_url` parts.
- Screenshot failures must be bounded, close their browser/session lease and leave the connected game agent running.

## Task 1: Bounded generated scripts

Files: `src/agent/coder.js`, `src/agent/library/lockdown.js`, new `src/agent/code_executor.js` and `code_worker.mjs`, `src/models/prompter.js`, regression tests.

- [ ] Reproduce initialization and coding-gate failures offline.
- [ ] Isolate generated statements in a worker. Permit documented skills/world calls with a read-only game snapshot and fresh inventory queries. Keep private logs private and enforce the custom-skill catalog.
- [ ] Bound worker wall time, number of calls and payload size; cancel on body replacement/interruption and terminate CPU loops without blocking Mineflayer.
- [ ] Await template initialization, preserve syntax/lint retries, bound model history, and clear coding state in `finally`.
- [ ] Verify real local code generation against offline game stubs, then commit.

## Task 2: Local on-demand visual understanding

Files: `src/models/gpt.js`, `src/agent/vision/vision_interpreter.js`, new modern capture helper, tests and package metadata.

- [ ] Reproduce image-array corruption and wrong content-part names with an offline API fixture.
- [ ] Implement a proper image request with bounded recent history, explicit local vision model, finite timeout and real failure propagation.
- [ ] Capture the existing modern viewer using a short browser capture lease and guaranteed cleanup; keep native in-process GL disabled.
- [ ] Verify the installed Strata encoder/projector, add the missing vision configuration and engine flag, and retain the existing model, localhost endpoint and 262144-token context. No alternative VLM download.
- [ ] Verify an offline image and a read-only live viewer screenshot with the real VLM, then commit.

## Task 3: Integration and contribution

- [ ] Expose code and vision command documentation through the existing native task controller; retain high-level Neko scheduling and chat policy.
- [ ] Run complete native/contribution suites, deploy at an action boundary, and passively verify ongoing autonomy.
- [ ] Record exact models/routes, measured probe latency, limitations and reproducible local setup in the fork. Push and verify remote HEAD.
