# Local avatar model calls and turn coalescing

## Current call chain

The deployed local Qwen main brain streams a reply. On assistant completion,
`static/app/app-websocket.js:finalizeAssistantTurn` separately invokes
`analyzeEmotion`, which posts to `/api/emotion/analysis`. That route constructs a
small outward-emotion prompt and calls the configured emotion model. The reply
and emotion are therefore **two separate model requests**, not one combined
output. Each request can produce multiple streaming chunks; chunks are not
independent main-brain decisions.

The **same emotion result** feeds expression and motion in
`static/live2d/live2d-emotion.js`. Expression/motion mapping, blinking, idle
animation and audio-driven lip sync do not themselves call Qwen. This concerns
the avatar; Minecraft navigation/mining/combat have their own physical execution
and may require further decisions after actual tool results.

| Caller | When another model request occurs |
| --- | --- |
| Main dialog / proactive brain | A new reply or a subsequent tool-feedback reasoning step |
| Avatar emotion | A completed meaningful reply; separate from main output |
| User emotion tracker | Real user input, throttled; separate purpose from avatar emotion |
| Galgame reply options | When the optional reply-choice UI is enabled |
| Subtitle translation | According to subtitle/language settings |
| Long-reply / memory summaries | On their own length or memory triggers |
| Native code / vision | On demand, according to the game request |
| TTS | Audio synthesis/character usage; not another local Qwen decision |
| Live2D render / expression / motion | No LLM request |

Game/main/emotion routes remain local Qwen on the RTX 3090. The existing monitor
uses online DeepSeek, and Lanlan free streaming TTS is online. No model, GPU,
sampling, thinking or inference-concurrency settings changed in this patch.

## Passive timing evidence

Host PID 6104 metadata from 21:08:52 to 21:35:50 Beijing on 2026-10-10:

| Category | Finished attempts | Outcomes | Median / p90 client time |
| --- | ---: | --- | --- |
| proactive | 44 | 37 completed, 7 error | 4094 / 6531 ms |
| emotion | 31 | 22 completed, 9 superseded | 1625 / 8438 ms |
| galgame_options | 15 | 10 completed, 5 cancelled | 4828 / 10015 ms |

Only `event=finished` records were counted. Dispatch plus finish is not two
calls. Errors/cancelled/superseded attempts are not successful generations. TTS
character telemetry is counted separately, and native/monitor callers are
outside this table. These mixed natural samples are not a paired optimization
benchmark. The present host trace lacks frontend turn identities, so this table
does not establish the production rate of duplicate completion.

The existing five-second frontend `Promise.race` only stops waiting for emotion;
it does not cancel backend inference. Some host emotion attempts exceeded five
seconds, including a maximum of 11281 ms. The shared local background admission
already uses latest-wins while waiting and a ten-second maximum. The timestamp
gap alone does not establish how much discarded GPU work occurred.

## Implemented scope

Source commit: `a2ad656dd4a63fdb192f63019b64d80c226022e0`.

- Coalesce repeated completion with the same turn identity **and same full text**
  before optional classification, subtitle finalization and music processing.
  Retain at most 64 identities. Different text with a reused legacy fallback ID
  remains observable; different turns with identical wording remain distinct.
- Skip a queued older classifier if a newer turn has started/finalized or the
  session was cancelled. Discard late classification before applying it to the
  avatar or emitting the emotion-ready event.
- Clear the deadline timer after success/failure. Preserve the five-second wait
  limit; do not claim to abort a request already dispatched to the backend.

Deterministic replay of the actual finalizer first failed five cases. Duplicate
completion sent **2 classifier requests before, 1 after**. Two queued finalized
turns sent **2 before, 1 after**, retaining the newest turn. A follow-up failing
replay protected new callback text when a legacy identity is reused. Late
in-flight results no longer overwrite the newer avatar state.

Final checks: **13 finalizer cases plus 3 existing CSRF retry cases pass**;
JavaScript syntax and diff checks pass. Replay includes cancellation, timeout,
missing IDs, separate identical text, reused-ID new text, empty, music-only and
structured completions. Backend/Python and native code are unchanged; their
earlier suites are not described as newly rerun by this frontend-only change.
The ordered bundle replays 65 plugin and 6 host patches to the declared source,
matching all 18 affected host blobs.

The owned desktop was refreshed alone at a quiet task/speech boundary on
21:38 Beijing time; its backend connection became ready with one listener.
Main, native and model process identities/generation were preserved. The served
frontend file matches the committed source. The game remained connected with
fresh state, HP 19 and food 17 after refresh. No test game chat/actions or
diagnostic model requests were generated by this audit.

Normal new replies still use a separate classifier. This change does not
establish an aggregate latency gain, classifier accuracy or rendered-avatar
quality. Desktop refresh is deployment evidence, not a visual acceptance test.

## Next independent experiment: one reply with emotion metadata

For speech-producing main replies, emit a small emotion field alongside the
reply in the same generation. Keep streamed speech available immediately and
strip metadata before TTS, subtitles, game chat and history. Consume that field
for both expression and motion; use a neutral fallback for absent/invalid data
instead of automatically submitting another classifier request. Do not add
emotion fields to native command arguments or tool-only responses.

Validate chunk boundaries, tool calls, cancellation, literal user text that
resembles metadata, language settings and long-response summarization before
deployment. Compare single-pass output overhead, complete effective reply time,
newly computed input tokens and expression quality with separate classification.
Do not force game decisions, generated code and new visual observations into one
initial request: later world/tool feedback is new evidence.

Separately evaluate propagating a short optional-work deadline through backend
admission and invocation. Scope cancellation to the owned request and verify
provider behavior; closing a browser fetch is not proof the GPU stopped. Shared
multi-window single-flight caching and reply-choice scheduling are also separate
experiments. None is claimed implemented here.
