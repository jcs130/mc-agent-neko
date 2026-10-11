# Regression Report: repeated presentation headers entering speech

## Evidence and cause

On 2026-10-11 at 22:44:55 and 22:50:11 Beijing time, two stored proactive replies
contained a complete reserved `neko_emotion` header inside normal dialogue,
at character offsets 107 and 39. Both headers contained a voice description.
The active local VoxCPM2 configuration already disabled styled speech prefixes.
Diagnostics retain timestamps, offsets, lengths and hashes, never reply bodies,
voice IDs, prompts or credentials.

The original `JointReplyFilter` recognized only the first header. A repeated
header therefore reached callbacks, history and TTS. The Markdown speech
stripper can remove its bracket shell while retaining the words, so the
later bracket stripper cannot reliably protect it. Separately, an overlong
unclosed leading header previously emitted its suffix after 80 characters.

## Change and compatibility

Only a leading header sets emotion and voice metadata. Reserved headers in
the rest of the assistant output are now removed before callbacks, history,
subtitles and TTS. A split opener is held across chunks; an identified header
is discarded through its closing bracket without accumulating its body.
Truncated controls are not flushed as speech. Reset retires this state.

Ordinary brackets, near matches, dialogue about tone, multilingual text and
native tool arguments remain intact. This is a reserved output protocol filter,
not an input/chat filter or general dialogue deduplicator. It adds no model call,
does not trim game context, and does not enable unverified VoxCPM2 style prefixes.
Literal examples using this reserved protocol in an assistant reply are now
private too; the earlier claim that such examples remain visible is superseded.

## Verification and limits

Eight parser regressions failed before the fix; the initial repaired parser
and private-control suite passed 37 tests. The final related speech, local
provider, cancellation and text-stripper suite passed 371 tests; proactive
Phase 2 and ownership guards passed 81 tests. Counts overlap the focused suite.
Ruff and whitespace checks passed. Coverage includes every split point,
character-wise streams, repeated/invalid/overlong/unclosed headers, bounded
storage, preserved near matches, real offline ordinary/ephemeral callbacks and
history, and the native HTTP speech worker's exact clean input and receipt.

Runtime deployment and actual synthesis/playback evidence are recorded separately.
Tests alone do not establish subjective audio quality, eliminate unrelated
semantic repetition or prove productive autonomous gameplay.

## Local deployment follow-up (2026-10-11)

At 23:15 Beijing, the host loaded source `00ae06be6920` from companion fix
`e50c97174d5e`, after three quiet playback/inference samples while the game was
offline. The native game, RTX 3090 model/vision, local TTS unit and spectator
process identities were retained. The authenticated room listener was restored
through its regular API, without sending a message or creating a login QR.

One isolated real VoxCPM2 synthesis produced 2.56 seconds of 48 kHz PCM. CPU ASR
confirmed the expected content and no private voice description; the actual HTTP
input exactly matched the cleaned dialogue. It was not injected into the game,
desktop or broadcast. The following four natural replies had no reserved header,
English-only output or exact duplicate, with four synthesis/start/end cycles and
no duplicate or early end receipt. These are limited samples, not a subjective
voice-quality or universal repetition claim. T-0071 has a confirmed deployed
receipt; future natural malformed-header handling and human listening stay open.
