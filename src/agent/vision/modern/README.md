# Modern viewer host

`host.mjs` is bundled from Cortico's MIT-licensed Mineflayer viewer. `source.json`
records its source revision, inputs and SHA-256. It receives the existing bot;
it does not start Cortico, another game login or an LLM. The host speech and
livestream overlay is removed by the importer; Minecraft audio remains available.

Rebuild from a compatible local source checkout with its dependencies installed:

```powershell
node scripts/import-modern-viewer.mjs D:\Cortico-jcs130
```

The separately generated Minecraft 1.20.6 browser assets are runtime data.
Set `viewer_type` to `modern` and `modern_viewer_assets_dir` to their root, which
must contain `viewer-client.json`, `dist/`, `public/` and `render-assets/`.
Set `modern_viewer_lan_address` and `modern_viewer_lan_prefix` to expose the
picture on the local subnet. Viewer access is read-only; agent control stays
on its existing local WebSocket. First, third and dungeon views use one port.

`modern_viewer_max_sessions` controls simultaneous viewing connections across
all views, local tabs, plugin iframes and LAN devices (default 8, integer 1-16).
Each open page consumes one connection. The upstream limit of two could reject
a LAN viewer when two local previews were already open. Capture keeps its own
separate limit of one. `/healthz` reports current and maximum viewing counts.

With the agent running and four free viewing slots, check concurrent streaming
and slot reuse without sending game actions:

```powershell
node scripts/verify-modern-viewer-sessions.mjs http://192.168.3.133:3000
```

Sound is optional: `public/sounds/registry.json` must be exported from the
matching vanilla client (1.20.6 has 1607 sound event IDs), and audio files and
their manifest must be present to hear them. The current trial has rendering
assets but no complete sound export; numbered packet audio is disabled safely.
