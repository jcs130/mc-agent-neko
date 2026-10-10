# Running retreat must yield when recovery owns the next move

The 06:18 Beijing inspection found repeated `goToSurface` requests interrupted by
`mode:self_preservation`, a descent from y39 to y29, and a fresh 60-second passive
window with no displacement, full health/food, and the retreat mode owning the
body. This is evidence of failed recovery, not proof of a server fault. Current
geometry alternates between a pocket and a local exit; no teleport or forced
game action is part of this repair.

The existing `shouldFlee()` and combat entry predicates already yield for a
fresh unreachable, non-damaging boxed threat. `bunkerDown()` can continue its
failed-seal kiting loop until dawn without checking that predicate again, so an
already running reflex can retain the body after the next observation satisfies
the handoff condition. Its emergency digging entry also lacks that check.

Plan and acceptance:

1. Reproduce both entry and in-loop handoff through the actual production bunker
   handler, retaining controls for real damage, close creepers, stale evidence,
   fresh open geometry, and explicit stop.
2. Reuse the existing unreachable-threat predicate before digging and during
   failed-seal kiting; require four seconds without damage and no creeper within
   eight blocks. Exit normally, preserving cancellation and the real sealed hold.
3. Run focused ownership/combat/filler regressions and the complete repository
   suite. Preserve unrelated runtime changes and append the supervisor ledger.
4. Commit to the existing contribution fork. Deploy only the owned native child
   at a full-health, physically safe daytime idle boundary; otherwise record
   `prepared`. Preserve the main brain, model, TTS and monitor processes.
5. Record the original ticket occurrence baseline and actual deployment/observed
   effects. A bounded return, a passing test, or movement alone does not verify
   tool replenishment, productive survival, trade, or the whole shelter ticket.

No change to model settings, decision frequency, context projection, normal
social chat, genuine sealed-night waiting, or server protection rules.

Validation before deployment: the new production-handler tests first had 5
passes and 2 failures. Related combat/ownership/filler tests now pass 60/60 in
both contribution and native checkouts. The complete contribution suite passes
725/725 with no skips; these counts overlap. Runtime state is prepared until an
actual safe owned-child reload is documented.
