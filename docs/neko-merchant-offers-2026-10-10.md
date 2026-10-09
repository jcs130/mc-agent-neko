# Merchant offers lost after custom NPC menus

The live executor opened `minecraft:merchant` titled `机关师·小铜`, repeatedly
queried `!window`, and declared the purchase impossible because it saw no slots.
Merchant slots 0–2 are ingredients/output, not the list of offers. They normally
remain empty until an offer is selected. The bridge retained raw `trade_list`
packets but neither decoded the current window's trades nor rendered them in
`!window`. Mineflayer's decoder is normally installed only by `openVillager`,
which custom NPC menu transitions do not invoke. Reopening that NPC can return
to its generic menu rather than the merchant already reached.

The bridge now decodes a copy of received, matching-window packets with the
installed Prismarine item decoder and Mineflayer demand/reputation pricing.
`!window` shows 1-based offers, payment quantities, result names/lore, uses,
stock limits and disabled state. Unreceived/undecodable offers remain unknown;
only a received zero-offer packet means an empty list. Normalized quotes precede
large slot/raw-packet data in the observation budget. Existing raw data remains
available for compatibility.

`!tradeWindow` executes a received offer in the current merchant without
reopening the NPC. It rejects stale IDs, occupied cursors/inputs, unavailable
stock, insufficient payment, bad inventory boundaries and interrupted actions.
Success requires payment/output changes from server inventory packets, rather
than optimistic client slots or Mineflayer's local use counter. Unknown outcomes
request inventory inspection and never automatically retry. Villager inspection
keeps its window open and the older direct-villager entry shares this pricing and
confirmation path. Command action failures now propagate to the task executor.

The N.E.K.O. companion patch preserves merchant status, received offer count and
up to three compact quotes in the next planning context. Under a small budget,
quotes reduce to an explicit partial summary and an observation-tool route.
Full cached quotes remain accessible; running tasks receive no new merchant
planning prompt or timer. The ordered companion series contains 56 patches and
replays from its declared base to the exact source plugin tree.

Verification: the full native suite passed 525 tests, including 13 added merchant
and packet-bridge regressions. The Minecraft plugin suite passed 176 tests,
including four context regressions at 400/700-token callback budgets. The new
native helper is lint-clean; existing changed files gained no lint diagnostics.
A replay against the previous menu implementation reproduces the empty-slot
symptom from the same decoded quote that the repaired renderer displays.

These tests establish packet handling and transaction safeguards. A real new
purchase and long unattended survival still require runtime evidence.
