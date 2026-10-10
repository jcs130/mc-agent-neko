# Project N.E.K.O. companion patches

**Local deployment optimization:** this bundle includes the matching N.E.K.O.
host and Minecraft plugin changes for a shared local Strata / Qwen service.
The [local deployment guide](../../docs/local-llm-optimization.md) covers opt-in
configuration, one-RTX-3090 measurements, caller/thinking boundaries and features
that remain experimental. Private provider configuration and model weights are
not included.

The idle decision recovery companion changes keep query replies from resetting
progress/backoff, distinguish accepted quest receipts from browsed catalogues,
and reserve an existing final request for optional execution in confirmed idle
Minecraft turns. Spoken plans are not stored as execution evidence. See
[the recovery and progress-watch report](../../docs/neko-idle-decision-recovery-2026-10-11.md)
for ownership, cancellation, verification and live outcome limits.

Metadata-only native and host timings distinguish preparation, SDK return,
stream fragments and validated commands. See [the timing guide](../../docs/llm-client-latency.md)
and [the natural workload and concurrency observations](../../docs/llm-client-latency-observations-2026-10-10.md).
The isolated ordinary goal-position experiment did not improve changed-goal
reuse and remains off; it is documented separately from the earlier prefill work.

Game narration now describes positions using observed landmarks or known
relative directions, leaving exact coordinates in observations and tool
arguments. The matching NEKO Live preference uses its supported configuration
entry; no TTS number filter or extra model request is introduced. See
[the narration verification report](../../docs/neko-live-narration-2026-10-10.md).

The optional local Strata policy now separates stable execution rules from
changing state, pins only the Minecraft brain's validated prefix, pages complete
observation references and defers optional background inference. See
[the prefill measurement report](../../docs/neko-llm-prefill-2026-10-10.md)
for configuration, measured tokens, native formatter repair and limits.

Bounded planning now keeps received NPC IDs, custom names and coordinates,
and explicitly marks sampled nearby lists as partial. See
[the NPC planning report](../../docs/neko-npc-decision-context-2026-10-10.md)
for the reproduced loss, regression coverage and runtime limits.

Bounded completion, idle and observation context now preserves task conclusions
before duplicated command/inventory appendices. Long goal names no longer
consume the result's entire budget. Full feedback remains queryable. See
[the feedback report](../../docs/neko-task-feedback-2026-10-10.md)
for the two reproduced losses and verification limits.

Native task endings now require current game evidence, and inventory
observations follow player slots in initialized open merchant/container windows.
This prevents an unobserved first reply from completing or abandoning a task,
and avoids stale counts during trading. See
[the task evidence and inventory report](../../docs/neko-task-grounding-inventory-2026-10-10.md)
for the reproduced failures, scope and verification limits. The same report
covers listener reuse and retirement of old action waits/callbacks on reconnect.

The [Windows guardian reference](deployment/README.md) preserves the unattended
deployment fix that waits through remote server outages without repeatedly
recovering a healthy game process. Its isolated regression scenarios are separate
from the source patch series and require no running game or model.

The native body now exposes carried cursor items and an exact-window close
command, avoiding repeated chest reopening when a plain click lifts an item.
Reconnect-time action errors also survive an uninitialized output buffer. See
[the cursor and reconnect report](../../docs/neko-cursor-reconnect-2026-10-10.md)
for the reproduced failures, tests and deployment limits.

The latest storage repair retains named backpacks and feasible material-selling
offers in bounded planning context. Its native tools distinguish the ordinary
Minepacks warehouse from the personal reward container and a conflicting
BetonQuest menu. They verify real window, slot and cursor updates. See
[the economy and storage report](../../docs/neko-economy-storage-2026-10-10.md)
for the live command collision, verified round trip and reward prerequisite.

The survival repair retains actual melee equipment in bounded planning
and emergency context, including unknown inventory states. It pairs with the
body's corrected combat/retreat handoff for unarmed players, swarms and nearby
wall-blocked mobs. Task inventory deltas and real action receipts also preserve
evidence when the native model forgets a successful craft.
See [the evidence and verification report](../../docs/neko-survival-combat-2026-10-10.md).

This directory carries the matching Project N.E.K.O. Minecraft plugin changes
alongside the Minecraft body in this fork. The ordered plugin series includes
scoped protection receipts, adaptive heartbeat pacing, readable custom items,
protected operational inventory, storage capacity, matched recovery history,
compact task authority and conditional post-observation action guidance.
The manifest lists the exact plugin series and six companion host patches.

The series targets [Project-N-E-K-O/N.E.K.O](https://github.com/Project-N-E-K-O/N.E.K.O)
at commit `fb2a2e731a8c954478d08678b0c8cf40e8145a54`. It changes only
`plugin/plugins/game_agent_minecraft/`: the modern viewer panel, full game
observations and welcome context, public/private communication tools, server
skills, unattended sessions and decision/action feedback. Local provider
configuration, model weights, credentials, runtime logs and character memories
are outside the bundle.

`manifest.json` records the base and source commits, each patch's SHA-256, and
the exact resulting plugin tree. Patch bytes are preserved by `.gitattributes`.
The upstream project's Apache-2.0 license continues to apply to its plugin code.

## Apply in a clean N.E.K.O. checkout

Use a separate branch and save any existing changes first. Set `$mcAgentFork`
to the path of this mc-agent-neko checkout. From the N.E.K.O. repository:

```powershell
$mcAgentFork = 'C:\path\to\mc-agent-neko'
git switch -c integration/neko-gameplay fb2a2e731a8c954478d08678b0c8cf40e8145a54
$patchDirectory = Join-Path $mcAgentFork 'integrations\project-neko\patches'
$pluginPatches = @(Get-ChildItem -LiteralPath $patchDirectory -Filter '*.patch' |
    Sort-Object Name | Select-Object -ExpandProperty FullName)
git am @pluginPatches
$hostDirectory = Join-Path $mcAgentFork 'integrations\project-neko\host-patches'
$hostPatches = @(Get-ChildItem -LiteralPath $hostDirectory -Filter '*.patch' |
    Sort-Object Name | Select-Object -ExpandProperty FullName)
git am @hostPatches
```

If a patch cannot apply, resolve it using normal `git am` conflict handling or
use `git am --abort` to return to the original branch state. Newer upstream
revisions can require a rebase; compatibility with arbitrary later revisions
has not been established.

## Verify and configure

With N.E.K.O.'s dependencies installed:

```powershell
python -m unittest discover -s plugin/plugins/game_agent_minecraft -t .
git rev-parse HEAD:plugin/plugins/game_agent_minecraft
```

The manifest is authoritative for the current bundle: 67 ordered plugin patches
and eight host patches reproduce the declared source's plugin tree and all 26
affected host-file blobs. Test counts are dated delivery evidence, not a claim
that every later checkout has already been tested. See the
[prefill verification report](../../docs/neko-llm-prefill-2026-10-10.md) for plugin
coverage and the [latest timing delivery report](../../docs/llm-client-latency-observations-2026-10-10.md)
for the native, contribution and host regression results. The
[avatar call audit](../../docs/neko-avatar-calls-2026-10-10.md) covers local
turn coalescing, separate emotion calls, and the remaining one-pass metadata
experiment.

Follow the patched plugin's README for the existing N.E.K.O. plugin lifecycle,
viewer and unattended settings. On the Minecraft body, set
`external_autonomy_owner` to `"neko"` when N.E.K.O. owns autonomous decisions;
set `server_protection` to `"mycli"` only on a server advertising that protocol.
When the bare `/backpack` alias is owned by another plugin, set
`backpack_command` to `"/minepacks:backpack open"` on a server advertising
Minepacks. Other servers can leave this optional setting `null` to use the
observed named item's shortcut.
Use the existing plugin configuration APIs to apply live settings. Start N.E.K.O.
and its Minecraft plugin together; loading patches alone does not start gameplay.

Permission receipts remain specific to their action, dimension and coordinates.
An `allow_likely` result is tentative, and missing tools or local digging-safety
refusals must not be described as confirmed server protection denials. These
changes improve information and scheduling; they do not guarantee unattended
survival or successful ore collection.

## Task authority and observed progress

The latest user's stop, pause or specific instruction takes priority over
configured unattended play. A screenshot, observation, completion receipt or
server/player text supplies facts, not a new task authorization. When ongoing
autonomous play remains authorized, the main N.E.K.O. model chooses a short,
feasible next goal and calls `minecraft_task`; announcing a plan does not execute
it. Task dispatch alone does not confirm completion.

`minecraft_observe` appends plugin-owned execution metadata and guidance after
the bounded received facts. The conditional `ready_if_authorized` result requires
fresh online state, a connected body and confirmed idle activity with no pending
or unfinished task. Disabled/stopped sessions, busy bodies and unknown or stale
state do not suggest a new action. The plugin cannot read every latest human
instruction, so its metadata never grants unconditional user authority. Uncertain
recipes should be verified as the first step of a bounded goal; the model must
not invent conversions such as slabs back into planks.

Read-only runtime observation confirmed autonomous task dispatch and server
inventory updates: first spruce planks, sticks and a wooden pickaxe, then a
crafting table. The respective snapshots showed 12 spruce planks, 16 sticks,
one wooden pickaxe and later one crafting table; these quantities were observed
at different times. N.E.K.O. then dispatched its own goal to leave the village
and mine. Before the final native patch deployment, it was at
`(-577.5, 53, -454.5)`, with health and food both 20, and coal had increased from
64 to 71 while the body dug coal ore. All eight welcome/context segments were
received and pushed. These observations used no diagnostic game tasks or chat.

The matching native changes address two further interruptions. Bare required-arg
command names in prose previously reached execution and stopped self prompting
before argument validation; actual-call parsing and validation now precede the
goal-state update. Lifecycle controls currently require their own command line,
as documented in the executor; reviewers should check that rule against upstream
usage. A progressing wood harvest also receives at most eight seconds to handle
tree-canopy geometry, using an actual tree dig target retained for no more than
three seconds within the same action generation. Vital danger, sealed rooms,
stone/unknown geometry and persistent traps keep their recovery paths.

The material gains above occurred before the final parser/canopy deployment;
they cannot be credited entirely to those changes. They establish real short-run
progress, not long-run unattended reliability. See
[`docs/neko-recovery-diagnosis-2026-10-09.md`](../../docs/neko-recovery-diagnosis-2026-10-09.md)
for the diagnosis and verification scope.

After the final native reload, Neko independently queried server skills and used
the home skill; its position returned from underground to the surface. It then
dispatched the next wood-gathering task and the body moved 27.5 blocks with real
inventory changes in a read-only 55-second window. Health and food were 20/20;
that window does not establish completed log collection or overnight reliability.

Mission-owned standby now refuses a wait that would exhaust the current
inactivity or wall deadline, leaving a conservative 30 seconds for a follow-up
decision/report. Refusal returns the available wait without starting a timer or
claiming completion. Standalone waiting and human/vital interruption keep their
existing behavior. The reloaded body also automatically ate carried food.

## State-aware decisions and bounded context

Routine progress updates now refresh the plugin cache without repeatedly asking
the main model to replan an active body action. Completion, failure, idle state,
new danger and direct communication have separate cues. Ordinary public chat is
deferred while busy; direct messages use a social-only cue. A successful idle
planning request holds a 30-second lease while the model is still responding;
accepting a task clears it, preserving the existing ten-second first check after
the next completion. Danger and direct communication bypass this lease.

`minecraft_observe` defaults to a bounded summary even when callers specify
sections. Full reference retrieval requires `detail="full"` and explicit sections.
Scene projections retain fresh survival state, resources, relevant custom items,
permission scopes and excerpts from actually received server guides. Omitted
critical details are flagged for retrieval. Received server text remains data,
not authorization. Welcome fragments use stable replacement keys and expiry.

On one identical captured state, the old default observation was 18,427 tokens;
the complete new default tool result was 1,501 tokens, a 91.9% reduction. This is
an observation-result comparison, not a measured reduction in all model prompts
or end-to-end response time. Native model-facing history is bounded separately;
memory summaries are batched, single-flight and deferred behind foreground
actions, while original pending facts and archives remain durable. Current task
and fresh state take precedence over stale goals, positions and vitals in memory.

Read-only capture after the first deployment confirmed a 912-token active cue
with real server-guide excerpts reaching the main model. A 55-second passive
window showed an independently dispatched task, movement and inventory changes.
It did not prove successful escape or long-term survival. That window exposed
duplicate planning while inference was in flight and an overlong explicit query;
the lease and explicit full-reference choice address those cases. A separate
native fix makes `goToSurface` return navigation failure truthfully. Model action
selection can still be wrong; no diagnostic gameplay commands were injected.

See the exported plugin's
`docs/2026-10-09-decision-context-budget.md` for the scheduling table and limits.

Received gameplay routes now have their own bounded `serverPlay` index. Skill
catalogue sentences cannot displace later village-board instructions; carried
books contribute exact guild commands and trial page locations, without treating
historical registration or vitals as current progress. Once safe and equipped,
autonomous decisions can continue village, guild/commission or trial goals through
documented server actions as well as physical tasks. Server actions no longer
require an unrelated physical task afterwards. Acceptance, completion and rewards
each require actual server receipts.

Two captured-state replays retained all three entry points at both 700 and 400
tokens. Complete idle cues were 858 and 894 tokens; no diagnostic game commands
were sent. See the exported plugin's `docs/2026-10-09-server-play-context.md` for
the reproduced failure and regression scope. These checks establish information
delivery, not successful quest acceptance or trial completion.

After the initial route deployment, passive observation confirmed autonomous
queries of the world board and `tm_first_spell` marked `in_progress`. The actual
`guild claim` reply reported `MC_MARKET_CHECK` with `ready=true`, then advanced
to stage 2/2, meeting the supply merchant. This establishes acceptance and the
first stage's server verification; the complete contract and trials remain
unverified. One earlier reload transition refused a body handoff while the old
action was exiting; later survival feedback and fresh state showed recovery to
20 health/20 food with a newly crafted wooden pickaxe. No diagnostic game tasks,
chat or skill commands were injected.

The final follow-up distinguishes skill queries from actual cast syntax and
marks structured server errors as rejection, with the server's correction
candidates. Namespaced telemetry identifiers are not assumed to be cast IDs.
That guidance was added after the first-stage evidence above. These changes are
deployed; the final reload occurred with no pending task and no busy body.

The selected quest detail now survives plugin recreation through the body's
received `mcagent:market` state. `serverPlay.focus` carries the quest ID, reported
stage, next goal and receipt age; it remains a reference to verify, never an
inferred acceptance or completion. At tight budgets this focus takes priority
over unrelated activity entrances. This addresses an observed switch back to
coal after a reload and an incidental prospecting reply. A third captured-state
replay retained `tm_first_spell`, stage 2 and goal `trade` at 700 and 400 tokens;
the busy body did not trigger another idle decision. The source suite passed
167 tests. Long-run goal adherence and whole-contract completion remain unproven.

The market channel can replace a detail packet with `MC_MARKET_CHECK`. That
schema is also projected, preserving its task/stage, actual progress, readiness
and received correction commands. A fourth real-state replay retained stage 2,
goal `trade`, progress 0, `ready=false` and the exact detail query at both budgets;
its complete idle cue was 882 tokens. Final live observation after reload
confirmed the same quest focus, including the unfulfilled trade requirement.
At that context-budget delivery, the plugin suite passed 155 tests, the native
source passed 426, and the contribution branch passed 432. Current code/vision
verification is recorded above and in the linked capability report below.

After the final reload, a separate passive window confirmed another autonomous
task with 5.2 blocks of movement and no handoff failure. A subsequent fresh
inventory snapshot confirmed a new stone pickaxe (125 cobblestone and 15 sticks,
previously 128 and 17). The body reported completion and the main model dispatched
its next task. Health was 20 and food 17. The viewer returned HTTP 200 and the
supervisor reported all services ready with zero recoveries. This verifies a
short task transition, not the correctness or eventual success of the next goal.

The native executor also preserves explicit failed action results and stops the
remaining fixed batch on failure or argument rejection. Default fixed batches
contain at most three commands; after a completed action takes the accumulated
batch to 30 seconds, the model receives a fresh decision boundary. Healthy skills
are not forcibly stopped by this batch budget. A reflex invocation is bound to
its original body and cannot interrupt itself merely because a watchdog reset
its active flag. Retired-body completions cannot clear a new mode invocation.
See [the action feedback and learning audit](../../docs/neko-action-feedback-and-learning-2026-10-09.md)
for the root causes and the earlier delivery state. Generated scripts and visual
queries are now enabled through the native task executor; all three model roles
share the existing local Qwen endpoint. Image encoding now runs on the same
RTX 3090 as the language engine. There is no automatic visual
heartbeat or separate VLM download. See [the current capability report](../../docs/neko-local-code-and-vision-2026-10-09.md)
for setup, limits and actual probes. Experience memory and existing skill
discovery remain enabled; automatic skill evaluation/promotion and model-weight
training are not implemented. No additional N.E.K.O. platform patch is required.
The later [same-card vision deployment report](../../docs/neko-same-3090-vision-2026-10-10.md)
records the GPU configuration, memory use and measured latency; the earlier
capability report retains its original CPU measurements.

## Approved host bridge fix

The separately ordered `host-patches/` series fixes a platform transport bug:
the host previously parsed Minecraft cues through a generic 200-token result
summary before the documented 1,000-token callback cap. Current resources and
recovery evidence disappeared before reaching the model.

The fix retains Minecraft `push_message.v2` text up to the existing
host callback cap. Other plugins and legacy payloads keep their existing
parser/limits. Apply this host series after the plugin series. Patch bytes and
scope paths are recorded separately in the manifest. Restart the N.E.K.O.
launcher/main process after applying it; restarting only the Minecraft plugin
does not reload the host bridge.

The user approved this specific platform change under N.E.K.O.'s `CONTEXT.md`
escalation requirement. It was applied and the host restarted. Passive capture
confirmed complete 759- and 858-token Minecraft cues in the actual model input,
including tool durability, resources and custom-item identity. Plugin-only
installation leaves the earlier transport bug unresolved.

## Merchant offers after custom NPC menus

Patch 0056 keeps received merchant status, offer count and a small quote sample
in planning context, with a full-window observation route when quotes are
omitted. The matching native changes decode `trade_list`, render real offers
in `!window`, and expose `!tradeWindow` for the current merchant without reopening
its NPC. Empty ingredient slots no longer imply an empty offer list. See
[the merchant repair report](../../docs/neko-merchant-offers-2026-10-10.md)
for packet handling, server inventory confirmation and verification limits.

## Chinese item and skill names in speech

Patch 0057 asks the existing persona model to speak item/skill names, states and
errors in Chinese while preserving exact tool arguments, commands, player names
and received game evidence. Responding callbacks reserve space for this rule
within their existing limit; no translation inference or heartbeat is added.
The plugin suite passed 183 tests, and all 57 plugin patches reproduce the
declared source tree. See [the speech verification report](../../docs/neko-chinese-speech-2026-10-10.md)
for local model probes and the passive deployment evidence.

## Optional local IndexTTS 2.5 voice backup

Host patch 0007 preserves the selected free voice as primary and uses the
native exclusion/replay runtime to fall back to an explicitly configured local
clone. It keeps online credentials out of the local HTTP worker, decodes the
backend's native 22.05 kHz PCM correctly, and retains cancellation and stale
worker fences. It does not add a model call for emotion or avatar control.

The accompanying `services/local-index-tts/` deployment uses pinned vLLM-Omni
in WSL on the RTX 3080 Ti; the game LLM and vision stay on the RTX 3090.
Reference audio, weights, actual voice IDs and private configuration are not
included. Defaults remain opt-in. See [the local deployment guide](../../docs/local-index-tts-backup.md)
for installation, the 68-second initial warmup, measured steady-state latency,
native end-to-end limits, failure behavior and real deployment verification.
