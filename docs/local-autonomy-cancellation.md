# Collection cancellation and autonomous task recovery

## Observed problem

On 2026-10-11 the externally controlled game executor repeatedly timed out
while collecting wheat. `ActionManager.stop()` requested cancellation for
15 seconds, then logged `Code did not stop after 15s — forcing release +
reconnect (NO process exit).` The connection was replaced even though the
process stayed alive. A continuous 45-second observation also found no
movement, inventory change or active action, with health and hunger at 20.

The Neko host intentionally clears per-session outcome history on a new game
session. Thus these forced reconnects also removed failure feedback that the
planner needed. This is an executor cancellation defect, not evidence of a
server outage. Missing currency, insufficient wheat and absent pickaxes are
separate real planning prerequisites; cancellation alone does not solve them.

## Mechanism and change

`collectBlock()` checked interruption only at the bottom of its outer loop.
Failed/gone dig targets and several exceptions used `continue`, bypassing
that check. Asynchronous scans could also finish after cancellation and start
another equipment/dig operation. The reproduction performed 16 dig attempts
after the first attempt requested cancellation.

The primitive now checks interruption, death and action-generation ownership
at retry boundaries and after asynchronous preparation, before starting the
next body operation. It does not detach running promises. Real inventory gains
still determine its boolean result. Permission filters, safety gates, retry
limits, threat reflexes and the 15-second terminal stop watchdog are retained.

This improves the local main-brain/executor loop without adding model calls,
raising wake-up frequency, switching models or expanding the context budget.

## Validation and acceptance

- Initial regression: 11 tests, 3 pass / 8 fail. Error/gone cancellation
  expected one dig but observed 16; cancelled scans could still equip and dig.
- Focused cancellation, ore harvest and action-stop suites: 24 pass / 0 fail.
- Final contribution suite after two extra inventory/protection cases:
  `node --test`, 773 pass / 0 fail, exit 0. Counts overlap.

Deployment and natural observation are separate acceptance gates. The
falsifiable prediction is that cancelled collection stops without another
retry/body operation or an `action-refused-stop` reconnect caused by this
loop. A completed commission, useful collection, trade or combat requires its
own received result; motion or a correctly formatted command is insufficient.
