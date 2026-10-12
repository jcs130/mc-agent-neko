# Local deployment: share opaque item protocol paths in slot tables

The local Qwen deployment has a 32K context. During the hour ending at 13:55
Beijing on 2026-10-12, three actual requests exceeded that capacity. Two occurred
after the latest-task-conclusion repair; that earlier delivery repair did not
resolve all context growth. The failed final requests carried the current input
and accumulated query results. These are request failures, not evidence of a
server outage or proof that every idle decision has the same cause.

## Change

Companion 0092 uses the existing `columns_with_snapshot_index` format and
`indexedColumns` for original item `components`, `nbt`, `metadata`, `raw` and
`rawNbt` fields in inventory and window slot tables. The table shares its root;
an indexed value is read at `detailsPath/<snapshotIndex>/<column>` using that
input's `rawEvidence.id`. The snapshot index is not the item's Minecraft slot
number. Key-set groups preserve the distinction between missing and null.

Previously each slot repeated a synthetic protocol wrapper containing its full
path, evidence selector and field names. On the observed 36-inventory-slot and
87-window-slot input, those wrappers alone occupied about 12,600 characters.
Sharing the existing table path removes this repetition. It adds no new model
call, text limit, retention expiry, task rule or permission. Names, counts, lore,
durability, enchantments and book page pointers retain their existing meanings.
All received opaque values remain complete in immutable snapshots. Mixed slot
collections still use explicit original per-item paths, avoiding a raw-data leak
when a table cannot be formed.

## Regression report and paired measurement

The new regression first failed for both inventory and window. After repair,
the focused evidence module passes 19 tests and the complete Minecraft plugin
suite passes 290 tests under Python 3.11. Ruff and whitespace checks pass.
Tests cover original opaque fields, long text, null versus absent keys, slot
numbers differing from snapshot indexes, mixed collections and exact reads.

Three actual retained decision inputs were compared offline with the deployed
Q2_0 GGUF tokenizer. Only the two slot tables changed in each paired input.
Reconstructing from the canonical archive requires ignoring only the order of
opaque field names; the measured baseline itself uses the delivered input.

| Sample | Before tokens | After tokens | Saved tokens |
| --- | ---: | ---: | ---: |
| 1 | 20,552 | 17,129 | 3,423 |
| 2 | 20,457 | 17,034 | 3,423 |
| 3 | 20,221 | 16,798 | 3,423 |

Each comparison preserves 123 slot rows and verifies 369 exact original opaque
field reads, with the same raw evidence ID. These numbers describe one dynamic
input projection, excluding the surrounding system prompt, tool schemas and
subsequent query results. They are not complete HTTP request token totals or a
latency promise. No test inference or game action was submitted.

The complete companion replay checks 92 plugin patches, 34 host patches, the
exact resulting plugin tree and all 61 unchanged host-scope file blobs.

## Deployment and acceptance

Use the existing single-plugin lifecycle at a confirmed idle boundary, keeping
the main service, native game session, model/vision, voice, desktop and spectator
continuous. Keep prepared if the boundary cannot be observed. Runtime acceptance
must check actual natural inputs, capacity errors and task outcomes separately.
Smaller inputs, successful syntax or movement alone do not verify sustained
productive autonomy. The broad progress ticket remains open.

Diagnostic artifacts retain timestamps, hashes, lengths and counts, excluding
prompt, reply, thought, credentials and private voice material. Model weights,
GPU assignments, thinking configuration, inference slots, wake frequency and
chat permissions are unchanged.
