# Project N.E.K.O. companion plugin patches

This directory carries the matching Project N.E.K.O. Minecraft plugin changes
alongside the Minecraft body in this fork. It contains 31 ordered Git patches,
including scoped protection receipts, adaptive heartbeat pacing and collision facts for recovery.

The series targets [Project-N-E-K-O/N.E.K.O](https://github.com/Project-N-E-K-O/N.E.K.O)
at commit `fb2a2e731a8c954478d08678b0c8cf40e8145a54`. It changes only
`plugin/plugins/game_agent_minecraft/`: the modern viewer panel, full game
observations and welcome context, public/private communication tools, server
skills, unattended sessions and decision/action feedback. Local provider
configuration, model weights, credentials, runtime logs and character memories
are outside the bundle.

`manifest.json` records the base and source commits, each patch's SHA-256, and
the exact resulting plugin tree. Patch bytes are preserved by `.gitattributes`.
The upstream project's Apache-2.0 license continues to apply to its plugin code.

## Apply in a clean N.E.K.O. checkout

Use a separate branch and save any existing changes first. Set `$mcAgentFork`
to the path of this mc-agent-neko checkout. From the N.E.K.O. repository:

```powershell
$mcAgentFork = 'C:\path\to\mc-agent-neko'
git switch -c integration/neko-gameplay fb2a2e731a8c954478d08678b0c8cf40e8145a54
$patchDirectory = Join-Path $mcAgentFork 'integrations\project-neko\patches'
$pluginPatches = @(Get-ChildItem -LiteralPath $patchDirectory -Filter '*.patch' |
    Sort-Object Name | Select-Object -ExpandProperty FullName)
git am @pluginPatches
```

If a patch cannot apply, resolve it using normal `git am` conflict handling or
use `git am --abort` to return to the original branch state. Newer upstream
revisions can require a rebase; compatibility with arbitrary later revisions
has not been established.

## Verify and configure

With N.E.K.O.'s dependencies installed:

```powershell
python -m unittest discover -s plugin/plugins/game_agent_minecraft -t .
git rev-parse HEAD:plugin/plugins/game_agent_minecraft
```

The exported plugin passed 84 tests. Applying the complete series to the pinned
base reproduced plugin tree `977447c231ccf155bf5f3604b2d7313145c03ce1` exactly.

Follow the patched plugin's README for the existing N.E.K.O. plugin lifecycle,
viewer and unattended settings. On the Minecraft body, set
`external_autonomy_owner` to `"neko"` when N.E.K.O. owns autonomous decisions;
set `server_protection` to `"mycli"` only on a server advertising that protocol.
Use the existing plugin configuration APIs to apply live settings. Start N.E.K.O.
and its Minecraft plugin together; loading patches alone does not start gameplay.

Permission receipts remain specific to their action, dimension and coordinates.
An `allow_likely` result is tentative, and missing tools or local digging-safety
refusals must not be described as confirmed server protection denials. These
changes improve information and scheduling; they do not guarantee unattended
survival or successful ore collection.
