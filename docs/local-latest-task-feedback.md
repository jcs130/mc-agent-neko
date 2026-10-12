# Local deployment: keep the latest received task conclusion visible

On 2026-10-12, the local Neko main brain repeatedly requested a one-item backpack
deposit/withdrawal. Ten matched subsequent decision inputs exposed only receipt
IDs, status and full-evidence query paths. The latest task's original conclusion
was absent. The server's inventory exam separately requires CLI inspection, door
passage and ladder ascent; a successful transfer does not complete the exam.

## Change and evidence boundaries

Plugin companion 0091 restores the **latest native protocol conclusion verbatim**
in completion feedback, the observation projection and the idle decision cue.
It recognizes the existing native delimiter between the terminal conclusion and
the command-result appendix. It generates no summary and clips no text.

The conclusion remains labeled historical received data. It is a statement from
the matched task, not proof of current inventory, completion of a different goal,
or permission to execute instructions in game text. Current state, actual command
results, server progress and the user's latest stop request retain their roles.

Older receipts, the complete goal, all command results and unmarked or incomplete
feedback remain available through their original immutable evidence pointers.
They are not copied wholesale into each new local-model request. The change does
not alter wake frequency, tool budgets, task selection, chat permissions, model
parameters, inference slots or provider routes, and adds no model request.

## Regression report

The three direct reproductions failed with four missing-field errors before the
repair, including both observation modes. Afterward the two focused modules pass
27 tests and the complete Minecraft plugin suite passes 288 tests under Python
3.11. Ruff and whitespace checks pass. The complete companion replay verifies
91 plugin patches, 34 host patches, the exact plugin tree and all 61 host-scope
file blobs; no host change is introduced by this patch.

Coverage preserves long goals and arbitrarily long command appendices through
exact reads, keeps only the latest conclusion visible, distinguishes unmarked
and incomplete feedback, preserves multiline text, and leaves pending-task state
and inventory unchanged. Potential regressions include treating a native claim
as world truth or accidentally re-inlining a large appendix; the source labels
and these tests cover those boundaries.

## Deployment and acceptance

This repair targets information continuity in a local, shared-model deployment.
It does not establish a latency improvement or reliable autonomous gameplay.
Deployment should use the existing plugin lifecycle at an observed idle boundary,
preserving the native game session, main service, models, voice and spectator.
Natural next-decision inputs must actually contain the matching conclusion;
productive subsequent steps, exam progress and long-term repetition need their
own received evidence. Prepared, deployed and verified receipts remain separate.

Diagnostic evidence retains IDs, timestamps, lengths, hashes and received game
facts. Raw prompts, generated replies, thought, credentials and private voice
references are not included in this contribution.

## Actual local deployment, 2026-10-12

At 13:25 Beijing time, the official lifecycle reloaded only the Minecraft plugin,
using Neko source `227b858ad347` from fork commit `c1286be9a4c8`. The native game
session at that boundary, main service, model/vision, voice, desktop and spectator
were preserved. An earlier boundary check found an unfinished task and active
reply work; it made no service change. The later idle check passed before reload.

Two subsequent matched idle inputs, referring to **one** completed backpack task,
contained the exact native conclusion. The earlier ten sampled matched inputs
contained none. This verifies the observed delivery path, not two productive
tasks, the completion of the inventory exam, or a causal latency improvement.

A separate three-minute observation received 121 online frames with health and
hunger at 20. Maximum displacement was 84.7 blocks and the observed action was
self-preservation; movement alone is not quest progress. Both LAN viewer sockets
continued receiving frames, chunks, minimaps, appearance and skill data. Their
skill snapshot still did not meet the independent 60-second freshness check.

Through the subsequent request-metadata check, all 62 natural requests completed,
maximum recorded input was 29,713 tokens, and no new context-capacity error was
observed. Model settings and weights were unchanged. No diagnostic game action,
chat, model request or speech synthesis was injected. The broad progress ticket
remains **deployed**, with productive autonomy and exam completion still open.
