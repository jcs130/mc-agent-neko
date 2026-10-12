# Transfer and observation receipt repair

Two independent failures were observed in the local deployment on 2026-10-12.

- T-0086 baseline 2: successful backpack withdrawals were followed by repeated
  invalid source/count attempts without another window read. The transfer guard
  correctly refused them, but its success and failure replies did not include
  the updated source slot or remaining count.
- At 15:57:02 Beijing, a local Minecraft main-brain request with three observation
  replies exceeded 32K: 34,277 input + 320 maximum output. Metadata records tool
  bodies of 9,216, 8,923 and 52,742 characters. Earlier current-fact observation
  views were replayed in full alongside the later requested detail.

1. Preserve the actual occurrence baseline and immutable receipt references.
   Complete the due full health check without extra game, model or audio calls.
2. Add failing regressions for updated transfer-source feedback. Return the
   server-confirmed remaining source after success, and current source/count
   details on refusal. Keep transfer parameters, guards and confirmation intact.
3. Add failing regressions for an ephemeral local request view that replaces
   earlier archived current-fact observation replies with explicit snapshot
   indexes when another observation follows. Keep the latest observation,
   intentional exact detail reads, failed/unarchived results, human text and
   tool-call pairing unchanged. Saved histories and immutable facts stay whole.
4. Run focused and related regressions, lint and patch replay. Measure actual
   retained observation projections offline; do not submit synthetic inference.
5. Commit native code and export the matching host patch through the existing
   companion process. Deploy only through owned lifecycle at a safe boundary.
   Keep prepared if no safe boundary is available, and distinguish deployment
   from natural runtime acceptance in repair and maintenance receipts.

No model/GPU/thinking changes, increased decision frequency, arbitrary text cuts,
automatic source/count correction, or test messages to game/live are included.
