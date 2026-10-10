# Preserve task conclusions in bounded planning context

The hourly inspection found five autonomous inspections of the same merchant's
offers. The original feedback explicitly said there was no coal or raw-iron
buying offer. Replaying that feedback through the completion formatter lost
this conclusion while retaining a tail of the duplicated inventory. The idle
cue's separate 90-token envelope was consumed by the long goal before any
status or feedback appeared. This is a demonstrated loss of information;
it does not establish that every repeated action has this cause.

The Minecraft plugin now gives goal names and feedback separate budgets in
idle cues and compact observations. Completion cues prioritize the brief task
report before the native message's appended raw command receipts and inventory.
When there is no brief report, bounded unstructured feedback retains its head
and tail. Full `lastTaskOutcome` queries and failure classification keep the
original text. The change adds no inference timer, task prohibition or game
chat output. The model remains responsible for choosing its next action.

Two reproductions failed before the repair. Six added cases cover completion,
idle planning, compact observations, full-feedback retention, terminal failures,
receipt-only messages and the excerpt budget. The complete plugin suite passed
**195/195**. Replaying the captured merchant result now retains the explicit
negative conclusion in **900 tokens**, compared with **936 tokens** before.
The 60-patch companion series and the existing approved host patch replay from
the pinned base, and the plugin tree exactly matches the committed source.

The prior native skill-result, inventory-capacity and targeted-dig repairs were
loaded at 07:59 on 2026-10-10 during a safe daylight idle boundary. The game
reconnected with full health/food; main, model and desktop processes continued.
The agent had already escaped to ground level before this reload, so that
escape must not be attributed to these repairs. The new feedback repair was
loaded at 08:08 through the Minecraft plugin's normal lifecycle after its
current task ended. The native game process stayed running. Deployment time
and subsequent natural actions are recorded in the local
hourly audit. Offline checks alone do not prove the repeated-query behavior
or arbitrary commissions are permanently resolved.
