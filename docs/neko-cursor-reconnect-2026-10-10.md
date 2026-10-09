# Cursor recovery and reconnect error reporting

## Observed failures

An ordinary chest withdrawal used `!clickWindow(window_id, slot)`, which performs
a plain left click. The custom sword disappeared from the container slot and
remained on the cursor; it had not yet entered the player's inventory.
`!window` did not expose this state, and the command registry had no explicit
close operation. The model repeatedly reopened the chest with `!useOn` while
describing that action as closing it. The same recovery explanation appeared
31 times in one task. A later task eventually closed the interface and the real
inventory gained the sword. This was a tool-information gap, not evidence that
the server rejected the withdrawal.

During a separate native reconnect, an action continued after `agent.bot` was
replaced. The new connection did not yet have its `output` string. Error
formatting read `output.length`, then threw the same secondary exception while
trying to report the original failure, ending the self-prompt loop.

## Changes

- Window descriptions and click receipts expose the actual cursor item,
  including its received custom name, separately from stored inventory.
  Both current-window and player-inventory cursor representations are checked.
- `!closeWindow(window_id)` closes only the currently observed window ID.
  Stale IDs are refused. An occupied cursor can be recovered through the normal
  server close operation; the receipt requires an inventory/window check and
  does not claim that the server stored or dropped anything.
- Ordinary chest withdrawals point to `!takeFromChest`; menu clicking keeps its
  existing boundary and occupied-cursor guards. The new helper does not perform
  inventory clicks, shift clicks or synthetic cursor updates.
- Action error formatting tolerates a missing bot/output buffer during
  reconnect, retaining the original action failure and asking for fresh state.

These changes preserve event-based decision pacing and the external Neko
autonomy owner. They do not add periodic model calls or public game messages.

## Verification and deployment

The new regression cases failed against the preceding implementation, including
the original `output.length` exception. After the fixes, the deployed native
checkout passed **526/526** tests and this contribution branch passed
**549/549** with `node --test`. Command-registry inspection also confirmed that
`!closeWindow(3)` parses to the new command with integer argument `3`.

The native game process was reloaded after the current task ended and the body
was confirmed idle, healthy and without nearby hostiles. The existing launcher
and guardian were used; Neko's main service, desktop process and local model
process stayed running. The reloaded player reconnected with health/food 20/20
and all eight welcome-context parts received and pushed. The LAN viewer then
delivered 81 chunks, 183 avatar updates and 21 time updates in a 20-second
read-only sample, without connection errors.

No diagnostic gameplay task, chat message or inventory transfer was sent.
The new close operation has regression coverage but had not yet been used
organically during the initial post-deployment observation. Ordinary native
self-defense continued; a 50-second passive sample showed 1.09 blocks of
movement and no inventory gain or new Neko task. That short sample does not
establish long-term unattended reliability. The preceding wheat task reported
no mature wheat at the requested destination and did not complete its
commission.

The exported Neko companion source series is unchanged. Intermittent missing
desktop `voice_play_end` acknowledgements remain a separate issue; successful
TTS delivery alone does not verify audible playback.
