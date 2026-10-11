# Idle session reset and local speech plan

**Goal:** Prevent user-silence maintenance from cutting ongoing local speech after the LLM has finished. Keep the existing inactivity threshold and bounded missing-playback-end recovery.

**Evidence:** On 2026-10-11 at Beijing 21:07:54, `idle_session_reset` logged 1848 seconds of user silence and immediately cancelled `tts_response_handler`. The current speech had started at 21:07:48; its synthesis/playback had not finished. Task/speech repetition is a separate unresolved acceptance issue.

**Implementation:** In N.E.K.O. `main_logic/core/lifecycle.py`, reuse the existing `_is_voice_playing()` gate after checking model reply work. Extend `tests/unit/test_offline_reply_work_gates.py` with real gate behavior for ordinary active playback, a long local audio tail and a stale flag. Package the source commit through the existing companion manifest and full patch replay.

- [x] Record T-0069 actual occurrences=1 before the lifecycle change.
- [x] Reproduce three failing idle-loop cases; do not use extra inference or synthesized test speech.
- [x] Add the existing bounded playback gate; retain user-stop, takeover, generation and session ownership behavior.
- [x] Run relevant speech, lifecycle and proactive regressions: 173 pass, including the 17-case direct gate suite (counts overlap).
- [x] Commit the source, export companion host patch 0024 and replay all 96 patches; plugin tree and 59 host source/test files match.
- [ ] Publish repair documentation and fork commit; use a prepared receipt until the host is actually reloaded.
- [ ] Reload only at the existing measured safe game and playback boundary. If no safe boundary is available, preserve services and retain prepared status.
- [ ] Observe a natural inactivity-cleanup boundary before claiming runtime verification. Short speech samples cannot prove this periodic fault fixed in production.

No model/provider/voice changes, text muting, invented user activity or increased LLM calls. Raw dialogue, PCM, private voice identifiers and credentials remain out of diagnostics and the repository.
