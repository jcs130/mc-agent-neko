# Local dynamic request tail implementation plan

> **For agentic workers:** Follow this plan task by task with the existing debugging, Git and verification workflows. No additional agents are required for this bounded change.

**Goal:** Keep changing local Minecraft context after reusable instructions and history, without repeatedly concatenating observations.

**Architecture:** Project only the outgoing request. The native formatter must own its output objects; the local native GPT adapter places its controller-created dynamic suffix after history. The N.E.K.O. host already supplies one ephemeral current cue after retained history, with subsequent actual tool receipts later; test the constructor and final SDK body without changing instruction authority.

**Tech Stack:** Node.js ES modules, Python 3.11, the existing Strata / Qwen OpenAI-compatible client and installed Q2_0 tokenizer.

**Spec:** The user's 2026-10-12 instruction to place frequently changing/queryable information last for prefix reuse and avoid repeated assembly. Existing complete archives and current-fact/query-entry behavior remain required.

## Global Constraints

- Keep identity, permission, stop and safety instructions; no information deletion or additional model calls.
- Retain tool calls/results and original history, including failures and social messages.
- Preserve the current local model, RTX 3090 binding, reasoning, output limits, parking configuration and sole explicit-prefix owner.
- N.E.K.O. and native dynamic reordering are restricted to the existing opted-in loopback Strata endpoint; image and foreign-provider request policies remain compatible.
- Preserve unrelated working-tree content; export a checksummed host companion and push task files to the user's fork.
- Deploy only through an owned idle boundary; record prepared if safe deployment cannot occur, and separate structural acceptance from speed claims.

## Review Focus

- Adjacent system/user turns, retries and frozen caller objects must not accumulate duplicate text.
- A current human stop request and current tool receipts must outrank old session tasks and memory.
- Unknown or invalid static-prefix boundaries, images and non-game requests must keep their original layout.
- Complete tool pairs, structured reasoning and media must survive the projection unchanged.
- Token common-prefix gains in offline comparisons must not be described as measured online latency gains.

### Task 1: Native request ownership and dynamic suffix

**Files:** `src/utils/text.js`, `src/models/gpt.js`, `test/gpt_local_prefill.test.mjs`, a focused formatter regression test.

- [x] Add failing tests for caller mutation, repeated formatting, retry duplication and dynamic text preceding retained history.
- [x] Make formatting copy caller turns, remove the unused duplicate formatting pass and move only the trusted local dynamic suffix after history.
- [x] Run focused and relevant native suites and lint; compare captured final SDK bodies with the actual tokenizer without inference. Three full-suite failures and three existing GPT lint findings were reproduced on the untouched baseline.

### Task 2: Main-brain final-wire audit

**Files:** N.E.K.O. `tests/unit/test_local_dynamic_request_tail.py` and companion manifest/patch.

- [x] Audit exact final model normalization and rendering before moving any system text. Strata's `_late_system_to_user` demotes late system messages; keep system authority in the initial block.
- [x] Test current cue replacement across actual `prompt_ephemeral` calls, final SDK parameters, human stop/history retention and intact current tool pairs. No host production change or reload is needed if those contracts pass.
- [x] Run focused adapter/wire/tool regression suites with Python 3.11 and Ruff; replay all companion patches and compare scoped blobs.

### Task 3: Delivery and runtime acceptance

**Files:** `docs/local-dynamic-request-tail.md`, companion README/manifest, local metadata-only artifacts and inspection log.

- [x] Record source identities, actual checks, final-wire common-prefix results and limitations; commit and push only task files (`aab205fd`).
- [x] Deploy through the existing owned lifecycle at an observed idle boundary. One native child reconnected and automatically authenticated; model, host, plugin, audio, observer and monitor processes remained continuous.
- [x] Observe natural requests and fresh state: six native execution requests produced validated commands; after the cold first request, five reused 7,889 tokens each. Keep this distinct from unverified broader task recovery and paired latency improvement.
