# Local vector memory deployment plan

> For agentic workers: execute the deployment and verification steps in this session. No parallel worker is needed for this configuration-only repair.

**Goal:** Restore Neko's native semantic memory recall without losing original information or competing with game inference and speech.

**Architecture:** Keep the existing per-character JSON/SQLite stores and BM25 + cosine/RRF retrieval. Prepare the exact upstream anonymous ONNX profile, measure its native CPU implementation, then enable the existing startup flag and verify live backfill and retrieval. GPU deployment is conditional on measured CPU inadequacy.

**Tech Stack:** N.E.K.O. Python 3.11, ONNX Runtime CPU, local-text-retrieval-v1 INT8, PowerShell, RTX 3090 game / RTX 3080 Ti speech.

**Spec:** User request to inspect vector memory and optionally use the 3080; existing original-information retention and uninterrupted-game constraints.

## Global constraints

- Do not change the 3090 game model, voice model, private credentials or character identity.
- Preserve original SQLite rows and JSON memory text; add compatible cached vectors through native APIs only.
- Do not kill a memory child alone: the launcher treats its death as a critical failure.
- Publish only metadata, scripts and documentation; no private memories, vectors or model weights.

## Review focus

- An installed model is not proof that the running process has enabled vectors.
- Query results must use compatible dimensions/profile hashes; existing text must survive backfill.
- Keyword recall must remain available when vectors are disabled/unavailable.
- Neko's recall tool and Minecraft's place/history memories have different scopes.
- A host reload must preserve native Minecraft, spectator, game model and speech service processes.

## Steps

- [x] Inspect source, startup flag, live logs, memory metadata and GPU ownership.
- [x] Prepare pinned native INT8 assets with `scripts/prepare_embedding_model.py`.
- [x] Run native CPU embedding and synthetic semantic retrieval measurements without writing character memory.
- [x] Save a repeatable asset-preparation helper and enable the local trial flag, preserving its previous script as a rollback copy.
- [x] At an idle boundary, reload only the owned Neko host through the existing lifecycle/start scripts; protect native game, model and voice processes.
- [x] Verify ready log, actual embedding coverage, semantic query, raw text retention and process identity continuity.
- [x] Document measured behavior, scope limits and rollback; prepare exact files for the user's fork.

Acceptance: 78/78 compatible vectors, all original text and 216 SQLite rows retained, three real hybrid queries with vector candidates, native recall tool registered, 149 related checks passed. Only the host and its temporarily paused lifecycle guardian were reloaded; ten protected processes and the native game session were preserved. Detailed measurements and limits are in [the deployment report](../../local-vector-memory.md).
