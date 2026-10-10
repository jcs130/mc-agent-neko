# Menu-safe combat equipment Implementation Plan

> **For agentic workers:** Execute the following steps sequentially in this session; do not delegate. The active session instructions override the generic subagent recommendation.

**Goal:** Stop self-defense equipment failures caused by player inventory indices being used against an open server menu.

**Architecture:** Guard the existing confirmed-equipment helper at the inventory boundary. Close only an initialized window with an empty cursor, then select from the refreshed player inventory. Combat must stop if this handoff or confirmed equipment fails.

**Tech Stack:** Node.js, Mineflayer 4.37.1, prismarine-windows, node:test.

**Spec / evidence:** The 13:02 inspection found repeated `AssertionError: invalid operation` at Mineflayer `moveSlotItem` called by `equipHighestAttack` / `defendSelf`. No physical task had completed since the preceding inspection. An open merchant has player slots 3–38, while `bot.equip` targets player hotbar slots 36–44. This is a client inventory addressing fault, not evidence of a server fault.

**Constraints:** Preserve the running model/main/desktop; preserve unrelated working changes; use the existing lifecycle for any native reload. Never drop cursor contents or click NPC menu controls as equipment slots. Preserve exact item identity. Do not add polling or game chat.

- [x] Add a regression using the installed Mineflayer equipment implementation and real prismarine windows; reproduce the invalid slot with a full hotbar and merchant open.
- [x] Guard `src/agent/library/tick_confirm.js` against cursor/uninitialized/racing windows and refresh inventory before weapon selection in `src/agent/library/skills.js`; abort combat on failure.
- [x] Run the focused tests and complete native/fork discovery suites; record real exit codes and logs. Red 0/7; focused 31/31; native 591/591; fork 634/634.
- [ ] Commit the specific files in both repositories and push the user's existing contribution branch. Save a repair receipt with the actual occurrence baseline.
- [ ] Reload only the owned native component at a safe idle boundary, observe natural action, record deployment/runtime evidence, and update the hourly baseline. Leave verification pending when actual recovery has not been observed.
