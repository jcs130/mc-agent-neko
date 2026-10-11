# Player conversation and game action coupling

This companion fixes the case where Neko tells a player she will come over but
the conversation turn never submits a physical task. It targets the existing
local deployment: Neko plans conversation, the native MC mission controller
owns the body, and both continue using the configured local Qwen service.
The existing conversation and execution routes are reused; no additional LLM
classifier, periodic decision loop or inference slot is introduced.

## Before and after

Previously every pure player-chat callback was marked social-only, including
when the body was idle. `minecraft_chat` sent words but scheduled no action.
An unrelated autonomous turn had to rediscover what the player wanted.
Pre-tool narration could also reach speech even when a task was rejected.

Fresh idle player messages now enter the existing execution-capable callback
route. Neko can choose ordinary conversation, waiting, or an authorized action
in that same decision. To agree to an action it uses the existing tool:

```python
minecraft_task(task="Follow the observed route to the mine entrance",
               reply="我来试试，入口见。", player="Friend_1")
```

`reply` and `player` are optional. When supplied, the action and proposed reply
share one task ID. The native controller emits `task_accepted` after installing
that mission. Only the matching current task and game session can release the
reply. A successful socket send alone is insufficient.

Acceptance means **controller ownership and planning**. It proves neither
movement nor arrival nor completion. Later actual task outcomes retain the
original peer and communication receipt. Completion guidance tells Neko to
report a useful actual result to that peer, keeping private conversations private.
It does not automatically broadcast internal results or resend the old goal.

## State and failure behavior

- Busy, stopped, stale or unavailable bodies cannot claim a player-linked task.
  The existing task keeps ownership; a linked interaction cannot overwrite it.
- A greeting needs no movement. `minecraft_chat` remains available while busy,
  with guidance to explain the actual state instead of promising an unqueued action.
- Missing, foreign or outdated acceptance leaves `communication.status=not_sent`.
  The bounded three-second wait does not cancel a task that may still be running.
- Fast failure returns a terminal receipt with `pending=false`, rather than a
  false asynchronous success. Stop, session change and reply-wait cancellation
  suppress the proposed agreement. Cancellation removes only owned reply waiters.
- Failed or unconfirmed whispers do not fall back to public chat and do not
  cancel an accepted action. Existing chat transport echo status is preserved.
- Pre-tool speech in execution turns is released according to this round's
  task receipt; failed or explicitly unconfirmed actions cannot substantiate it.
  Actual final blocker explanations remain available. The original model text,
  tool results and game records remain in their existing private history.

Player text remains observed data, with no administrative authority. Host routing
fields create the execution scope; words supplied by a player cannot create it.
The complete-originals/current-facts/query-entry architecture remains in place.
No game evidence is trimmed, no new activity priority is hard-coded, and no
live-player or Bilibili test message is sent.

## Protocol and integration

Native commit `85191c4660fb443a231abf76f8cc39e52d9f58f1` adds the task-ID acceptance
frame in `WSMessageServer.beginMissionTask`. Apply plugin patch 0087 and host
patch 0034 from the manifest with this native change. Neko source commit:
`7e15b51800b57374eac9877d289107577ad71a71`.

Legacy executors without this frame still run ordinary tasks. A linked reply
stays explicitly unconfirmed rather than assuming that transport means acceptance.
This repair does not guarantee that navigation, trade prerequisites, protection
rules or a later planner decision will succeed. Those require actual action receipts.

## Thrown query and action failures

Live tracing found a second break in the same decision/action chain: a visual
capture raised `page.waitForFunction: Timeout 23275ms exceeded`. The exception
escaped command execution, so the self-prompt loop logged an error without adding
the failed query's result to history. Later decisions could repeat the inspection
instead of knowing it had failed.

Native follow-up `d7ed3908983fa894058b9d9bb786f58af1f7b133` records an ordinary
command exception as an actual `Action failed:` result. It confirms neither
completion nor absence of partial side effects. The normal history/mission feedback
path receives that result, and a failed batch does not execute its remaining actions.
The planner can choose a physical step from existing structured game observations.
This does not change capture readiness, increase its timeout or disable vision.

Abort, body replacement, mission replacement and execution interruption retain
their cancellation semantics. An old command's exception cannot become a result
for a new body or task. Vision preemption now explicitly uses `AbortError`.

## 回归报告 / Regression Report

Changed the idle player callback route, atomic linked task claim, exact native
acceptance handling, peer-associated outcomes and receipt-gated pre-tool speech.
The necessary change is to bind the conversational agreement to the same
controller-owned task instead of two independent decisions.

Before: idle chat prohibited task dispatch and an unsuccessful dispatch could
still emit its action prelude. After: a linked task waits for exact acceptance,
and failure or missing acceptance leaves the reply unsent. Busy tasks and ordinary
social replies retain their existing ownership and availability.

Validation on 2026-10-12: **659 Python tests, 47 subtests, and 96 native tests pass**.
Coverage includes a real loopback WebSocket exchange, foreign ACKs, stop/session
races, fast failure, cancellation, missing ACK, failed private replies, busy
ownership, unchanged original history and trusted host scope. Ruff and Git
whitespace checks pass; existing deprecation and invalid-noqa warnings remain.
Initial failing tests were retained privately before implementation.

The additional native cases reproduce thrown single-query and batch failures,
prove that the next decision receives the actual failure and can issue an action,
and preserve abort/body/mission interruption. They passed with the existing command,
mission, self-prompt, capture and vision request regressions. No new model round
is inserted by exception handling.

The full companion series (**87 plugin + 34 host patches**) was replayed against
the recorded base. The plugin tree and all 61 host scope files match the source;
the two deployed native source/test files match the native commit. Private
credentials, player logs, model content and runtime configuration are excluded.

Possible regressions: social turns could gain execution semantics when idle,
an older executor could leave a reply unconfirmed, or a session/stop race could
otherwise send an incorrect promise. Tests cover those boundaries. A live
natural player invitation is separate acceptance evidence from deterministic tests.

The first integration loaded at a verified idle boundary on 2026-10-12 05:30
(Asia/Shanghai), preserving the model, TTS, desktop, observer and monitor processes.
A natural player-linked task subsequently received exact native acceptance and
submitted its private reply. `submitted` is not a confirmed server echo; that
escape task later failed. Short passive observation also recorded two deaths
and respawns before the follow-up load. Those failures remain part of the evidence.

The command-exception follow-up loaded at another verified idle boundary at
05:42, updating only the owned native child and retaining Neko host PID 60892.
Model, TTS, desktop, observer and monitor identities remained unchanged; no
history reset was performed.

After this load, another naturally generated linked task received exact native
acceptance and a server-confirmed private reply echo. The following 55-second
window observed `goToCoordinates` and `moveAway`, about 11.9 metres of displacement,
continuous connection and 20 health/food. Both LAN scene streams, minimaps and
appearance resources remained active. Twelve natural speech deliveries since
the first load had matching playback completion and no duplicate playback cycles
or identical repeated replies in that sample.

This verifies natural acceptance, private echo and body execution. The associated
trade/arrival attempt later returned `failed: no-progress`; it was not a completed
purchase. Successful completion, sustained survival, audible quality and natural
recovery from another capture exception remain open.
The deterministic exception-path tests and actual loading are recorded separately.

## 不拆分理由 / Why Not Split

The native protocol is committed separately. Plugin and host companion changes
share one linked interaction contract; deploying only the routing or narration
change would retain the inconsistent acknowledgment behavior. Their scoped
patches can be reviewed separately and replay together. The counted source-file
limit is not exceeded; this note also records the cross-repository dependency.
