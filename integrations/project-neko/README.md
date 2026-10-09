# Project N.E.K.O. companion patches

This directory carries the matching Project N.E.K.O. Minecraft plugin changes
alongside the Minecraft body in this fork. The ordered plugin series includes
scoped protection receipts, adaptive heartbeat pacing, readable custom items,
protected operational inventory, storage capacity, matched recovery history,
compact task authority and conditional post-observation action guidance.
The manifest lists the exact series plus one approved host bridge patch.

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

The exported plugin passed 155 tests. The manifest records the exact reproduced
plugin tree and host-file blobs. The host callback/media regression suite passed
195 tests, including six new Minecraft budget tests. The matching native body
passed 405 tests; this contribution branch passed 411 tests. The existing
mineDown contract test also passed.

Follow the patched plugin's README for the existing N.E.K.O. plugin lifecycle,
viewer and unattended settings. On the Minecraft body, set
`external_autonomy_owner` to `"neko"` when N.E.K.O. owns autonomous decisions;
set `server_protection` to `"mycli"` only on a server advertising that protocol.
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
The final plugin suite passed 155 tests, the matching native source passed 405,
and this contribution branch passed 411.

After the final reload, a separate passive window confirmed another autonomous
task with 5.2 blocks of movement and no handoff failure. A subsequent fresh
inventory snapshot confirmed a new stone pickaxe (125 cobblestone and 15 sticks,
previously 128 and 17). The body reported completion and the main model dispatched
its next task. Health was 20 and food 17. The viewer returned HTTP 200 and the
supervisor reported all services ready with zero recoveries. This verifies a
short task transition, not the correctness or eventual success of the next goal.

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
