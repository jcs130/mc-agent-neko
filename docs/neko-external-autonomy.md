# External autonomy ownership

When Neko controls autonomous play, set `external_autonomy_owner` to `"neko"`
in the runtime settings (including `SETTINGS_JSON`). The native kernel then
yields its survival/companion decision loop, including gaps between external
missions and startup before the plugin connects. Without a configured owner,
an attached game-information controller also reserves autonomy dynamically.
Standalone deployments keep their existing kernel behavior by default.

Explicit tasks still execute native skills through AdminMission. Independent
vital reflexes remain active. Kernel decisions recheck ownership after awaiting
the model and skill import; they cannot clear an external interrupt or claim
the body after ownership changes. Existing body handoff failure remains closed
when an old action has not exited.

2026-10-09 incident: live Neko tasks were accepted, then rejected after a
two-second body handoff timeout while the native kernel independently ran
`replenishKit`/`surfaceUp`/`chopWood` and dispatched more work between missions.
Neko's natural-language idle latch missed the still-active structured skill.
Regression tests cover startup reservation, survival/companion yielding,
ownership changing during an awaited decision, explicit task availability,
and preserving interrupts without taking the body.
