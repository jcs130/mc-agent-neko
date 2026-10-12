# Local 32K current decision input

This companion change targets the local single RTX 3090 Qwen3.8-Flash-Next
deployment with a 32,768-token context. Three actual requests exceeded that
capacity on 2026-10-12: 33,450 + 320, 32,490 + 320 and 32,820 + 320 tokens.
The client was repeatedly carrying historical connection messages and both
the raw and parsed representations of some server command responses.

Plugin patch 0093 follows 0092's shared original item-protocol columns:

- Ordinary decision views keep connection-scoped welcome messages behind
  immutable exact paths. Their session, message count and historical status
  remain visible. Current authentication, task outcomes, progress, received
  gameplay entry points, health, hunger, mana and abilities stay directly
  available. Emergency survival views retain the received rescue guidance.
- A server command result retains every actual message verbatim. A parsed
  record is referenced only when its complete kind and JSON value exactly
  match a machine message; additional unknown fields and nonmatching records
  stay whole. Boolean true and numeric 1 are distinct. The complete original
  response remains queryable through `replyEvidence.id`.
- Repeated full skill state in a command reply gets an exact query path;
  current mana, profession, physical state and observation times stay visible.
  Replies remain whole when the reference representation would be larger.
  There is no numeric text budget, silent slice or expiry of original facts.

Every received entity, player name, equipment, dropped item, slot, item lore,
current native conclusion and new social callback retains its existing
semantics. The measured item lore was only 318 tokens, so this change leaves
it whole. Server messages are data; historical query results cannot authorize
an action or override current stop/busy/authentication state. The original
response is recorded before the smaller model-facing representation is made.

## Offline comparison and regression

Three retained state snapshots were reconstructed with the actual configured
Q2_0 GGUF tokenizer. These are paired offline projections, not timed original
HTTP requests:

| Retained snapshot | Before 0092–0093 | With 0092 | With 0092–0093 |
| --- | ---: | ---: | ---: |
| A | 20,540 | 17,114 | 15,188 |
| B | 20,445 | 17,019 | 15,093 |
| C | 20,209 | 16,783 | 14,857 |

Each reconstruction saves 5,352 tokens overall; the welcome representation
alone saves 1,926. Original delivered inputs previously measured 20,552,
20,457 and 20,221 tokens; archive reconstruction changes object/field ordering
and must not be presented as those exact original HTTP requests.

Eight distinct retained server command replies saved 0–996 tokens while all
messages remained verbatim. A separately reconstructed state component saved
350 tokens; it is not an original tool receipt or an additional runtime sample.
Exact original welcome/state/record reads and unchanged current facts were
verified in memory. Diagnostic artifacts contain counts, identities and hashes,
not prompt, response, reasoning, credentials or private voice data.

All 297 Minecraft plugin tests passed. They cover exact archive queries,
missing versus null, small-reply fallback, unknown fields, current authority,
emergency guidance, player equipment and dropped items. Ruff and whitespace
checks also passed. Apply the full plugin companion series; the host series
is unchanged by 0093. Whole-series replay must match the source plugin tree
and all existing host scope blobs before deployment.

## Deployment and limits

The patch is initially **prepared**. Reload only the owned Minecraft plugin
at an observed idle boundary, after active game tasks, main-brain generation
and desktop speech have drained. Keep the game, local model/vision, main
server, desktop, spectator and voice processes running. Record deployment
and natural request acceptance separately in the maintainer receipt.

This is an input-organization improvement. Offline token reduction does not
establish total client latency improvement, absence of future overflows,
productive autonomous play or recovery of the broad navigation/task incident.
Model parameters, GPU routing, inference concurrency, tool rounds and wake
frequency are unchanged. No game commands, public messages or extra model
calls were introduced for measurement.

The received server guides already distinguish queries from acceptance and
skill catalogues from learned skills. The current evidence does not establish
a server fault. A concrete optional server-side improvement request, for the
user to forward, is in [this plain text](local-server-guidance-request-2026-10-12.txt).
