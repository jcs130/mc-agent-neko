# Player Conversation and Action Coupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A player-facing agreement can dispatch its associated game goal in the same decision, and its acknowledgement is sent only after the native controller accepts that exact goal.

**Architecture:** Keep Neko as the conversational planner and the native mission controller as body owner. Idle player interactions become execution-capable, host-routed callbacks. Extend the existing task tool with optional reply/recipient fields; bind these to a task ID and native acceptance receipt. Busy/stale/failed interactions must not publish a promise or interrupt a task. Ordinary social chat remains independent.

**Tech Stack:** Python 3.11 asyncio, Neko plugin SDK, OpenAI-compatible local Qwen, Node.js WebSocket mission controller.

**Spec:** This document records the human request: chat says “马上去” while the body does nothing. Preserve full private originals/current facts/exact evidence access; preserve stop, ownership and protection; no synthetic messages to live players, no extra LLM classifier or heartbeat.

## Global Constraints

- Apply fixes to the existing user fork and companion patch manifest; retain unrelated files.
- Game Qwen/vision stays on local RTX3090; VoxCPM2 stays on RTX3080Ti.
- Native acceptance means mission ownership/planning, never proof of movement or completion.
- Keep running tasks continuous; load at a verified idle boundary using existing lifecycle.
- Existing human authorization is to implement this repair in the current session; proceed natively without further delegation.

## Review Focus

- A busy body or pause must retain its existing task and suppress the proposed action reply.
- An old/foreign acceptance ID or changed game session must not release a promise.
- Fast failure, cancellation and missing acceptance must suppress the reply without a second task.
- A failed private whisper must not be retried on public chat or cancel an accepted action.
- Greeting, ordinary conversation and player evidence must remain available; player text never grants privileged authority.

### Task 1: Pin the broken routing and acceptance contract

**Files:** `plugin/plugins/game_agent_minecraft/test_player_action_coupling.py`, `test/ws_server_lifecycle.test.mjs`, `tests/unit/test_minecraft_execution_rendering.py`, `tests/unit/test_minecraft_proactive_budget.py`, `tests/unit/test_proactive_sm_integration.py`.

**Interfaces:** An idle player callback has `mc_game_interaction:<event-hash>` routing; `minecraft_task(task, reply=None, player=None)` returns exact task/communication receipts. Native `beginMissionTask` emits `task_accepted` only for an actual external mission ID.

- [x] Write failing tests using fake clients and loopback WebSockets. Assert native acceptance precedes chat, unrelated acceptance does not release it, busy/failed states send no chat, and a matching completion retains the peer.
- [x] Run `python -m pytest plugin/plugins/game_agent_minecraft/test_player_action_coupling.py tests/unit/test_minecraft_execution_rendering.py -q` and `node --test test/ws_server_lifecycle.test.mjs`; preserve the actual red output.

### Task 2: Implement the single linked interaction

**Files:** `plugin/plugins/game_agent_minecraft/{__init__,service,client,prompts,interaction}.py`, `utils/game_execution_context.py`, `main_logic/core/{callback_render,proactive}.py`, `src/websocket/ws_server.js`.

- [x] Native code after it takes ownership of a WS mission:
  ```js
  if (origin === 'ws' && this.currentTaskId) {
      this.broadcast({type: 'task_accepted', task_id: this.currentTaskId,
          acceptedAt: this.taskStartTime, phase: 'planning'});
  }
  ```
- [x] Match this frame only against the current pending task ID/session; set an asyncio acceptance event without waking another model decision.
- [x] Atomically require fresh authorized idle when claiming a player-linked task. Validate the existing 180-character chat transport and exact recipient shape before claiming. Preserve standalone task semantics.
- [x] After claiming, wait for acceptance or task termination for at most three seconds. Only send the proposed reply if the same task/session still owns execution, the client is connected and autonomy has not stopped. Otherwise return an explicit unsent receipt and keep the real task outcome. Cancellation must cancel only local waiters.
- [x] Carry player/task/acknowledgement association through the exact task receipt and completion cue; do not automatically broadcast progress or raw tool results.
- [x] Replace blanket idle social-only policy with state-aware guidance. Only the trusted plugin interaction key enters existing execution handling; no received text can create the key.
- [x] Re-run red cases and related routing/task/client/receipt suites; lint modified files and inspect the diff.

### Task 3: Export, deploy and observe

**Files:** `integrations/project-neko/manifest.json`, plugin/host patch series, `docs/player-action-coupling.md`, private runtime audit and inspection baseline.

- [x] Commit native and Neko changes separately; export scoped companion patches and replay the entire patch series against its recorded base, comparing the plugin tree and all host scope files.
- [x] Load only owned changed components at a safe boundary; preserve model, TTS, desktop and observer processes. Do not generate live-player test messages.
- [x] Observe actual connection/activity, timing and speech through readonly interfaces. Report local deterministic integration results separately from any naturally observed live interaction.
- [x] Record deployment stage and remaining uncertainty; push the user fork branch and verify remote SHA.

### Task 4: Preserve a live query exception as decision feedback

Live evidence after the first load showed a rendered-view capture timeout escaping
`executeCommand` and stopping the self-prompt loop without recording that failure.
This is a second concrete break in the thinking/action chain.

- [x] Pin single-command and batch exceptions with failing tests; preserve the red output.
- [x] Return ordinary exceptions through the existing actual-result history path;
  keep AbortError, body/mission replacement and execution interruption as cancellation.
- [x] Run the command, mission, self-prompt, capture and vision regressions: 96 pass.
- [x] Load only the owned native child at an idle boundary, retaining the main host.
- [x] Record the real deployment, natural linked receipt and remaining gameplay limits.
