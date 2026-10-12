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

Prepared. The native change requires an owned native-child reload at a measured
safe idle boundary. Keep the main brain, plugin host, model and vision, TTS,
desktop, observer and live services continuous. Record actual process identities,
reconnection/authentication and subsequent natural requests before claiming
runtime acceptance. No host-production reload is necessary for the audit test.
