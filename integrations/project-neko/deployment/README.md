# Windows unattended guardian

This directory preserves the guardian used by the existing local Neko trial.
It is a deployment reference, separate from the ordered N.E.K.O. source patches.
The guardian expects the trial's `trial-lifecycle.ps1`, `start-trial.ps1`,
`start-local-model.ps1`, process records and explicit unattended state alongside
it. Review the installation-specific paths, ports and model name before use.
It does not create those services or grant permission for unattended play.

The guardian distinguishes three Minecraft states:

- A healthy local viewer and online player need no recovery.
- A healthy local viewer with an offline player waits for the native client's
  existing reconnect loop. Remote timeouts do not increment the local process
  failure counter or invoke the launcher.
- An unavailable local viewer still uses the existing bounded recovery path.
  Neko and plugin failures remain eligible for recovery while the server is down.

Stopping unattended play remains authoritative. An already running model is
  retained during loading or inference. The guardian's own process must be
  replaced without recursively terminating its children when applying a change.

Run the regression scenarios without connecting to Minecraft, calling a model,
or changing any live service:

```powershell
pwsh -NoProfile -File .\test-supervisor-outage.ps1
```

The tests run the actual guardian in isolated temporary fixtures. They cover
healthy services, one and repeated remote outages, missing local viewer, missing
Neko, missing plugin, and an explicit stop. All seven scenarios passed for this
revision. The remote-outage test failed before the fix because the old guardian
classified it as recovery and invoked the launcher.

During the 2026-10-10 inspection, the native client experienced remote TCP
timeouts and reconnected through its existing fourth retry. The Minecraft,
Neko and model processes were retained when the corrected guardian was loaded.
The interrupted harvesting task was not counted as completed.

The same inspection found an omitted reasoning setting on a memory-review
request. Strata's supported `/settings` API now supplies
`{"defaults":{"reasoning_effort":"none"}}` for requests that omit the field.
Its shared settings file persists this choice. Explicit client settings still
take precedence. A request with no reasoning field returned three answer tokens
with no reasoning content in 0.72 seconds; no model restart was needed.
This is an installation setting, not an additional N.E.K.O. source patch.
