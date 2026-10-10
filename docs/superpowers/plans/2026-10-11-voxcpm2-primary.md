# VoxCPM2 primary local speech Implementation Plan

**Goal:** Use the authorized current online YUI voice as the reference for persistent local VoxCPM2 speech, retaining online speech as failover.

**Architecture:** Add a disabled-by-default, exact-voice local route around the existing TTS resolver. Reuse the native HTTP sentence worker, exclusion/replay ledger and cancellation ownership. Keep the tested Omni/model versions and isolated 3080 Ti environment, with a bounded persistent systemd unit and the existing Windows WSL keeper pattern.

**Tech Stack:** Neko Python 3.11; WSL Python 3.12 / vLLM-Omni 0.30.0 / VoxCPM2; HTTP PCM 48 kHz; PowerShell lifecycle.

**Spec:** User request in this chat, 2026-10-11: promote VoxCPM2 to main local TTS using the current online Neko voice.

**Accepted steering:** Also include VoxCPM2 tone descriptions. Extend the existing joint reply header; carry per-speech metadata through readiness buffering, add the documented parenthesized prefix only at the HTTP boundary, and preserve clean sentence receipts and online replay. No extra model generation.

## Global constraints

- GPU 3080 Ti for TTS, 3090 inference unchanged. Do not keep IndexTTS and VoxCPM2 resident together on the 12 GB card.
- Voice matching must be exact. Preserve other voices, explicit providers, TTS disablement and the original online voice identity.
- References, voice IDs, transcripts, credentials and real dialogue remain private. Record metadata only in public evidence.
- Streaming requests use `stream=true`, `stream_format=audio`, `response_format=pcm`; decode native 48000 Hz, without a sample-rate override or `ref_text` mode switching.
- User has authorized implementation and deployment in this session. Execute natively, preserve unrelated files, export host changes to the existing fork companion bundle.

## Review focus

1. An invalid/remote URL or a different voice must not select the local route.
2. A failed local request must not loop back to the same local provider.
3. Partial speech must obey the native safe replay ledger, not repeat already spoken prefixes.
4. Interrupted/retired requests must not emit stale audio into the next turn.
5. Repeated startup and a stopped unattended state must not create duplicate models or restart the game.

### Task 1: local route

- [x] Add `tests/unit/test_local_voxcpm_primary.py`: exact voice, opt-in, URL/model validation, disabled/silent and explicit-provider behavior, streaming/48 kHz/no credential forwarding, exclusion and runtime replay.
- [x] Run `python -m pytest tests/unit/test_local_voxcpm_primary.py -q` and confirm the missing route fails, then add `main_logic/tts_client/local_primary.py` and call it after the existing backup resolver in `__init__.py`.
- [x] Register the runtime-only provider using existing HTTP sentence metadata; keep provider UI and all general defaults unchanged. Run targeted routing/runtime/normal speech tests and Ruff. Add the required host Regression Report.

### Task 2: persistent service

- [x] Add `services/local-voxcpm2/configure-service.py`, `config.example.json`, `local_tts_primary.example.json` and `ensure-trial-local.ps1`. Extend the existing owned WSL launcher only with explicit backend/unit/model selection; legacy IndexTTS configs retain their defaults.
- [x] Validate paths, GPU UUID, unit ownership and launch limits. Reuse the prepared environment/profile, never reinstall or upgrade it during deployment.
- [x] Verify PowerShell/shell syntax and generated unit/run content, then update the private trial wrapper to the local-engine selector. Disable automatic Index residency before its owned stop; online speech continues during Vox loading.

### Task 3: reference, deployment and evidence

- [x] Match the private reference provenance to the current YUI online voice. Warm the registered reference-only speaker and test real streamed PCM, native worker sentence delivery, interruption and isolated failover without desktop/game test speech.
- [x] Export the committed Neko change as the next ordered host patch; checksum and replay the complete bundle. Commit public configuration/docs/evidence, push only the user fork.
- [x] Switch the private per-voice route and reload the owned Neko host at a speech/task boundary. Verify fresh game state, preserved native/model identities, desktop readiness and natural VoxCPM2 requests.
- [x] Save private runtime proof and append a scoped maintenance entry. Distinguish warm backend latency, native pipeline timing, human voice assessment and any remaining limitations.

