# Backpack capacity feedback implementation plan

> Execute in the existing maintenance task, preserving unrelated work and live services.

**Goal:** Ground a rejected backpack transfer in the currently received source identity, direction and available destination capacity.

**Architecture:** Keep `moveBackpackItem` validation and transfer ownership unchanged. Expand only the existing capacity refusal, using the same validated window, item and capacity that caused the refusal. The model receives the actual attempted operation instead of a generic space error.

**Tech Stack:** Node.js, Mineflayer, Minecraft 1.20.6, `node:test`.

**Spec:** Current maintenance evidence under `D:/neko-mc-trial/runtime/maintenance-20261012-1755` and the user's continuous-operation constraints.

## Constraints and acceptance

- T-0006 was claimed at occurrences 648; the actual pre-code API baseline is 650. Renewal transferred the lease to `mr-7fe24bf130b260da6328f846` with baseline 650.
- A received table puts experience bottles in slot 37 while nearby executor narration calls that slot cobblestone. Generic refusals cannot establish which item was actually attempted. The new result must state that fact directly.
- Do not change capacity calculation, permissions, quantities, retries, model-call frequency, reference audio, or unrelated pending patches.
- A normal refusal is not a server outage. A clearer refusal or successful ordinary transfer alone does not verify broad autonomy recovery.
- Deploy only at a measured safe idle boundary; keep source prepared if no such boundary occurs.

## Task: current-operation capacity refusal

Files: `src/agent/library/portable_storage.js` and `test/portable_storage_source_feedback.test.mjs`.

- [x] Add failing behavioral regressions for wrong-item withdrawal, full-storage deposit, and a partial stack with capacity below the requested quantity. Assert no transfer is submitted and the result fits the existing output budget.
- [x] Run the focused feedback suite and save the expected pre-change failures.
- [x] Expand the single capacity refusal with window ID, source slot/item/count, requested quantity, deposit/withdraw direction, destination and actual capacity. Explain that reopening an unchanged backpack does not create destination space.
- [x] Run portable-storage, capacity, container and mission evidence regressions; run syntax, ESLint and whitespace checks. The two pre-existing source `require-await` findings are identical to HEAD; test ESLint passes.
- [ ] Commit and push only this change and its documentation to the existing user fork.
- [ ] Recheck the actual lease/baseline and latest raw evidence. Safely deploy only the changed runtime file, record protected-process continuity, and observe natural refusal feedback before claiming that runtime part accepted. Keep the broad ticket open.
