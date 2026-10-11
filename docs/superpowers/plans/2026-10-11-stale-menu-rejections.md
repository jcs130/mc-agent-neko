# Bound rejected stale menu actions

> Implementation uses the existing diagnosis, git and verification workflow in this chat; no delegated workers are needed for this small repair.

**Goal:** A repeated rejected menu action must reach the existing completed-failure boundary instead of keeping the unlimited command loop alive.

**Architecture:** `menus.js` checks the current window before any click/close. Its explicit precondition refusals will use the existing trusted `Action not started:` classification. Keep the current window ID in stale-window evidence so a changed window resets the repetition comparison. Do not broaden the mission guard to arbitrary server/player prose.

**Tech stack:** Existing Node.js modules and `node:test`, no new dependency.

**Evidence:** The 12:02 Beijing hourly inspection found 97 stale close rejections in the native session archive, including 95 consecutive assistant `!closeWindow` invocations. This archive count is not a precisely timed 95-call interval. Current passive telemetry has movement; it does not prove physical escape or productive survival.

## Constraints and review focus

- Keep current local game/vision model, prompt, reasoning and concurrency settings.
- Never submit a click or close to a mismatched, absent or unsafe window.
- Successful submission still does not prove inventory transfer or task completion; preserve cursor evidence.
- Changing window IDs, model parameters/results/state, explicit player commands and healthy body work must retain existing reset/ownership rules.
- Do not add model calls, gameplay commands, forced movement or public chat.

## Scoped implementation

- [x] Record repair-queue occurrence baseline and metadata-only native evidence.
- [x] Add red integration tests using the real menu helpers plus command/mission boundary: warn at three and hand back at five identical refused model closes/clicks, but preserve changed-window and successful operations.
- [x] Classify existing menu precondition refusals; include the actual current window ID when the requested ID is stale. Keep successful paths intact.
- [x] Run menu/mission/infinite-loop regression, complete native tests, syntax and whitespace checks. Record trigger, mechanism, falsifiable prediction and attribution in the ledger.
- [x] Commit/push the scoped repair to the authorized fork; prepare native checkout and load only at an existing safe owned idle boundary. Otherwise leave it prepared.
- [x] Write the maintainer receipt with actual phase and evidence. Observe naturally and report acceptance limits; record the hourly comparison/log as the closing operational step.

Actual outcome: fork `975bb9c`, native disk `9d99bbd`; running child 14188 still
has the prior `f83473e` version. Two bounded gates did not permit reload. The
prepared receipt is API-confirmed, the guardian was restored and healthy game,
host, model and TTS processes were retained. Deployment and natural menu-loop
acceptance remain pending; this plan does not label the broader ticket resolved.

**Falsifiable prediction:** Five identical completed stale-menu refusals with unchanged measured state return the current task with its actual evidence. A new window, a real result change or an explicit player operation permits a fresh attempt. This does not promise escape, a successful trade or elimination of speech repetition.
