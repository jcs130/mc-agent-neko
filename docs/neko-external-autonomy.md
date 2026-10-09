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

Validation: 223 native tests passed; the companion plugin's 74 tests passed.
The deployment config explicitly sets `external_autonomy_owner: "neko"`.
A passive 55-second observation of a genuine Neko mining mission recorded
16 blocks of movement, inventory changes, and 17 active snapshots, with no
independent kernel commit or failed body handoff. The existing local Qwen
endpoint and LAN viewer were healthy. See trial artifacts
`query-loop-actual-task-20261009.json` and
`neko-stuck-final-health-20261009.json` under `D:/neko-mc-trial/`.

Later trial checks found a separate 110s absolute task limit; the runtime
budgets are now inactivity 180s, absolute 280s, and plugin wait 295s. Applied
unattended configuration is synchronized through the existing Neko hot-update
API and checked in the live plugin after reload. Missing mining pickaxes now
produce explicit body-model feedback instead of empty action output. Native
regressions: 225 passed, with 74 companion plugin tests passed.

The character subsequently selected inventory/crafting/wood gathering to
repair its prerequisites. The final observation encountered a new server
connection timeout; an independent 8s TCP probe also failed. Automatic recovery
remained enabled and restored login/spawn and fresh online telemetry by 10:51.
Current connectivity must be checked separately from the earlier verified
task progress; no successful ore collection is claimed.
