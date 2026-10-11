# NEKO YUI YSM model implementation plan

**Goal:** Create an installable `neko_yui` model from the active YUI lolita appearance, then verify and bind the own Minecraft account when the authoritative server permits it.

**Architecture:** Original Bedrock cube geometry and numeric keyframe animations, indexed by a YSM spec 2 descriptor. Reuse the already approved imagegen skin texture byte-for-byte, with explicit UV regions and palette samples for the new ears, twin tails, layered skirt, bows and tail. No Live2D mesh, proprietary model files or private runtime configuration are published.

**Tech stack:** Node.js, YSM 2.4.1 resource format, existing shared Three.js renderer; ZIP delivery. Execute locally in this session within the user's existing authorization to create the model.

## Constraints and review focus

- Keep the game, main brain, local LLM, voice service and observer session running.
- Do not replace the authoritative YSM state with a local fake state or automatically change another player.
- Preserve `Head`, `AllHead`, `ViewLocator`, hand/item and elytra locators, with a separate first-person arm model.
- Every referenced file must exist with exact case, every animated bone must exist, and UVs must remain inside the original texture.
- Preview the actual exported geometry and texture, including the back and animated states. A browser preview is not native-client/server acceptance.
- Publish a source folder and ZIP, source hashes, reproducible builder and precise Worker deployment/binding instructions; do not bypass authorization with `ignore_auth`.

## Tasks

- [x] Inspect active `yui-lolita` reference, approved skin, YSM 2.4 documentation and current viewer support.
- [x] Create `models/ysm/build-neko-yui.mjs` and `models/ysm/neko_yui/` geometry, arm model, main/arm/extra animations and descriptor. The builder copies `skins/yui-lolita-slim.png` unchanged.
- [x] Add `models/ysm/verify-neko-yui.mjs`: verify file paths/case, UTF-8 JSON, bone tree, UV/opaque regions, mandatory clips/locators, archive layout, budgets and hashes.
- [x] Render front/back and animations using the current shared Bedrock/YSM renderer in an isolated preview with no game/chat connection. Save preview and render evidence.
- [x] Create `models/ysm/README.md`, manifest and ZIP; record tested boundaries and the correct Freesia Worker installation/own-account command.
- [x] Commit only related assets/code/docs to the user's fork. If server installation remains unavailable, deliver the finished model package and exact remaining server step without claiming binding.
- [ ] Install on the authoritative Worker and verify native and Web binding after the server-side entry is provided. The finished ZIP and operator instructions are available for forwarding.
