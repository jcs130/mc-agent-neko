# Received NPC identity in bounded decisions

The native `!entities` command already exposes actual names and positions.
The N.E.K.O. planning projection still discarded entity IDs and coordinates,
and silently showed only four received entities. The model repeatedly sent
the body to a remembered fisherman at the location of a named supply merchant,
even after the real merchant menu showed emerald-cost purchases only.

Companion patch 0061 retains each displayed entity's received ID, type, custom
name and rounded finite coordinates. Sampled or source-truncated entity lists
carry an explicit partial marker and the full `nearby` observation route.
Missing IDs/coordinates stay unknown. Names do not imply professions or offers.
The existing context ceiling, nearest-four selection and event pacing remain.

Seven regressions cover identity/coordinates, partial lists, missing/invalid
identity, offline and new-login state, source truncation and token budgets.
Against the pre-fix projection, four of these error on lost fields; all 202
Minecraft plugin tests pass with the change. All 61 plugin patches and the host
patch replay from the declared base to the exact recorded source tree.

This fixes missing facts, not all causes of repetitive planning. A task's `ok`
receipt or an opened menu is not proof of a sale; actual payment/output changes
still need verification. No live successful sale or sustained independent
survival is claimed by this patch. Runtime deployment and ticket acceptance
are recorded separately by the hourly maintenance process.
