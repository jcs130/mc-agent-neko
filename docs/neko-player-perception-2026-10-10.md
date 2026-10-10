# Player perception and avatar emotion recovery

## Evidence and scope

The user's audit covered player greetings, mentions in chat channels, system notices/errors, dropped equipment and gifts. The existing coordinate narration policy only changed speech instructions; it did not remove raw coordinates, player names or game messages.

A passive 32-second observation on 2026-10-10 received 13 live snapshots, 18 system messages, 10 window events and one plugin message. HP/food were 20/20. There were two listed accounts and no nearby player or gift event during that sample. The server's guild instructions and command error were received; command replies were marked solicited. This sample cannot establish real-player greeting/gift behavior.

Offline replay demonstrated three defects in the native observer: a nonstandard chat message lacked a resolved player, a dropped item's decoded identity was absent, and pickup events were absent. Plugin replay demonstrated that distinct player batches shared a replaceable host queue key, and nonurgent independent feedback disappeared from attention during long actions. Avatar logs independently showed local emotion requests rejected after a backend restart because the desktop retained an expired CSRF token.

## Changes

- The native observer resolves a raw chat sender by received UUID, or conservatively by a leading delimited online account after up to three channel tags. It preserves the original text, position and resolution method. Unknown formats stay observable; heuristic parsing never creates admin commands or authority. Existing parsed greetings/whispers and command routing remain separate.
- Nearby item drops expose decoded base/custom names, stack count and readable lore. Collection packets expose the actual pickup count, collector, whether the action player collected it, and observed nearby accounts. Donor remains explicitly unknown: proximity is not attribution, and a collection event is not proof of the resulting inventory count.
- The plugin retains ordinary conversation and nonurgent independent system feedback during work, bounded to 32 events/5 minutes. Full bounded deferred evidence remains queryable. Directed chat and whispers request social judgment without replacing the current physical task. Distinct attention batches have independent queue keys. Ordinary state notifications still coalesce; no periodic polling/model call was added.
- Ordinary mining drops/pickups stay passive. Own collection with nearby players becomes social information at idle. Social context prioritizes visible players and decoded drops, includes received equipment, and does not invent the giver. Small projections remain bounded and full observations remain available.
- The desktop emotion request refreshes its local token and retries once only for `csrf_validation_failed`. Provider failures and repeated validation failures do not loop. Backend CSRF/Origin checks remain intact. This is an independent host companion patch, not a Minecraft-plugin modification.

## Service routes checked

The main dialog, game brain, summaries, emotion/correction/vision and native chat/code/vision profiles point to `http://127.0.0.1:18030/v1`, model `qwen3.8-flash-next-iq3_xxs`. Strata reports the model loaded with vision available, single inference concurrency, using the existing RTX 3090 deployment. Native chat/vision use `none`; code uses `low` with a 512-token reasoning budget. The monitor uses online `deepseek-flash` at `https://api.deepseek.com/v1`, independently of the local game model. TTS logs select Lanlan free online streaming; the client does not expose the exact upstream voice model version. The avatar is the local YUI Live2D asset; emotion classification selects existing reactions, and lip sync follows audio.

## Validation and limits

Native observation replay: 24 passing tests, including the three previously failing cases. Native complete suite: 598 passing tests. Plugin perception replay covers greetings/mentions/whispers, distinct queue keys, delayed errors, pickup facts, passive mining, equipment visibility, full deferred text and callback ceilings. Emotion frontend tests cover refresh success, one retry only, and no retry for unrelated errors.

Deployment and full companion replay results are recorded below after verification. No real player messages, gifts or public test chat were injected. A matching offline replay proves the implemented path; actual server channel formats, receipt of a real gift, audible speech and rendered expression changes still require live observations.
