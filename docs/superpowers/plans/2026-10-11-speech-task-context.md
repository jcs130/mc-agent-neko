# Speech controls and autonomous task continuity

Execute sequentially in the current session under the user's repair authorization.
Preserve the native game, spectator, model/vision GPU and TTS voice ownership.

Evidence: private runtime/tts-context-20261011-1556. A 35-second continuous
observation showed no movement/action/inventory change. Current received tasks
repeat unmet merchant prerequisites. The local TTS adapter unconditionally adds
private voice descriptions to every input. Decision feedback clips task names,
keeps at most two short previous reasons, and removes that history under pressure.

- [ ] Reproduce private style text reaching synthesis; make raw style-prefix
  injection explicit opt-in, with a safe default. Preserve same-turn avatar
  emotion, cloned voice, clean receipts, interruption and online failover.
- [ ] Audit actual locale and anchor joint replies to the configured request
  locale while preserving exact tool/player identifiers. No translation call.
- [ ] Reproduce lost task predicates/received blockers across later decisions;
  preserve complete accepted goals and matched task IDs/results in a bounded,
  session-scoped ledger. Remove aggressive task/history character truncation;
  keep observation dedup, raw references and stop/busy protections.
- [ ] Run affected regressions, lint and complete Minecraft plugin tests;
  package companion patches and verify full replay plus hashes.
- [ ] Deploy through owned idle-boundary lifecycle only; observe actual speech
  payload/audio and natural task/receipt progress. Record failed acceptance as
  open, commit and push the user's fork, with a Regression Report.
