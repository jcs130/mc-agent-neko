# Ordinary autonomous goal position: isolated experiment

`MC_SELF_PROMPT_TAIL=1` moves only `$SELF_PROMPT`, preserving all occurrences,
literal rules, command descriptions, memory, examples and state placeholders.
The new position follows `$COMMAND_DOCS` and precedes the next dynamic section.
External missions and coding contracts retain their existing projection. If
memory precedes the command catalog or the catalog is absent, the template stays
unchanged: moving only the goal cannot create an unambiguous static boundary.
The flag is **off by default and remains off in the running trial**.

An inference-only comparison on 2026-10-10 used the actual native profile,
command docs and custom skill catalog, with synthetic goals/state/history. The
final requests passed through the real `strictFormat()` and installed Qwen/Strata
tokenizer/template. Each format tested cold input, an exact repeat, a changed
goal and history growth; concurrency was one, with identical model parameters
and a one-token output limit on both sides. All output was discarded. No game
action/chat was sent, explicit prefix or engine/cache configuration changed,
checkpoint disabled, or cache flushed. Eight probe calls were sent.

Moving the goal increased the exact token common prefix on goal change from
440 to 7,629 tokens. Both formats still contained one merged user message;
neither gained an independent system checkpoint.

| Case | Baseline new input | Moved-goal new input | Baseline client request | Moved-goal client request |
| --- | ---: | ---: | ---: | ---: |
| Cold, goal A | 7,835 | 7,835 | 4,269 ms | 4,275 ms |
| Exact repeat A | 7 | 7 | 196 ms | 98 ms |
| Changed goal B | 7,836 | 7,836 | 4,193 ms | 4,166 ms |
| B with growing history | 29 | 29 | 523 ms | 476 ms |

Each cell is **one observation**. There are insufficient repeated samples for
meaningful case medians or tail estimates. Do not pool cold/hit/changed-goal
cases to manufacture a median improvement. Natural shared-service work was
allowed to continue; checking idle before a probe is not a concurrency lock.
Client intervals include unknown provider/transport/FIFO time. Server stage
times were not matched by prompt length and remain unknown.

The key result is that **changed-goal reuse remained zero** after relocation.
Longer textual/token common prefixes alone do not guarantee a usable native
checkpoint in this formatter. This experiment does not demonstrate a latency
improvement, and its one-token outputs cannot validate command quality or
gameplay. The ordinary-mode flag remains disabled. A future system-boundary
experiment needs its own baseline and quality checks; it must not replace the
Minecraft brain's shared engine pin without coordinating ownership.

The live external-task formatter already preserves a separate fixed system
message with `NEKO_LOCAL_STRATA_PREFILL=1`; that earlier repair is a different
change and is not attributed to this experiment. Live client latency now comes
from the metadata diagnostics described in `llm-client-latency.md`.
