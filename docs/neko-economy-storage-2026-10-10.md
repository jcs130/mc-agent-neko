# Economy and portable storage repair, 2026-10-10

## Reproduced problems

At the normal 700-token decision budget, a named player-head backpack disappeared
from the operational inventory summary. Zero emeralds was also being treated as
an inability to trade, even when a merchant could buy carried materials. The
summary now retains named storage separately and ranks received, affordable
material-selling offers before unaffordable purchases. This selects evidence;
the model still chooses its goal and whether to trade.

The ordinary **大背包** is a Minepacks warehouse. The live server declares both
`betonquest:backpack` and `minepacks:backpack`. On this server, bare
`/backpack open` and the head shortcut opened BetonQuest's journal menu instead
of the ordinary warehouse. That unrelated menu is not evidence that the named
head only supports quest items. Configuring `backpack_command` as
`/minepacks:backpack open` opened the real 54-slot warehouse, containing ordinary
logs, apples, furnaces, workbenches, tools and cobblestone. All 54 slots were
occupied, although compatible partial stacks can still accept more items.

## Reused Cortico behavior

The local user fork at `D:/Cortico-jcs130`, revision `f0db612`, supplied the storage
guide and reference implementations. Relevant sources are
`packages/cortico-world-qiandengji/src/guides/storage.md` and
`src/worlds/minecraft/{skills-container,container-window-ownership,inventory-click-sync}.ts`.

The small canonical stack-identity helper was adapted into
`src/agent/library/inventory_stack.js`, including component removals and component
ordering. Its MIT copyright and permission notice are retained in
`LICENSES/Cortico-MIT.txt`. The container tools follow the reference's mechanical
requirements: exact observed items and slots, wait for opening to settle, bind
to the actual window instance, separate storage from selection buttons, count
player slots in the current container instead of a stale global inventory, and
verify source/destination changes and cursor state from server packets. The
Cortico framework and its task scheduler were not transplanted.

Minepacks can replace the initially opened window with its final window while
reusing the same numeric ID. Opening now waits for a stable window instance.
Mineflayer's 1.20.6 full-inventory handler also omits `carriedItem`; the transfer
receipt explicitly tracks the server cursor, including signed/unsigned cursor
slot packets. A resolved local transfer alone is not success. Replacement,
missing confirmation or a full destination ends the operation without an
automatic repeat.

## Tools and information

- `!openBackpack(slot)` uses the exact named item and optional configured provider
  command, without placing a player head in the world.
- `!openStorage(command)` exposes the documented Minepacks and personal reward
  routes. `!window` reads both storage and player slot ranges before transfer.
- `!moveBackpackItem(window_id, slot, count)` deposits or withdraws according to
  the observed source side, preserves custom stack identity, and refuses nested
  backpacks and insufficient capacity.
- Current nearby loaded containers are discovery facts. Their presence does
  not establish public access, ownership or contents.
- Companion patches 0058–0059 retain storage identity/provider and useful trade
  quotes in bounded context. Full details remain available through observation.

The personal reward container reached through the skill compass is distinct
from Minepacks. Its live guild-menu button reports 10 pages/540 slots and a
remote opening cost of 2 mana. Both the direct reward route and this actual menu
button returned `MC_PROFESSION_RESULT`, `success=false`, `reason=not_learned`,
`skill=travel` for this account. The current prerequisite reply is preserved;
this is not classified as a prohibition on storing items. Reward selection
menus are not treated as transferable items. The rewards overflow summary
`visible=0 queuedBonus=0` does not establish that the actual reward container is
empty. Its live storage contents and transfers remain unverified in this run.

## Verification and limits

The native source passed 517 tests, the contribution branch passed 540 tests,
and all 189 Minecraft plugin tests passed. New
regressions cover the named head at the real context budget, late affordable
material-selling quotes, loaded container facts, command/provider separation,
same-ID replacement windows, authoritative cursor state, server prerequisites,
stack identity and refusal without a confirmed transfer. The 59 plugin patches
and approved host patch reproduce the exact committed plugin tree and host blobs.

A real Minepacks round trip was verified: storage/player apples **5/0 → 4/1 →
5/0**, with a fresh close/reopen between transfers and a final reopen. No items
were discarded. Read-only menu and command queries identified the reward
prerequisite; no skill point was spent and no public chat test was sent. Tests
verify selling-offer presentation, but no real merchant sale or emerald gain
was demonstrated by this probe.

The patched Minecraft body, N.E.K.O. Minecraft plugin and existing unattended
guardian were restarted. The local Qwen endpoint remained loaded and the LAN
viewer returned HTTP 200. Bilibili login/listening and the hourly inspection
automation remain separate services. This short verification does not establish
overnight survival or successful future reward collection.
