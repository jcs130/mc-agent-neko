# OBS minimap update and YSM availability

## Source and scope

The Neko viewer advances from shared renderer `79ddc629` to upstream main
`595a3a0eb405c0c1d2d6c5aafffd375d51ac510a`, plus the separately published
[YSM diagnostic fix](https://github.com/jcs130/mc-visual-console/commit/b71e0f567b17e433d40f3a5a7fab883e198816aa).
The resulting renderer pin is `b71e0f567b17e433d40f3a5a7fab883e198816aa`.
Cortico host source remains `f0db612ce5075287330ab3e095ffa449c6e8e71c`.
The importer retains local self-skin, both login-mana race repairs, original
mana observation timestamps, read-only LAN access, eight viewing slots and
the separate capture lease. No gameplay, inference, TTS or server changes.

OBS `/?obs=1` (also `?overlay=1`) now keeps the existing 2D minimap visible
using the same `minimap` feed. It does not create a world renderer, player
preview, extra Minecraft connection or chunk request. Disconnects and subject
changes clear old terrain. Upstream also adds bounded, classified read-only
chat history; this only changes browser presentation, not the Agent's context
or messages sent to players.

## Observed YSM issue

At 17:32 Beijing time, a real LAN subscriber received five appearance events
in 22 seconds. The bound state was `available=false`,
`reason=YSM_WORKER_STATE_UNAVAILABLE`; no `appearanceAsset` arrived. Meanwhile
205 avatar frames, 81 chunks and 44 minimap updates arrived without connection
errors. The page had no captured browser error. This establishes unavailable
server appearance state, not a failed geometry loader or a proven server bug.
The model assignment/Worker state still needs server-side confirmation.

The shared host incorrectly substituted `YSM_ASSET_PENDING` as `renderReason`,
and the browser counted only available states missing their assets. Thus the
actual server-unavailable reason was absent from browser status. The fix
preserves the reason, reports it explicitly, and separates server state,
unpublished source, asset transport and renderer failures. Unavailable states
send no asset request. Valid later state replaces the notice normally.
Original source, version/hash, UUID/entity binding, expiry and transport
limits remain enforced. No guessed YSM mesh or animation is generated.

## Build and regression

The candidate is Java 1.20.6, generic preset, with the previously enabled
original sounds. Both original asset packs are retained and SHA-checked:
5,410 visual files and 3,688 sound files. Accepted previous assets remain
available for rollback. Generated assets and private runtime records stay
outside Git.

- Browser bundle SHA-256: `f8fd4f4355bc621cb9663e5031b04b8baabf6cd5ed70b7d2678fad23ee2dc50f`.
- Bundled host SHA-256: `860d84f1a6f532a4ac0afe8650f749102aabfda151f9151f48ffb1e1c99ff88d`.
- Renderer/host-adapter build-source digest: `a6f29fea1246f83a67d22fde27b7787003427d62c7238fbfb236bf2783349896`, 182 source files.
- Two new YSM regressions failed before the repair: wrong host reason and
  missing browser server-unavailable diagnostics. They passed afterward.
- 73 selected shared host/page/asset/YSM/chat/map/camera regressions passed,
  no failures or skips. Two OBS map tests exercise real panel event handlers
  with a synthetic 2D canvas: painting, disconnect, recovery, subject changes
  and detachment, with no world/player renderer.
- 16 consumer host/adapter/LAN tests passed, including both socket paths,
  same-connection login mana, timestamp retention, original resources, skins,
  cleanup, and unavailable YSM state followed by a later model state.
- The upstream build checker reports `ok=true` for source and actual bundle.

## Deployment acceptance

Prepared; the live viewer refresh and browser acceptance are recorded below
after deployment. Passing fixtures or HTTP 200 alone does not establish live
YSM rendering, native Java pixel parity or an actual OBS recording.
