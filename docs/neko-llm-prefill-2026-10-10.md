# Reduce repeated Minecraft prompt processing

The bottleneck was repeated prefill, including complete observation results and
execution prompts with no reusable system checkpoint. This change keeps current
decision facts and complete reference access while reducing recomputed input.
It does not change model weights, chat/code thinking settings, or the GPU setup.

## Measurement before changes

A bounded, explicitly enabled private wire capture was replayed through the
installed Qwen tokenizer and Strata chat template. One 27,856-token request
contained 4,903 tokens of system text and 19,914 tokens in a full observation
reply; the tools-only template was 2,090 tokens. Message wrappers, historical
speech and serialized tool calls account for the remainder. These component
counts are not interchangeable with the server's actual reused-token metric.

The server already had a 5 GiB, 16-slot conversation cache. Captures included
both zero reuse and large successful restores. Two concrete causes were found:

* The Qwen template puts tools before system text. Forced final answers remove
  tools, so their token prefix differs from the normal Minecraft tool loop.
* The native legacy `strictFormat` demoted system messages and merged them with
  changing user state. Reordering text alone left no independent system-root
  checkpoint before those changes. A regression using the real formatter
  failed before the repair and passed afterward.

Different request families and code thinking modes can also have incompatible
prefixes. A cold request or a tool-less final answer can still report zero reuse;
zero reuse alone does not establish a broken cache.

## Changes and configuration

Native execution now puts fixed rules, command documentation and the coding
contract before changing memory, selected code references, task progress and
fresh state. With `NEKO_LOCAL_STRATA_PREFILL=1` and the loopback Strata endpoint
on port 18030, this controller-created boundary becomes an independent system
message. The following user message carries the changing execution snapshot.
Other endpoints and the default configuration retain the legacy formatter.
Native action inference does not claim the engine's explicit pinned prefix.

Host companion patch 0002 gives only Minecraft-scoped, text-only tool requests
an exact `strata_prefix` boundary captured before dynamic session context is
appended. Actual wire requests marked message 0, character 2,872; the installed
template resolved this to 2,934 tokens including the preceding tool schema.
The engine supports one explicit pin, so background work and vision do not
replace it. See the [Strata documentation](https://github.com/Niko1221/Strata/blob/main/docs/DETAILS.md)
for prefix/checkpoint semantics.

Plugin patch 0062 adds opt-in full-observation reference pages. Enable
`reference_paging_enabled=true` in the Minecraft plugin's `[game_agent]` config.
Summary observations retain their existing behavior. Full replies carry a
bounded first page, current decision or survival facts, the latest task outcome,
and cursors/JSON-pointer paths for complete received reference data. Pages are
immutable snapshots with explicit age, partiality and source truncation, a
180-second TTL and three retained snapshots. Long text is split with exact
offsets; unread or expired material is unknown. No extra inference is used to
summarize those references. The original received data remains available.

The outgoing host history drops only older tagged proactive narration beyond
the latest six entries. User wording, tool receipts, other dialogue, existing
summaries and the original history archive are retained. The five existing
planning tools, including public/private chat and reference lookup, remain.

Optional emotion, summary and dialogue-choice requests wait for an idle local
engine, coalesce pending work of the same category and expire after ten seconds.
This is best-effort admission, not engine preemption: an already running request
continues. Game requests do not wait on that background lock. One-shot requests,
native memory summaries and tool-less Minecraft final answers avoid parking
their tails with `strata_checkpoint=false`. Existing state coalescing remains;
idle cues expire after 20 seconds and passive state cues after 30 seconds.
No new periodic model call is introduced.

Both endpoint policies require explicit opt-in and the existing local service.
The game remains on local Qwen; chat/vision use `none`, code uses `low` with its
existing 512-token thinking budget. No engine restart or cache-budget increase
was needed. Prompt auditing stays disabled by default; bounded private captures,
character memories and runtime logs are excluded from this contribution.

## Results and limits

Replay of the same 12 captured request bodies, replacing only their full
observation results with the final page projection, reduced input by an average
56.0%. The first request changed from 27,856 to 11,521 tokens. Complete reference
data was still available across 14 pages. This is a controlled input-size
comparison, not a claim that every request or end-to-end latency improves by 56%.

During passive observation after host deployment, real Minecraft requests
included 11,958 total / 7,923 reused / 4,035 recomputed tokens, followed by
12,029 total / 11,990 reused / 39 recomputed tokens. Their server durations were
4.5 and 3.7 seconds with different outputs, so these are examples, not a controlled
latency benchmark. Later zero-reuse native requests led to the independent
system-root repair described above. Subsequent real execution requests included
10,349 total / 7,725 reused / 2,624 recomputed tokens, followed by
10,370 total / 10,342 reused / 28 recomputed tokens. The second request took
2.1 seconds with 81 output tokens. Later execution requests also reused their
longer conversation checkpoints. These observations do not establish that the
model chose correct game actions.

A separate four-request, inference-only comparison used the deployed execution
profile and documented command list, with synthetic diagnostic state and no
custom-skill manifest. Each request produced one discarded token; no game task
or chat was sent, and requests waited for an idle engine. Only the suffix changed
between A and B within each format:

| Format, changed-suffix request B | Prompt | Reused | Recomputed | Input processing | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Legacy merged user message | 6,108 | 0 | 6,108 | 5,992 ms | 6.0 s |
| Independent fixed system message | 6,109 | 5,961 | 148 | 853 ms | 0.9 s |

This reduced recomputed tokens by 97.6% in that controlled case. Both formats'
first requests were cold and read their full inputs; the optimized cold request
took 7.5 seconds. This is one changed-suffix case, not a broad speed benchmark.
The explicit Minecraft brain pin was not replaced, cache state was not flushed,
and the model process stayed running throughout the test.

Verification: 575 native tests, 618 contribution tests, 206 plugin tests,
88 host/session regressions and 40 client/audit tests passed. All 62 plugin
patches and both host patches replayed from the declared base; the plugin tree
and all 12 affected host file blobs matched committed N.E.K.O. source.
LAN verification received continuous avatar frames and world chunks for
20 seconds, checked multiple sessions and released every probe socket. It
made no game action, chat or model request. Long-run gameplay quality and a
universal latency reduction are not established by this performance change.
