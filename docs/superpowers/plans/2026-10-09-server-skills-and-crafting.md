# Server skills and local crafting repair

> **For agentic workers:** Implement natively in this session, task by task, with regression tests and live server verification.

**Goal:** Let Neko discover, learn and invoke actual server skills, and stop misreporting missing crafting ingredients as a missing workbench.

**Architecture:** Add a bounded `/mycli` request/reply bridge shared by body commands and the Neko tool. Preserve ordinary chat separately. Collect actual server replies, expose explicit unconfirmed outcomes, and return fresh observations after changes. Keep server skills distinct from local scripted skills.

**Tech Stack:** Node ESM, Mineflayer, WebSocket; Python asyncio and Neko plugin tools.

**Spec:** The user's requested repair and `D:/neko-mc-trial/overnight-audit-20261009.json`. The server book declares `/mycli spells list`, `/mycli spells explain <ID>` and `/mycli skills learn selfheal`; live `mcagent:state` reports available skill points but no learned combat skills.

## Global constraints

- Keep account `ag_NEKO`, local model `http://127.0.0.1:18030/v1`, and LAN viewer.
- Only edit Neko files under `plugin/plugins/game_agent_minecraft/`.
- No platform changes, administrator grants or invented spell IDs.
- A transmitted command or catalog entry does not establish successful learning/casting.
- Preserve runtime state and deploy only verified, committed changes.

## Review focus

- Public chat cannot masquerade as a successful server reply.
- Concurrent commands must not share replies or clear another request's state.
- Timeout/disconnect must release listeners and report unknown rather than success.
- Variant wood must remain the same species; missing ingredients must not trigger workbench navigation.
- Compact context must retain the server skill entry and current points without exceeding host callback limits.

### Task 1: Correct local crafting

**Files:** `src/utils/crafting_recipes.js`, `src/agent/library/skills.js`, `test/crafting_variants.test.mjs`, `test/crafting_local.test.mjs`.

**Interface:** Existing `makeableRecipes(bot,itemId,craftingTable)` and `craftRecipeLocal(bot,itemName,num)` retain their signatures.

- [x] Reproduce `makeableRecipes(botWith({stripped_spruce_log:1}), spruce_planks)` returning no recipe, and `craftRecipeLocal` seeking a table for an unavailable 2x2 recipe.
- [x] Add same-species log/wood substitutions and preflight table recipes before seeking a workstation.
- [x] Run `node --test test/crafting_variants.test.mjs test/crafting_local.test.mjs test/crafting_resources.test.mjs`.
- [x] Commit `fix: resolve wood variants and distinguish missing crafting materials`.

### Task 2: Add the actual server skill command path

**Files:** Create `src/websocket/server_commands.js`, modify `src/websocket/ws_server.js`, `src/agent/commands/queries.js`, `src/agent/commands/actions.js`, create `test/server_commands.test.mjs`.

**Interface:** `sendServerCommand(bot,{command,readOnly?})` returns bounded `{status,command,messages,records,observedAt}`. WS `server_command` requests carry `request_id`; `server_command_result` echoes it only to that requester. Body `!serverQuery(command)` accepts known read-only discovery syntax; `!serverCommand(command)` accepts `/mycli` gameplay commands.

- [x] Test missing body entry, `/mycli` validation, real system reply collection, player-spoof rejection, busy, timeout, disconnect and listener cleanup.
- [x] Implement listeners before sending, per-bot exclusivity, bounded collection and explicit unconfirmed status.
- [x] Register body command descriptions explaining local skills versus server skills, then wire the same helper into WS requests.
- [x] Run `node --test test/server_commands.test.mjs test/chat_bridge.test.mjs test/menus.test.mjs test/books.test.mjs test/game_information.test.mjs`.
- [x] Commit `feat: expose verified server gameplay commands to agents`.

### Task 3: Expose the bridge to Neko

**Files:** Under `plugin/plugins/game_agent_minecraft/`: `client.py`, `__init__.py`, `observations.py`, `service.py`, `README.md`, `test_server_commands.py`, `test_observations.py`.

**Interface:** `GameAgentClient.send_server_command(command)` correlates reply futures by request ID and returns unknown on transport uncertainty. Tool `minecraft_server(command)` returns actual replies and fresh selected server/self facts. Context keeps a short discovery entry for `/mycli` when the server advertises it.

- [x] Test tool presence, disconnected status, out-of-order request correlation, pending-future cleanup, and skill discovery surviving callback reduction.
- [x] Register the tool; explain discovery, explanation, learning and casting, with actual reply verification.
- [x] Preserve current mana/points and a short server entry in compact context; never interpret the local script list as the server spell list.
- [x] Run `python -m unittest discover -s plugin/plugins/game_agent_minecraft -t . -p 'test_*.py'` using the deployed venv.
- [x] Commit `fix(minecraft): connect Neko to server skill discovery and execution`.

### Task 4: Deploy and verify on the actual server

- [x] Pause the owned guardian and plugin before restarting the owned MC process; leave model service available.
- [x] Cherry-pick tested commits into live repositories, preserving `bots/_supervisor/arbitration.json`.
- [x] Restart through official scripts and verify model, plugin, game snapshots and LAN viewer.
- [x] Query `/mycli help`, `/mycli spells list 1` and `/mycli spells explain selfheal`; execute only the server's returned learning/casting syntax.
- [x] Verify learning by fresh skill-point/ability state and casting by actual server feedback/effects. Check local planks crafting against inventory deltas.
- [x] Resume unattended play, confirm Neko tool registration/use, and save redacted verification results under `D:/neko-mc-trial/`.


### Task 5: Correct the discovered durability regression

- [x] Reproduce the installed 1.20.6 item table reporting maximum durability 1 for ordinary tools and armor.
- [x] Repair only affected 1.20.5/1.20.6 defaults by matching item names to adjacent valid vanilla metadata; preserve item IDs and explicit server max_damage components, including a genuine value of 1.
- [x] Cover actual Prismarine item decoding, reconnect idempotence, custom/removed components and new slot/hand updates.
- [x] Deploy and verify the carried iron pickaxe reports maximum 250 and damage 56, rather than being misclassified as unusable.

### Task 6: Stop solicited skill replies from creating proactive feedback loops

- [x] Reproduce a skill explanation mentioning cooldown waking a second unsolicited decision.
- [x] Mark system replies during the bounded request, retaining them in game observations; keep player chat separate.
- [x] Let Neko's active tool turn handle its own replies without another proactive wake-up; genuine player requests and other feedback still wake Neko.
- [x] Verify request markers on 12 actual retained server replies after deployment.

## Verified result (2026-10-09, local time)

- MC regression selection: 64 passed; Neko plugin: 54 passed.
- Complete server catalog: 36 unique skills over pages 1 through 6. Catalog visibility does not make every profession skill learned or usable.
- Selfheal and prospect: both confirmed level 1 after learning and again after process restart; 2 points spent, 5 remain.
- Prospect iron returned the real server location X=-597, Y=12, Z=-503, with the observed 6 mana cost. Selfheal returned a success receipt and consumed mana, but HP was already full: actual HP restoration was not tested. The agent instructions now require injury before healing.
- Live crafting: missing spruce wood was reported as missing ingredients; 1 pumpkin produced 4 seeds, without a table or movement. Stripped wood recipe behavior was verified in the real-library regression test, because no stripped wood was carried in the live inventory.
- Neko independently called minecraft_server for prospect iron at 08:27:33 and 08:28:03, separate from diagnostic tool requests. A separate body mission self-test was inconclusive because an old action completed during handoff; it is not used as skill verification evidence.
- Unattended guardian, main runtime, plugin, local Qwen model and LAN viewer were healthy after the final deployment. This is a bounded verification, not an overnight reliability claim.
- Evidence: D:/neko-mc-trial/server-skills-repair-verified-20261009.json, plus the catalog, casting, crafting and observation artifacts referenced by the verification script.
