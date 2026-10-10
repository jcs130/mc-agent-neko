# Shared viewer update: October 10, 2026

The modern Neko viewer now consumes the updated shared renderer and its native
particle, map and TextDisplay stream. Updating only the browser bundle would
leave these features disconnected: the old host did not relay their protocol.
The consumer adapter now bundles the shared bridge and asset server, while
retaining its existing read-only LAN proxy, eight viewing slots and separate
capture lease.

## Sources and runtime build

| Component | Pinned revision / SHA-256 |
| --- | --- |
| Shared renderer | `06ca0f166675d67a69422a0479b3aeb4d76604fd` |
| Renderer source tree | `044dcc3518de1d600a709da91e5d94dbe991ba24` |
| Cortico host base | `f0db612ce5075287330ab3e095ffa449c6e8e71c` |
| Combined host bundle | `d1ae8b6d88582ff427c9d768887515f94cc4755c850478380b7e67988931017c` |
| Java 1.20.6 browser bundle | `c12fd76c304ee614ea6533d58b56579895a85446c0194656b7d11b782379c0ee` |
| Original Chinese font ZIP | `1f3f828c8d05979f1efe070e8a64dd712fa1358861e5dbe93d76e01857395903` |

The runtime assets were prepared from `java-1.20.6`, generic preset, without
adding optional sound resources. The shared pack preparation checked 5,410
source files. Generated assets, client JARs, captures, configuration and private
deployment logs stay outside Git. The previous asset directory was retained.

Upstream changes include versioned resource packs, original particle/map
rendering, Chinese TextDisplay bubbles, and dungeon terrain reveal when the
avatar is occluded. This update does not merge unrelated Cortico gameplay code
or change local model settings. Rendering observes the existing bot and adds
no LLM inference load.

## Verification

- The old host failed the new map relay regression before integration.
- All 14 host, browser adapter, LAN proxy and modern capture tests passed. They
  exercise both Socket.IO paths with real transport and synthetic game packets,
  including map coverage, Chinese TextDisplay creation/deletion, one particle
  batch per raw packet, reset, font ZIP MIME and cleanup on close/bind failure.
- All 54 selected upstream content, particles, maps, text, terrain visibility,
  floor-mask and shared-pack tests passed. The protocol checks resolved the
  installed Java 1.20.6 Mineflayer dependency through `NODE_PATH`; no live server
  or model was needed for those tests.
- An isolated browser fixture rendered terrain, survival HUD and Chinese
  TextDisplay glyphs using the real new resource bundle. This fixture had no
  Minecraft connection, game writes or model calls.
- The deployed LAN `/index.js`, content/font manifests and original font ZIP
  matched both the local files and their recorded hashes; ZIP MIME was
  `application/zip`.
- Four simultaneous LAN viewing streams ran for 20 seconds, each receiving 81
  chunks and 193–197 avatar frames. A closed slot was successfully reused and
  the viewer count returned to its original value.
- Separate eight-second observations of both socket paths each received a
  content reset, 81 chunks and 74–75 avatar frames. No native map, particle or
  TextDisplay packet occurred during that observation; those live server
  features remain to be observed naturally.
- The visible LAN browser rendered the real terrain, HUD and current villager
  trade offers without browser errors. A Three.js duplicate-instance warning
  remains; it did not prevent these observed views from rendering.
- Deployment refreshed only the viewer on the existing bot. The game entity,
  game process, Neko main/plugin processes and local model process were retained;
  the bot stayed connected with full health and food. The one-time maintenance
  skill was removed afterward.

This verifies integration and the observed browser display, not full Java
pixel parity, native particle physics, map decoration support or every server
plugin effect. The optional sound resources remain absent as before.

## Repeatable checks

Use [modern-viewer.md](modern-viewer.md) for the pinned build/import commands.
Run the host tests before deployment, build into a new directory with the same
version and preset, and compare the bytes actually served afterward. A source
checkout, HTTP 200 or a passing synthetic fixture alone does not establish that
the running viewer uses the new assets.
