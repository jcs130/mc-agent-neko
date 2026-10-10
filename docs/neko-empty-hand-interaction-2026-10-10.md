# Empty-hand NPC interaction preserves inventory

Two autonomous `!useOn("hand", "villager")` calls failed with
`AssertionError: invalid operation`. The captured stack went through
Mineflayer's `unequip`, `equipEmpty`, `tossStack` and `clickWindow` while a
merchant window was still open. Player inventory indices were being applied
to a smaller merchant window. The dependency also tries to discard the held
stack when it finds no free inventory slot.

The native `equip("hand")` path now refuses an occupied cursor or an
uninitialized window. It closes an initialized window through Mineflayer's
normal method, which copies current player slots back to the inventory, then
selects a known empty hotbar slot or moves the whole held stack into a known
empty storage slot. A full backpack returns an explicit failure and preserves
the item. Window changes, interruption and an unconfirmed empty hand also
prevent interaction. The `!useOn` command returns the skill's actual result
through the existing action wrapper, so a refusal cancels dependent actions.

Seven regressions run actual skill/command source and the installed dependency's
unequip implementation. Against the original committed code all seven fail,
including the captured invalid-operation path. All seven pass after the fix.
The full native suite passes **574/574**; this contribution branch passes
**597/597**. Tests cover merchant slot copying, preservation of a full backpack,
whole-stack storage, an occupied cursor, uninitialized and racing windows,
ineffective movement and command failure propagation.

This change neither selects the next gameplay goal nor adds periodic model
calls. Some NPCs still time out opening windows, and repeating a merchant
without the required offer remains a separate planning/identity issue.
Deployment and subsequent natural interactions are recorded in the local hourly
inspection; these tests do not prove a coal sale or commission completion.
The existing N.E.K.O. companion patch series is unchanged.
