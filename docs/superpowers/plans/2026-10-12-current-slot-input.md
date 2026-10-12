# Current slot input representation repair

**Goal:** Keep the local 32K game decision usable when a real storage window is open, retaining every observed slot, name, lore, value and exact source reference.

**Evidence:** After the query-classification repair, the existing final execution opportunity ran naturally and real backpack movements were confirmed. Later requests failed at 33592, 33385, 32464 and 32642 input tokens plus 320 output tokens against the actual 32768 limit. A delivered instruction contained 68142 characters; its current window had 87 slot records using 24806 characters, current inventory slots another 10773. These are observed game facts, not oversized old conversation history. Repeated tool results add further input during the existing bounded loop.

**Proposed variable:** Share repeated field names in current inventory/window slot records, using the same reversible column-table principle already used for entities. Preserve original row indexes and distinct key sets; keep all values and names/lore in the current view. Full observations and immutable evidence reads must remain unchanged. No heartbeat, tool-round, model, context-size, authority or inference-slot change.

- [x] Measure the actual input representation offline before edits; verify exact round-trip equality and local token counts.
- [x] Add a regression for complete inventory/window rows, missing-versus-null keys, custom names/lore and unchanged full/evidence reads.
- [x] Implement only the proven representation change, run relevant plugin and host handoff checks.
- [x] Save Neko changes as the existing companion patch bundle, document regression/risk and push related changes to the user's fork.
- [x] Deploy the single plugin at an observed safe boundary, preserving game session, main/model/voice/desktop/eye; observe accepted real requests and actual server-operation receipts before choosing the repair phase.

Deployed at 12:04:06 Beijing, source 346f9d4 / fork 18fd360. By 12:10:20,
44 natural requests completed without a new capacity error (maximum input
31867). The separate 150-second/101-frame sample stayed healthy but had no
body movement. Natural exam starts are not completed proofs; T-0035 recurred
to occurrence 87. Use deployed, retain follow-up, and leave sustained
physical progress, cache zero-reuse and repetitive speech acceptance open.

If this lossless representation does not materially reduce the measured input, revise the hypothesis before deploying. Current facts must never become silently absent. Quest completion and speech repetition remain separate acceptance items; neither a short prompt nor an accepted request proves gameplay success.
