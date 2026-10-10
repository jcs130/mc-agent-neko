# Client latency observations — 2026-10-10

The native MC decision path now records preparation through executor validation.
The N.E.K.O. companion supplies separate adapter/stream timing. Neither logger
stores prompts, answers, reasoning or credentials. Field definitions and missing
stages are documented in [the timing guide](llm-client-latency.md).

## Natural workload baseline

Snapshot: 16:59 Beijing time, 92 completed native calls since 16:23:
76 execution decisions and 16 memory summaries. Execution outcomes comprised
74 validated commands, one stale result and one invalid command. Validation
does not establish action feasibility or task success.

The table below describes natural external-task traffic within one model process
generation. It is **not** a before/after optimization comparison: tasks, input
lengths and output lengths differ. Cache buckets are selected using returned
usage. Tail percentiles use nearest rank and are shown only for at least 20
samples. Their uncertainty remains substantial.

| Cache reuse | Samples | Median new input tokens | Median preparation-to-command | p95 | Median assembly |
| --- | ---: | ---: | ---: | ---: | ---: |
| At least 95% | 25 | 120 | 1.063 s | 2.237 s | 0.063 s |
| Partial, below 95% | 42 | 3636 | 4.434 s | 13.413 s | 0.060 s |
| Zero reuse | 1 | 9872 | 26.925 s | insufficient samples | 0.091 s |

The SDK interval is not a queue measurement. These records have no correlated
server admission/input/output timestamps. Preparation also reached 8.014 s in
one partial-reuse request; the current native field combines existing memory
and cooldown waits, so these components cannot yet be separated from this log.
Provider-side delay must not be inferred by subtracting unmatched engine history.

After loading host timing, one natural pair at 17:02:35/38 used five tools and
then no tools. The first request read 11348 tokens, reused 10145 and completed
in 3.328 s. The no-tool continuation read 10517, reused zero and completed in
8.110 s (first non-reasoning fragment at 7.797 s). These are separate calls, not
an A/B pair. The second call's required context and existing one-shot policy
deserve a separate review; metadata alone does not prove it is redundant.

At 16:26:54 the observed Strata frontend changed from PID 30584 to 26788; the
configuration file hash also changed. This optimization task did not issue a
model restart or config write. The cause is undetermined. The named deployment
parameters remained equal when checked: model/weights, 262144 context, INT8 KV,
23 workers, PCIe 0, MTP 0.7 and 5120 MiB/16-slot/2560 MiB-floor cache. Both the
new text engine and vision encoder were observed on the RTX 3090. The six
earlier execution samples are excluded from the table. The lone 26.925 s request
occurred after this restart and is not evidence that moving a goal invalidated
the cache. Preserve this generation boundary in subsequent analysis.

## Isolated goal-position experiment

The [eight-call probe](llm-goal-position-experiment.md) preserved all ordinary
prompt content and moved only the goal. Its token common prefix increased from
440 to 7629, but on a changed goal both formats still reported zero reused input
and about 4.2 s full response time. It did not prove a latency improvement.
`MC_SELF_PROMPT_TAIL` remains off. Native external-task formatting and continuous
checkpoints retain their existing behavior; no engine pin/cache changes were
introduced by this experiment.

## Concurrency and the next comparison

The running `/v1/status` reports `concurrency.serving=1` and `requested=1`.
The upstream [batching guide](https://github.com/Niko1221/Strata/blob/main/docs/BATCHING.md)
supports two or more independent conversations, but new prompt admissions are
serial. Slots consume session VRAM, reducing expert-cache space; by default
batch decode does not use the solo path's MTP drafts. Better first-content delay
therefore need not mean a complete game command arrives sooner.

Keep the body's decision/execution owner singular. Existing optional host
background admission defers emotion and summary/options requests and replaces
pending work of the same category; it is not a global scheduler and does not
preempt already-running requests. It cannot guarantee strict priority over
other clients. Independent file/network/status preparation may overlap without
introducing competing action plans.

A later `parallel=1` versus `2` experiment must be separate from prompt changes
and must declare the necessary engine restart as a new model generation. Warm
each configuration, hold the model/sampling/output settings and offered workload
constant, and test solo game decisions as well as natural independent background
overlap. Compare preparation-to-validated-command latency and quality, not only
first token or aggregate tokens/sec. Do not infer a benefit for this 3090 from
another GPU's throughput results. No concurrency setting was changed here.

## Validation and delivery

Relevant suites: native 589 passing tests; contribution 632; N.E.K.O. client and
session 181 (five existing warnings); host Ruff passed. The companion series was
replayed from its declared base and matched all 14 host file blobs and the
unchanged plugin tree (62 plugin patches, three host patches).

Native timing commit: `67e54ebca59f737dc79bf3c926f8694209b2ae75`.
Ordinary goal experiment: `39e4aa44a1a997e6828876f0bc102c4f376c946d`.
Host source: `50f1951d3c920f675b6f01172121b0605f7d3c05`.
These checks establish instrumentation and regression behavior, not overall
unattended gameplay or livestream quality. No test messages were sent to game
chat or Bilibili.

Native timing was enabled at 16:18. The host-only reload at 17:00 reached a
terminal external mission and idle-model boundary. Immediate listener teardown
checking was too strict and the deployment helper refused to launch a duplicate;
the existing guardian completed official startup by 17:01:06. Its one recovery
belongs to this controlled host reload. The native controller (25828), game body
(37872) and current Strata frontend (26788) were retained. New main/plugin
listeners (6104/33448) produced content-free timing records. Fresh game data
confirmed connection, 20 health, 20 food and eight received/pushed welcome parts.
The LAN stream check observed 74 avatar updates and 81 chunks on each of the
first/third-person transports over eight seconds, with no connection errors and
both inspection sessions released. This is a transport continuity check, not a
rendered-frame or gameplay-quality assessment. The local helper now allows a
bounded listener-release wait; no additional reload was performed for that fix.
