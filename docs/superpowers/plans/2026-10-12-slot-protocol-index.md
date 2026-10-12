# Plan: share original slot protocol paths in local decision tables

The local 32K deployment recorded three context-capacity failures since the last
full inspection: 12:59:32, 13:37:59 and 13:38:56 Beijing on 2026-10-12. The latter
two followed the latest-native-conclusion deployment. Actual request metadata
shows the dynamic input plus three query receipts overflowing the final request.
The measured-progress request for T-0035 was claimed at actual occurrence 91;
that baseline was rechecked before this change. An idle candidate is not itself
proof that all failures share this cause.

Observed decision tables repeat an opaque-data path wrapper for every inventory
and window slot. One retained callback contains 3,770 characters of inventory
wrappers and 8,864 window characters, despite already advertising the table root
and snapshot index. Repeated long values account for only 91 characters; a shared
value dictionary would not address the observed cost.

1. Add a failing regression with original metadata/components/NBT key sets,
   missing versus null values, long names/lore and nontrivial slot numbers.
2. Reuse the existing `indexedColumns` protocol for opaque slot fields. Share
   the table root and use the received snapshot index for exact reads. Do not
   change the row format, remove current semantic fields, expire originals,
   impose a text quota, or change task authorization or model settings.
3. Compare the same retained callbacks offline before and after; save counts,
   hashes and reconstruction results only. Run focused and full plugin tests,
   lint, whitespace and complete companion replay.
4. Commit source, export the next plugin companion and documentation to the
   user's fork. Store a prepared receipt with actual commit and occurrence.
5. Deploy only at an observed idle boundary through the existing plugin lifecycle.
   Preserve main service, native game session, model/vision, voice and spectator.
   If no idle boundary is available, retain prepared rather than interrupt work.
6. Observe natural decision inputs, request metadata and task receipts. Mark
   deployed until actual recovery is independently supported; a smaller offline
   projection does not prove complete speed improvement or productive autonomy.

The hourly inspection is already recorded independently of this maintenance.
All unrelated native viewer changes and existing untracked plans are preserved.
