# Server welcome context implementation plan

**Goal:** Retain login welcome/gameplay instructions for the current server connection and deliver the complete retained text to Neko's reading context even when its plugin attaches late.

**Evidence:** Real login captures contain the server's skill catalogue, `/mycli skills info <ID>`, profession pagination, party revival rules, `/mycli world board` and `/photohelp`. They currently only enter a 128-event/two-minute ring. Compact Neko context includes two recent events, so these instructions expire or are squeezed out. Native observation already starts before login; the missing pieces are durable connection-scoped storage and a dedicated bounded reading delivery.

**Architecture:** Cache unsolicited system/title/subtitle text received within 30 seconds of login under `state.server.welcome`. Retain it across event expiry, dimension/respawn and late plugin connections, but reset on a new connection. Neko sends each retained welcome message once per session as ordered read-only chunks below the host's 1,000-token callback limit. Decision context keeps a compact pointer, and `minecraft_observe(sections=["server"])` exposes the full retained cache.

**Tech stack:** Mineflayer observer, Node.js node:test, existing Neko Python observation/service code and unittest fixtures.

**Scope:** Reuse the MC/Neko information worktrees. Neko writes stay inside `plugin/plugins/game_agent_minecraft/`. Preserve chat suppression, private communication, action ownership, local Qwen and LAN viewer. No public chat, server commands or diagnostic skills are sent for verification.

## Steps

- [x] Add failing native tests for welcome retention after event eviction, source/time filtering, respawn/new connection behavior and bounded storage.
- [x] Add failing Neko tests for late attachment, complete ordered chunk delivery under callback limits, deduplication/new-session reset and persistent compact references.
- [x] Implement the connection cache in `src/websocket/game_information.js`, reading chunks in `observations.py`, and passive delivery/status in `service.py`.
- [x] Run affected MC and full Neko plugin tests, document limits and commit each repository's change.
- [x] Deploy with one controlled service restart, restore unattended play and verify actual server welcome text plus successful Neko reading deliveries and fresh service health.

## Review focus

- Raw player chat/private messages and replies to explicit server queries must not become persistent server welcome rules.
- Login instructions must survive ordinary event TTL/eviction, respawn and a late reader.
- A new connection must not inherit an old server's welcome cache.
- Every text chunk must fit the host limit; use distinct coalescing keys so earlier chunks are not replaced by the last one.
- Captured game text is reference data with no instruction privilege. Delivery uses `ai_behavior=read` and never sends game chat or interrupts a task.
- Storage limits and any omitted/truncated text remain visible; the cache covers the login window, not every future server announcement.

## Verification before deployment

- Red: the initial native tests failed for the absent welcome cache (3 failures); Neko's initial four welcome tests failed for missing reading delivery/context references.
- Green: all 216 native tests passed (`rg --files test -g '*.test.mjs'` passed as individual paths to `node --test`). All 67 Neko Minecraft plugin tests passed (`python -m unittest discover -s plugin/plugins/game_agent_minecraft -t .`).
- Coverage includes expiry/eviction/respawn retention, new connection reset, real-login window anchoring, filtering of chat/query replies, long-text limits, complete ordered token-bounded delivery, retrying a failed callback without repeating successful ones, and rejecting stale/foreign-session caches.
- Native output: `D:/neko-mc-trial/server-welcome-node-regression-20261009.tap`; Neko output: `D:/neko-mc-trial/server-welcome-python-regression-20261009.log`.

## Deployment verification

- Native implementation deployed as `9c031da`; Neko implementation as `e122d7f` plus `6eaec42`. The latter retries SDK `submitted=False` as well as exceptions, without marking rejected chunks as delivered.
- Restarted through the trial lifecycle scripts. The main health endpoint became ready before `/api/agent/state` initialized; rerunning the normal start script completed startup without another process restart.
- A real login retained nine unsolicited messages, without text clipping/omission. The plugin's live `minecraft_observe(sections=["server"], max_events=0)` returned the identical connection-scoped cache, and status reported nine successfully submitted read callbacks.
- Verified actual welcome content for profession skills and pagination, skill learning conditions, party revival within four blocks for ten seconds, `/mycli world board`, `/photohelp`, and a full-inventory wand pickup hint. Startup warnings/errors remain received historical text; they are not promoted to rules.
- After more than 120 seconds, restarted only the plugin to load the SDK rejection retry. The original MC session ID remained unchanged; the welcome entries had left `recentEvents`, yet all nine were reread from the retained cache. The connection did not need another server login.
- Local Qwen loaded, LAN viewer game online, Neko YUI session active/ready, plugin connected, and a fresh guardian belonging to the current supervisor PID reported every service ready. Unattended gameplay restored.
- Evidence: `D:/neko-mc-trial/server-welcome-deployment-verified-20261009.json`, generated by the read-only `verify-server-welcome.py`. No live diagnostic skill, task or player chat was injected. Callback submission and cache accessibility verify context transport; they do not establish that the model mastered or exercised every rule.
