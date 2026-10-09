# Current task evidence and inventory during open windows

## Reproduced failures

Several autonomous tasks returned `!endGoal` on the model's first reply, without
a current game query, action result or measured inventory change. The executor
reported success anyway. Later, a replacement supply task immediately returned
`!cannotComplete` using the preceding merchant task's failure explanation,
without checking the new task. Historical narration was being treated as
current execution evidence.

A separate observation mismatch occurred during real merchant transactions.
The open merchant's player slots changed, but `!inventory`, periodic vitals and
mission inventory evidence continued reading `bot.inventory`. After closing the
window, that cache changed from 11 iron ingots and no emeralds to 5 ingots and
2 emeralds. Both trades had received server payment/output confirmations, yet
the stale observation could still encourage an unaffordable repeated purchase.

Installed Mineflayer 4.37.1 updates `currentWindow.slots` for nonzero window IDs.
Its client `closeWindow` path copies the window's player slots into the base
inventory. Reading that base alone while trading therefore misses changes.

## Repairs

- Model-origin `!endGoal` and `!cannotComplete` require a result from the current
  task or a measured inventory change. Otherwise the executor keeps the task
  active and returns guidance to obtain relevant current evidence, before the
  command can interrupt self-prompting. Old or late results belong to their
  original task. Explicit player lifecycle commands retain their authority.
- This is a minimum evidence requirement, not a semantic verifier. Receiving
  one query does not establish that an arbitrary goal is complete, and a failed
  task may still have made real progress.
- A read-only inventory projection maps the active window's 36 player storage
  slots to player indices, preserving equipped armor and offhand. Queries,
  custom-item labels, game-state snapshots, vitals, direct inventory frames and
  mission deltas now use this view. Capacity and held-item observations follow
  the same current slots.
- Uninitialized windows and invalid slot ranges retain the known base cache.
  In the installed Mineflayer version, window helpers are installed only after
  initial contents arrive, before `windowOpen`. Menu items, trade inputs/output
  and the cursor are excluded from carried inventory. Neither cache nor
  `item.slot` is mutated; the observer sends no clicks and does not close menus.

Decision pacing, compact context, public/private communication and the external
Neko autonomy owner are unchanged. No periodic model call was added.

## Verification

Regression tests reproduced unobserved completion, stale failure termination
and merchant inventory disagreement before their fixes. The final native
checkout passed **541/541** tests, and this contribution branch passed
**564/564**, using `node --test`. Coverage includes late-task isolation,
read-only completion, real action failure, explicit player termination, active
merchant/container slot mapping, cursor exclusion, custom names, equipment,
capacity, held items and nonmutation.

The native process was reloaded through the existing launcher after a fresh
idle check: no pending task, no busy action, full health and no nearby hostile.
The guardian was paused for deployment and restored. Neko's main service,
plugin host, desktop and local model stayed running. The player reconnected
normally. The exported Neko companion patch series is unchanged.

The two emeralds above are verified physical inventory, not proof of completed
guild commissions or all server trials. Wheat remained at three during the
failed harvest attempts; no completed wheat commission is claimed. Audible
desktop speech remains unverified, with intermittent playback-end watchdogs
recorded separately from successful TTS delivery.
