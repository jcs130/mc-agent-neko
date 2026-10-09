# Server protection feedback implementation plan

**Goal:** Check the server's building permissions before digging and make denials available to both the Minecraft body and Neko.

**Architecture:** Install one Mineflayer dig guard using the existing private `/mycli` command/reply bridge. Cache exact coordinates by dimension; known denials exclude path and wood targets. Publish bounded protection facts through the existing game information stream and retain them in Neko's compact context.

**Tech stack:** Node ESM, Mineflayer, Node test runner, Python unittest.

**Spec / evidence:** Live `/mycli help` advertises `protect break|place|container|use <x> <y> <z>`. Live `MC_PROTECTION` uses `world,x,y,z,action,status,allowed,reason`; observed `allow_likely/true/no_known_protection` and `unknown/null/unknown_out_of_range`. The world guide permits vegetation collection and protects original village buildings. Current chop collected nine logs, so do not diagnose every tree as protected. Scope this repair to digging.

## Constraints and review focus

- Ordinary servers must retain their current behavior. Enable the adapter by explicit configuration or observed protection protocol, never by guessing from village biome.
- Only matching action, world and integer coordinates can authorize a dig. Unknown, timeout, busy, disconnect and malformed replies must not count as permission.
- Stop/reconnect/dimension changes during a preflight must cancel the pending dig. Clear caches on disconnect/respawn.
- Player chat must not supply permissions. An `allow_likely` preflight is tentative; actual server denial still blocks retries.
- Feedback must survive compact context reduction without turning routine permission replies into repeated model wake-ups.

## Task 1: Protect the body at the dig boundary

Files: `src/utils/server_protection.js`, `src/utils/mcdata.js`, `src/websocket/server_commands.js`, `src/agent/library/skills.js`, `bots/_supervisor/skills/chopWood.js`, `test/server_protection.test.mjs`, `test/server_commands.test.mjs`.

Interface: `installServerProtection(bot, options)` installs `bot.serverProtection.check(action, position)`, `.isDenied(action, position)`, and `.snapshot()`. Check results retain exact server fields and `observedAt`. `serverProtection` events report blocked actions, not successful digging.

- [x] Add failing tests: denied target sends no dig; allow_likely permits dig; mismatched replies/unknown/timeouts block; same-target checks deduplicate; cached denials expire and remain dimension-specific; stop during preflight prevents dig; vanilla behavior remains; private protection/land queries pass read-only validation.
- [x] Run `node --test test/server_protection.test.mjs test/server_commands.test.mjs` and confirm failures identify the missing behavior.
- [x] Implement bounded caches and private preflights; install before other dig wrappers; use known-denial checks in pathfinding/collection and wood candidate selection.
- [x] Re-run tests and `git diff --check`, inspect staged changes, commit the body repair.

## Task 2: Deliver permission facts to Neko

Files: `src/websocket/game_information.js`, `test/game_information.test.mjs`; Neko plugin `observations.py`, `service.py`, `__init__.py`, `test_observations.py`, `test_server_commands.py`.

Interface: `state.server.protection` carries enabled/last/denied targets; `protection` events carry the rejected action and coordinates. Neko compact context retains an instruction to avoid denied targets and a permission query entry, with one most recent failure.

- [x] Add failing tests for protection snapshots/events, compact budgets of 400/700 tokens, ordinary Chinese protection messages, and suppression of solicited query replies.
- [x] Run the new tests, implement within the existing plugin boundary, re-run the affected suites and commit.

Verification before deployment: 128 Node tests and 57 Neko plugin tests passed; logs are `D:/neko-mc-trial/protection-node-tests-20261009.tap` and `D:/neko-mc-trial/protection-python-tests-20261009.log`. Denial behavior is currently verified with simulated server replies; live nearby permission queries returned `allow_likely` and distant ones returned `unknown_out_of_range`.

## Task 3: Deploy and verify

- [ ] Pause the owned unattended lifecycle; cherry-pick verified changes into the live branches. Set `server_protection: "mycli"` in the local trial configuration.
- [ ] Restart only owned Minecraft/Neko processes and restore unattended mode; keep the local LLM and LAN viewer.
- [ ] Capture fresh game state and real permission replies. Verify guard-installed status, permissions reaching Neko, HP/connectivity/viewer health, and subsequent wood progress. Do not destroy an original building to test a denial.
- [ ] Record test counts and live evidence here, distinguishing synthetic denial tests from real server denials.
