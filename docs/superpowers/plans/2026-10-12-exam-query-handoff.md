# Guild exam query handoff implementation plan

**Goal:** Keep an observed read-only guild exam status reply from consuming the idle planner's existing final action opportunity.

**Architecture:** Classify only the exact observed `/mycli guild exam status` grammar as receipt metadata in `src/websocket/server_commands.js`. Keep the `serverQuery` permission gate unchanged. Reuse the existing Neko readiness, stop/pause, busy and bounded final-request checks; no additional inference rounds or forced actions.

**Evidence:** On October 12, repeated rounds read exam status, spell list and self-heal explanation. A loopback call through the running plugin returned `readOnly=false` with fresh `ready_if_authorized` execution state. `_minecraft_action_followup_tools` rejects a round containing any non-query server receipt. The timing scope `minecraft` combines ordinary and execution requests and alone cannot identify a missing execution flag.

- [ ] Reproduce with the real native command bridge and an exact exam-status fixture; cover mutations, unknown suffixes, namespaced normalization and unchanged query permissions.
- [ ] Add the exact metadata grammar, run native command regressions and existing Neko handoff regressions; verify a three-server-query round offline with the native receipts.
- [ ] Record the mechanism, prediction and limits in the supervisor changelog; commit and push only related files to the user's fork.
- [ ] Deploy only through the owned lifecycle at a confirmed safe idle boundary; preserve main/model/voice/desktop/eye. Verify real readiness/receipt classification and natural task outcomes. Report deployed versus verified honestly.

No raw prompts, responses, reasoning, credentials or voice identifiers go into diagnostic artifacts. Original game evidence remains intact. A new monitor occurrence requires a new baseline before any repair receipt. Complete the hourly health inspection when due, independently of this repair.
