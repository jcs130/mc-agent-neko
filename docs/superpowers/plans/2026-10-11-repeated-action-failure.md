# Bound repeated failed actions without interrupting healthy work

The hourly inspection reproduced repeated `!tradeWithVillager` failures with
the same payment error and unchanged inventory/position. The existing query
loop guard bounds repeated `!stats`, but completed failed actions reset that
guard and can immediately repeat until the mission deadline.

Keep the local model, thinking settings, player communication and server
permissions unchanged. Do not equate a business rejection with a server fault
or declare the whole game goal impossible. No new model calls are needed.

- [x] Reproduce repeated model action failures through the actual command and
  mission boundary. Test changed arguments/results/state, explicit player
  commands, task replacement and healthy long actions independently.
- [x] Warn at three identical completed failures without measured progress;
  return the stalled task and its real evidence to its owner at five. Keep the
  existing query guard and mission completion semantics intact.
- [x] Run relevant and complete native regression. Commit the scoped change
  and documentation to the authorized fork, preserving unrelated files.
- [ ] Deploy only the owned native child at a safe idle boundary if available;
  otherwise record prepared status. Observe naturally occurring game actions,
  record actual acceptance limits and write the DSH maintenance receipt.

Successful handoff alone does not verify productive autonomous survival,
physical escape, successful trading or resolved spoken repetition.
