# Client latency diagnostics

Enable `MC_LLM_TIMING=1` before starting the native Minecraft process. No prompt,
answer, reasoning, task text, command arguments, endpoint URL or credential is
written. Records go to `bots/_supervisor/llm_timing.jsonl` through the existing
asynchronous rolling log worker (8 MiB per file, shared runtime retention budget).
This switch does not enable motion/combat telemetry and is off by default.

Each native GPT call has a generated request ID, attempt ID, process-local task
version, controller epoch and a fixed call type. Conversation, execution,
code execution, memory, conversation gating, task deduplication and body
arbitration are distinguishable. Calls using other model adapters are unaffected.
Native vision is outside this diagnostic scope; the deployed screenshot path
belongs to the N.E.K.O. host client.

Events are emitted at SDK dispatch, full return and terminal classification.
They share request/attempt IDs and are not three separate model calls.
`dispatch` has no usage yet. Read token counts from `returned`/`finished`.
Context-limit retries increment the attempt number; OpenAI SDK internal retries
remain opaque and are explicitly labelled `sdk_retry_visibility=unknown`.

| Field | Meaning |
| --- | --- |
| `prepare_wait_ms` | Entry to prompt assembly, including existing memory/cooldown waits |
| `prompt_assembly_ms` | Native template substitution and fresh-state gathering |
| `sdk_format_ms` | First attempt's adapter formatting, after template assembly |
| `sdk_dispatch_at` | Client hands the final body to the SDK; not a socket or server admission timestamp |
| `sdk_roundtrip_ms` | SDK dispatch to complete returned response |
| `first_effective_content_at` | Null: native calls are non-streaming |
| `command_validated_at` | Existing executor accepted syntax, arity, domains and applicable lifecycle preconditions |
| `total_to_command_ms` | Entry through that validation callback; excludes subsequent action duration |
| `return_to_command_ms` | Full return through validation, including normal response handling |
| `unattributed_dispatch_ms` | SDK interval without a per-request provider-stage breakdown |

Server queue, input and output times stay null. In particular, unattributed
dispatch time includes model processing, transport, possible SDK retries and
FIFO wait; it is **not a measurement of queue time**. Engine history durations
must not be substituted for client elapsed time or matched using prompt length
alone. Exact engine breakdown needs a future explicit request-correlated API.

Input/output counts come only from returned provider usage. Cached counts must
be supplied, numeric and no greater than input. Otherwise reused/new input remain
null. Missing values never become zero. Component projections through a tokenizer
are a separate offline metric and must not be mixed with returned usage.

`command_ready` means a command reached the existing pre-execution validation
callback. It does not prove feasibility, action success or task completion.
Invalid, rejected, empty, superseded and ordinary conversation results have
different outcomes. Existing mission epoch/ownership checks still discard stale
responses before touching the body. Coding responses record full-return latency;
their script validation/execution time is not presented as command-ready latency.

Measurement does not change request bodies, sampling, model parameters, retries,
checkpoint defaults, command descriptions, history projection or explicit pin
ownership. Deduplication/arbitration timing begins at the adapter and therefore
has unknown prompt-assembly time. There is no new model heartbeat or diagnostic
LLM call.

Compare only the same call type, execution mode and model settings. Keep separate
samples for cold input, continuous same-goal execution, goal changes, history
growth and natural shared-service traffic. Report sample count, median and a
clearly defined tail percentile. A faster reply or a syntax-valid stop command
is not a gameplay quality pass.

## N.E.K.O. host companion

Host companion patch 0003 adds adapter diagnostics with `NEKO_LLM_TIMING=1`
and the existing `NEKO_LOCAL_STRATA_PREFILL=1` on loopback port 18030. It writes
only metadata to `$NEKO_RUNTIME_STATE_DIR/llm_timing/host-<pid>.jsonl` using a
bounded background queue and rotating files. Keep `NEKO_LLM_PROMPT_AUDIT=0`;
timing does not require raw prompt auditing.

Host measurements start at the ChatOpenAI adapter entry, before the existing
optional-background admission wait. They do **not** include upstream host prompt
construction, tool execution, TTS or game action time. Request scope, call type,
message/tool/image counts, output limit, thinking setting, checkpoint/pin flags
and provider token usage are included. Values are allowlisted; no model text,
tool name/arguments, schemas, URLs, character names or credentials are copied.

For streaming, first non-reasoning text or a nonempty tool-function fragment is
observable. A fragment is not an executable or validated command; the host field
`command_validated_at` stays null. Native execution supplies the actual command
validation measurement. Provider terminal usage/finish markers determine the
observed complete-response time. Stream consumer pauses are counted separately
because time spent between yields is not necessarily inference. No server queue
or engine-stage timing is inferred. Host task versions have not been propagated
to this adapter and are explicitly null, with `task_version_source=not_propagated`;
request IDs are not claimed to correlate host and native tasks automatically.

The wrappers retain caller overrides, outputs, reasoning and tool fragments.
Concurrent calls have separate context-local traces; early generator closure
releases both context and its source. Metadata writer/usage failures cannot fail
successful inference. Existing background admission and tool/mission guards
continue unchanged. This patch introduces no model heartbeat, retry, early tool
execution, cancellation of another client, or GPU/model configuration change.
