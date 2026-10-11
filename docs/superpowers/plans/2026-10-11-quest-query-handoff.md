# Preserve the execution opportunity after quest queries

User report: repeated commission inspection followed by no action.

1. Observe current state and correlate host/tool dispatch logs. Keep the game,
   model and speech running; do not substitute manual game commands.
2. Reproduce the received `/mycli quests` and `/mycli commission` queries being
   classified as actions. Test exact forms, mutation/unknown arguments and the
   unchanged `serverQuery` permission gate.
3. Correct only receipt metadata for observed catalogue forms; retain bounded
   tool iterations, optional execution, stop/busy checks and all replies.
4. Run native regressions and the host query-cap regression. Commit to the
   user fork and prepare the native tree, preserving runtime state changes.
5. Load the owned native child at a measured safe idle boundary. Record actual
   loaded source and preserved services; observe natural dispatch and progress.
6. If query-only behavior persists, trace the next boundary before changing it.
   Tests passing or silence alone do not establish autonomous task progress.
