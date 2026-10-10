# Reduce repeated Minecraft prompt processing

Goal: reduce actual uncached input tokens on the existing local RTX 3090 service while keeping current actions, safety observations, server instructions and social tools available.

1. Capture a bounded sample of real wire requests using the existing opt-in Neko audit. Count components with the installed Strata tokenizer and chat template; distinguish tools, stable instructions, restored history, current conversation and current game cue. Compare exact token prefixes and cache/eviction metrics.
2. Stabilize execution instructions and move changing memory, task and state to the suffix. Opt into a single pinned Strata prefix only for the measured owning request family, with an exact message/character boundary. Leave other providers and image requests unchanged.
3. Project old game history only on the outgoing copy: retain durable summaries, recent action/result groups, current task and current facts. Keep omitted material in the original archive and mark partial context. Select tools by explicit request scope without removing communication, reference lookup or current tool replies.
4. Reuse existing callback coalescing and expiry; reject obsolete idle cues before dispatch and defer low-priority background local requests while execution is active. Do not add polling inference or interrupt a running skill.
5. Run focused regressions, then relevant suites. Deploy through the existing lifecycle with the model and native actions preserved where possible. Measure actual cached/recomputed tokens and latency separately from queueing. Export Neko host/plugin patches into this fork, verify reproduction, commit and push only task changes.

Evidence: the server already has 5 GiB / 16-slot conversation parking; observed 46 evictions in 142 requests, including zero reuse and 24,524-token reuse. Its template renders tools before system instructions; removing tools on a forced final answer changes the prefix. Strata permits only one pinned prefix per engine. No model engine change or cache-budget increase is planned without further evidence.
