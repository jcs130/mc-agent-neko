# Boxed retreat recovery

Evidence: on 2026-10-11 around 03:22–03:32 Beijing, fresh game samples kept the same position, health 20, food 20 and inventory. Native events alternated `Outmatched … digging in` and `Walled off the archer` roughly every six seconds. Daylight did not end the cycle. The action-mode mobility state was FREE, whereas the independent, fresh world observer reported ENTOMBED with no exits. There was a zombie about 0.4 blocks away, and no recent damage. This does not establish a server fault or prove that the zombie is behind a wall.

Mechanism: the existing confinement handoff prefers the indefinitely retained action-mode mobility state over the independently sampled geometry. Only self defense consumes the handoff; retreat selection can therefore keep reacquiring the body and prevent mobility from running.

Change: prefer world geometry only within its five-second freshness window, and reuse the existing handoff in retreat selection. Keep actual damage, creeper response, drowning, fire and other physical emergency paths. Do not alter game state, add model calls, force movement or replace the planner.

Verification: reproduce the fresh ENTOMBED/old FREE case using the real policy functions. Cover recent damage, creepers, expired/future observations and fresh open geometry. Run combat, mobility, ownership and mission regressions. Record the repair ticket occurrence baseline before deployment, and retain pending receipts if it changes.

Deployment: retain the main host, model and MindServer. Prefer an owned child reload only at a full-health daytime boundary with no productive action; a stable, non-damaging sealed pocket can be considered separately from an active exposed encounter. If no suitable boundary occurs, leave the source prepared and report that limit.

Prediction: retreat stops reacquiring the body for a non-damaging, freshly observed sealed pocket. Mobility gets an opportunity to recover. This does not guarantee that the exit is diggable, that tools are available or that a later task will finish. Verify actual movement or material changes before claiming recovery; compare subsequent damage/death evidence and revert on a safety regression.
