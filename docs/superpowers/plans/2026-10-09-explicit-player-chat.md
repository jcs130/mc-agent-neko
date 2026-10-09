# Explicit player conversation repair

**Goal:** Keep tool calls, action narration and diagnostics out of Minecraft chat while retaining intentional public conversation and private messages.

**Evidence:** `DEBUG_CHAT=0` is already active, but trial `chat_ingame=true` lets `Agent.openChat` publish translated body responses plus their complete `!getWood(...)` / `!cannotComplete(...)` command suffix. The Neko `minecraft_chat` bridge is independent of this automatic output. Private replies already accept an explicit `player` but the conversation guidance does not prioritize them.

**Scope:** Implement in existing MC/Neko worktrees. Neko edits stay in `plugin/plugins/game_agent_minecraft/`. No changes to the model, protection adapter or LAN viewer.

## Implementation

- [x] Reproduce the leak with the actual `Agent.openChat` method in a VM. Assert external conversation ownership suppresses all body public/private automatic output while retaining WebSocket/local UI responses; standalone chat still works without tool suffixes. Assert `chat_ingame=false` also suppresses `only_chat_with` auto-whispers.
- [x] Fix automatic output at its source and make debug chat opt-in. Set the trial `chat_ingame=false` during deployment, leaving the explicit `minecraft_chat` tool enabled.
- [x] Add tests for explicit public/private plain text, rejection of tool-call/diagnostic formats, offline recipients, and duplicate suppression. Preserve the genuine communication paths and allow slash gameplay commands through the separate server tool.
- [x] Guide Neko to keep actions/plans/tool results in local UI, use public chat for actual replies/help/cooperation, and proactively whisper a real online player for individual conversation. Keep incoming private replies private.
- [x] Run affected/full plugin tests and MC chat/routing/runtime tests, inspect diffs and commit.
- [ ] Deploy to owned services, restore unattended play, verify fresh flags/ownership/model/viewer health and observe public output. Validate private routing with isolated tests rather than unsolicited test messages to real players.

**Runtime boundary:** Intentional conversation may use `minecraft_chat` only. Repeated identical conversation gets a bounded cooldown. Machine-format validation is not a semantic classifier: prompt guidance governs conversational relevance, while automatic body output is blocked deterministically.

Before deployment, 70 MC tests and 60 Neko plugin tests passed. Evidence: `D:/neko-mc-trial/explicit-chat-node-tests-20261009.tap` and `D:/neko-mc-trial/explicit-chat-python-tests-20261009.log`. Real WebSocket tests verify a private message reaches only the selected fake recipient with automatic chat disabled. No test messages are sent to other server players.
