# Preserve native chat rejection reasons in supervisor evidence

The 08:28 Beijing inspection independently matched three failed `chat_result`
receipts in the native event archive. Each has `reason: Invalid player name.`;
the supervisor projection shows an empty message because it only reads
`message` and `error`. T-0045 consequently describes an unexplained trading
failure although these are rejected social messages. Original occurrence
baseline: 1. This is not evidence that a trade executed or that the server failed.

1. Reproduce through the actual `sendGameChat` guard and `buildEvidence`; use a
   fake bot that cannot send, not a message to the live server.
2. Select the first nonempty message, error or reason. Preserve the original
   event, stable IDs, excerpt budgets and historical scope. Do not relax chat
   validation or classify rejected chat as an actionable software failure.
3. Run the focused supervisor regressions and repository checks. Append the
   maintenance ledger and commit only the related files to the user's fork.
4. Reload only the owned DSH monitoring process through its existing launcher
   if its replacement is ready. Replay the actual archived receipt through the
   deployed projection to verify its reason; this replay makes no model call or
   game action. Keep prepared/deployed/verified and ticket writeback separate.

This corrects diagnostic evidence only. Physical escape, tool replenishment,
completed trade and the separate voice-end watchdog remain unverified.
