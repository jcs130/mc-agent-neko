# Local Minecraft exam progress handoff

The local Neko planner repeatedly queried promotion status and started the same
`inventory_basic` exam while the server already reported it active. Starts returned
`task_slot_busy`. The next decision preserved the empty commission report but put
exam status and previous action feedback only behind the historical query index.
This is a client information handoff problem, not evidence of a server outage.

Companion plugin patch 0088 preserves the latest exact exam status independently
of commission status. Catalogues cannot replace either scope. Complete tool replies
replace older fragments for the same command; out-of-order replies and login
boundaries retain their existing safeguards. Both reports stay timestamped historical
evidence, rather than becoming invented current completion claims.

The latest explicitly non-read-only server attempt also has its own receipt pointer,
which subsequent queries do not replace. The command, status and session are visible;
messages and records remain exact field reads. Complete original history is still
privately retained. No message truncation, automatic action, extra periodic model
call, retry-frequency change, model change or speech suppression is introduced.

This implements the complete-retention/current-facts/query policy for local deployment.
It keeps a long action response out of each new prompt without deleting its contents.
It does not make an intentional full-history read fit the current 32K engine: earlier
33555, 1980141, 32716 and 33058-token requests failed independently. Later requests
were within capacity, so those historical failures alone do not explain the subsequent
query loop or establish that this change improves overall inference latency.

Three regression cases failed before the fix. All 283 Minecraft plugin tests and
Ruff for the changed Python files pass afterward. Complete replay of 88 plugin and
34 host patches reproduces the declared plugin tree and all 61 host-scope files.
No host-code change is needed for this patch. Deployment only reloads the owned
Minecraft plugin at a measured idle boundary; the native game, main brain, local
LLM, vision, speech and observer need not restart.

Acceptance must distinguish actual context delivery, a new task acceptance, physical
progress and completed exam proofs. A passing test, received command, accepted task,
changed position or monitor diagnosis alone is not completed autonomous gameplay.
