# Zombie defense and equipment context repair

The user prioritized autonomous survival and deferred the separate DSH upgrade.
The existing N.E.K.O. task owner and local Qwen endpoint remain the runtime.

## Evidence and cause

Fresh player telemetry showed two zombies around 4.7–9.2 blocks away, health
20, food 20, four worn armor pieces, and no sword, axe or shield. The inventory
already contained 14 iron ingots, 22 sticks and a crafting table. Zombies were
being observed; the missing link was response selection and equipment planning.

`armoredZombieBrawl` suppressed retreat whenever a zombie was close and any
armor was worn. `self_defense` required a sword or axe, so an armored but unarmed
body could yield to combat that would never start. A separate unarmed solo-mob
exception also suppressed retreat even after damage. The armor override could
similarly yield a three-mob swarm to a defense mode that explicitly rejects it.

Bounded Neko resource summaries retained pickaxes, iron, wood and workstations
but omitted melee weapons and shields, making preparation gaps difficult to
see in the ordinary autonomous decision context.

## Resulting behavior

- Retreat yields to a close armored zombie fight only with a melee weapon and
  fewer than three nearby actionable attackers. Distant mobs still allow
  bootstrap work; closing within five blocks or recent damage triggers retreat
  for an unarmed body.
- Combat and retreat share the same fresh disconnected-path evidence. Missing
  or expired evidence and actual damage retain the threat. Creepers stay out of
  both the mode's target selection and the inner ordinary defense loop.
- Axes qualify for close melee defense before preventive night shelter.
- Decision/emergency summaries retain melee counts, shield and worn armor.
  Incomplete inventory data stays unknown rather than asserting absence. At
  the next planning boundary, the model is told to prepare and verify a weapon
  from existing supplies once safe. Running-task summaries stay unchanged;
  there is no new periodic model call or equipment-preparation interrupt.

## Verification

Eleven combat handoff tests exercise the actual mode callbacks and inner skill
selector. Five equipment-context tests cover crowded inventory, emergency
budgets, partial counts, axes versus pickaxes and running tasks. The complete
native suite passed 512 tests; the Minecraft plugin suite passed 172. The new
helper has no lint warnings/errors; existing mode/skill lint counts did not
increase. All 55 companion patches replay from the declared base to the exact
source plugin tree.

A replay of fresh live observations retained the weapon gap, shield count,
four worn armor pieces and existing crafting supplies in a 694-token decision
capsule; the emergency capsule was 498 tokens. This confirms context projection,
not a successful craft or kill. Long unattended survival still needs runtime
observation.

## Follow-up: a successful craft was reported as impossible

After deployment, Neko independently dispatched weapon preparation. The body
placed and recovered its crafting table and the server confirmed one new wooden
sword. A later native model turn nevertheless claimed it could not tell whether
the sword was new and reported the task impossible. Completion evidence previously
retained only query results, and the pinned task had no initial inventory.

The task controller now snapshots received inventory at handoff and pins at most
eight actual count changes beside the current task. All inventory slots are
counted, so moving armor between slots is not an acquisition. Unknown baselines
stay unknown, and superseded tasks cannot contribute evidence. Actual action
results also enter the existing bounded completion evidence, with measured deltas
ahead of raw observations. Inventory gains do not automatically turn an arbitrary
failed multi-step task into success. Five additional regression tests cover these
contracts. No new model call or periodic decision timer was introduced.

Runtime observations confirmed the wooden sword in inventory, continued autonomous
dispatch toward a village supplier, full health/food and an HTTP 200 LAN viewer.
A new zombie kill and long unattended survival have not been observed.
