# Core skill failure feedback, surface escape and inventory capacity

## Reproduced behavior

An autonomous return-to-surface task repeatedly descended after a pillar climb
stopped well below its requested height. The underlying `pillarUp` returned
false, but its command callback awaited the result without returning it. The
same omission affected `digDown` and `smeltIron`; an explicit skill failure
therefore reached the action wrapper as undefined instead of cancelling the
dependent command batch.

The existing `goToSurface` pillar fallback was reachable only from a catch.
Normal path failures are caught by `goToPosition`, which returns false; those
blocked routes exited without trying the existing climb.

Full-inventory tasks also repeatedly discarded part of a cobblestone stack and
retried furnace crafting. Inventory queries exposed combined item counts but
no available storage capacity or stack layout. Removing ten from a stack can
leave exactly the same number of occupied slots.

## Repairs and limits

- Return the three skills' actual results through `runAsAction`, preserving
  failure and batch cancellation. No text-based error heuristic is added.
- Try the existing in-place pillar fallback after an unsuccessful surface
  route, including a false return. Death and interruption prevent the fallback.
  Pillar placement, digging, permissions and movement guards remain in force.
- Describe downward digging explicitly as decreasing Y and distinguish it
  from upward recovery. An unfinished targeted pillar reports both heights.
- Inventory queries show free storage slots and the current cursor. At most
  one free slot triggers exact storage stack locations and a short explanation
  of why partial disposal may not free space. Roomy inventory reads stay brief.
- Observations use the initialized active window's player-slot projection;
  trade slots, equipment and cursor items do not count as free backpack slots.
  Unknown capacity remains unknown. No item is automatically discarded.

The model remains responsible for choosing the correct direction, workstation,
NPC and next goal. These changes do not prove all escape or trade tasks succeed.
No periodic inference, synthetic gameplay task or game-chat test was added.
The N.E.K.O. companion patch series is unchanged.

## Verification

Before the fixes, six command/escape regression cases and four inventory-space
cases failed. Afterward, the native full `node --test` run passed **562/562**;
the contribution branch passed **585/585**. Cases cover explicit false results,
partial routes, existing pillar recovery, death/interruption, active merchant
slots, near-capacity detail, unknown capacity and read-only observation.

Passive observation before loading these changes confirmed an independent
autonomous trade: three iron ingots were paid and one emerald received, with
emeralds increasing from three to four. It is evidence of existing gameplay
progress, not an outcome attributable to these new repairs. Deployment and
subsequent natural actions are recorded separately in the local hourly audit.
