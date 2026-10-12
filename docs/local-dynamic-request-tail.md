# Local Minecraft dynamic request tail

This optimization targets the existing local Strata / Qwen deployment. It fixes
repeated native request assembly and keeps changing execution state after
reusable history. Model weights, GPU assignment, thinking, output limits,
checkpoints, parking slots and call frequency are unchanged.

## Final request layout

For opted-in `http://127.0.0.1:18030` native external tasks and code execution:

1. The controller's fixed system instructions and documented commands.
2. Complete retained task history, including player messages and actual results.
3. The controller-created dynamic execution block: current task, progress and
   fresh queried position, inventory and vitals.

The boundary comes from `executionPromptTemplate()`'s explicit dynamic marker,
not a guessed token count or arbitrary character offset. Unknown boundaries,
foreign endpoints, the Responses adapter and vision keep their layout policies.
The native client adds no `strata_prefix`; the main brain remains its sole owner.
The existing ordinary-goal-position experiment remains off.

`strictFormat()` now owns the message objects it returns. Previously it trimmed,
demoted and merged caller objects in place, and `GPT.sendRequest()` formatted
those same objects again before sending. Adjacent results could occur twice and
retries could add further copies. The unused first pass is removed, merges work
on copies and filler messages are independent. The saved original history stays
complete. These ownership fixes apply to all users of the native formatter.

## Main brain audit

N.E.K.O. already constructs execution requests as retained history, explicit
speech recency and one temporary current game cue. The cue is not appended to
saved conversation history; the next cue replaces it on the next request.
Current tool calls and matching actual results follow the cue. New tests cover
the real `prompt_ephemeral()` constructor through the final `ChatOpenAI._params()`
projection, repeated calls, complete human-stop evidence and intact tool pairs.
The host production code therefore needs no change or reload.

Do not move the entire initial system suffix behind history: the installed
Strata frontend's `_late_system_to_user()` changes late system messages into user
messages, and the Qwen template rejects late system roles directly. Session
directives and permissions must retain their instruction authority. Frequent
world facts are already supplied in the temporary tail cue and actual receipts.

## Offline measurements and regression

The installed Q2_0 tokenizer and actual model template rendered final SDK bodies
from three complete retained native task groups. Fixed instructions and three
dynamic states were controlled fixtures; this is an offline layout comparison,
not historical production latency or a server cache-hit measurement.

| Retained turns | Input before → after | State-change common prefix before → after |
|---:|---:|---:|
| 74 | 11,373 → 11,165 | 79 → 11,148 |
| 65 | 10,558 → 10,352 | 79 → 10,335 |
| 23 | 2,971 → 2,672 | 79 → 2,655 |

Changed-goal common prefixes improved by the same 11,069 / 10,256 / 2,576 tokens.
Removing duplicate formatting saved 208 / 206 / 299 input tokens respectively.
All nine baseline assemblies mutated caller history; all nine updated ones left
it intact. The tests separately reproduce repeated formatting, frozen input,
capacity retries, one occurrence per receipt, current-goal instructions and the
continuous native checkpoint policy.

- Native focused suites: 25 passed.
- Native full suite: 876 passed out of 879. The same three entity-identity tests
  fail on an isolated baseline checkout: their old truncation assertions conflict
  with already retained complete names/entities. No related new failure appeared.
- Host tool/client/narration suites: 196 passed, with two existing deprecation warnings.
- Ruff passed for the new host test. Targeted native lint and syntax checks passed.
  The existing GPT module has three unchanged missing-semicolon findings with
  an ES2022 parser; the repository's default ES2021 parser also predates its class
  fields. No new lint finding was introduced.
- Full companion replay: 93 plugin patches and 35 host patches; all 62 scoped
  host files and the unchanged plugin tree match source commit
  `51587cc7cbd012e70d99217cf939337c112ed150`. Host patch 0035 adds only tests.

Checks and metadata-only measurements are retained locally in
`D:/neko-mc-trial/runtime/request-tail-20261012-1514/`. No extra model inference,
game action or audio synthesis was used for the comparisons. Common-prefix
length is an opportunity for reuse, not a promise: shared traffic, tool-set
changes and evictions can still yield zero reuse.

## Deployment

Deployed from fork commit `aab205fd10d25af284b3bb92ced5e410768ed9d7` on
2026-10-12 at 15:41 Beijing time. Only `src/models/gpt.js` and
`src/utils/text.js` were copied after checking their exact code preimages and
recording backup/source/runtime SHA-256 values. The existing MindServer restarted
only its owned `ag_NEKO` child at a measured idle boundary. The new game session
reconnected and received server-confirmed automatic authentication within about
9.5 seconds; this was a reconnect, not preservation of the old game session.

Main brain, plugin host, MindServer, model/vision, VoxCPM2, desktop, observer,
live and monitoring process identities were preserved. The owned unattended
guardian was paused only for this bounded operation and resumed with zero
recovery attempts. No host-production reload was necessary.

The initial natural observation window through 15:45:18 contained six native
external-task execution requests, all producing validated commands. The first
was cold; the next five each reported 7,889 reused input tokens. For example,
one input of 9,781 tokens reused 7,889 and processed 1,892 new tokens. Two native
summary requests and 20 host requests also completed; no context-capacity error
was observed in this window. This verifies actual reuse and command production,
not paired latency improvement or successful completion of a broader commission.

A separate passive 35-second sample received 24 fresh online game frames with
advancing world age, full health/food, and a naturally initiated backpack action.
Audio delivery matched the desktop playback-end acknowledgement with an empty
queue. No test game command, extra inference or audio synthesis was injected.
Metadata-only deployment and natural-acceptance evidence is in the local artifact
directory above. The deployment remains `deployed`; productive autonomy and
overall latency improvement are not claimed as verified.
