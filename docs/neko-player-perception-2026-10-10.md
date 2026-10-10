# Player perception and avatar emotion recovery

## Evidence and scope

The user's audit covered player greetings, mentions in chat channels, system notices/errors, dropped equipment and gifts. The existing coordinate narration policy only changed speech instructions; it did not remove raw coordinates, player names or game messages.

A passive 32-second observation on 2026-10-10 received 13 live snapshots, 18 system messages, 10 window events and one plugin message. HP/food were 20/20. There were two listed accounts and no nearby player or gift event during that sample. The server's guild instructions and command error were received; command replies were marked solicited. This sample cannot establish real-player greeting/gift behavior.

Offline replay demonstrated three defects in the native observer: a nonstandard chat message lacked a resolved player, a dropped item's decoded identity was absent, and pickup events were absent. Plugin replay demonstrated that distinct player batches shared a replaceable host queue key, and nonurgent independent feedback disappeared from attention during long actions. Avatar logs independently showed local emotion requests rejected after a backend restart because the desktop retained an expired CSRF token.

## Changes

- The native observer resolves a raw chat sender by received UUID, or conservatively by a leading delimited online account after up to three channel tags. It preserves the original text, position and resolution method. Unknown formats stay observable; heuristic parsing never creates admin commands or authority. Existing parsed greetings/whispers and command routing remain separate.
- Nearby item drops expose decoded base/custom names, stack count and readable lore. Collection packets expose the actual pickup count, collector, whether the action player collected it, and observed nearby accounts. Donor remains explicitly unknown: proximity is not attribution, and a collection event is not proof of the resulting inventory count.
- The plugin retains ordinary conversation and nonurgent independent system feedback during work, bounded to 32 events/5 minutes. Full bounded deferred evidence remains queryable. Directed chat and whispers request social judgment without replacing the current physical task. Distinct attention batches have independent queue keys. Ordinary state notifications still coalesce; no periodic polling/model call was added.
- Attention cues now expire after five minutes rather than 45 seconds, matching long game actions. Complete conversation text is retained for five minutes and protected against ambient event pressure in the bounded cache; explicit full queries can retrieve it. Routine decision projections keep their existing two-minute event window instead of repeatedly injecting old greetings. Additional replay first reproduced both the short expiry and lost full text.
- Ordinary mining drops/pickups stay passive. Own collection with nearby players becomes social information at idle. Social context prioritizes visible players and decoded drops, includes received equipment, and does not invent the giver. Small projections remain bounded and full observations remain available.
- The desktop emotion request refreshes its local token and retries once only for `csrf_validation_failed`. Provider failures and repeated validation failures do not loop. Backend CSRF/Origin checks remain intact. This is an independent host companion patch, not a Minecraft-plugin modification.

## Service routes checked

The main dialog, game brain, summaries, emotion/correction/vision and native chat/code/vision profiles point to `http://127.0.0.1:18030/v1`, model `qwen3.8-flash-next-iq3_xxs`. Strata reports the model loaded with vision available, single inference concurrency, using the existing RTX 3090 deployment. Native chat/vision use `none`; code uses `low` with a 512-token reasoning budget. The monitor uses online `deepseek-flash` at `https://api.deepseek.com/v1`, independently of the local game model. TTS logs select Lanlan free online streaming; the client does not expose the exact upstream voice model version. The avatar is the local YUI Live2D asset; emotion classification selects existing reactions, and lip sync follows audio.

## Validation and limits

Native observation replay: 24 passing tests, including the three previously failing cases. Native complete suite: 598 passing tests. Plugin perception replay covers greetings/mentions/whispers, distinct queue keys, delayed errors, pickup facts, passive mining, equipment visibility, full deferred text and callback ceilings. Emotion frontend tests cover refresh success, one retry only, and no retry for unrelated errors.

Final verification: 216 plugin tests, including 9 perception cases; 651 fork tests; 3 emotion frontend tests; Ruff and diff checks passed. The complete bundle replays 65 plugin patches and 5 host patches to the declared plugin tree and all 16 affected host blobs. Additional backend pytest tests were not run because this deployment environment has no pytest installed; the existing server validator was not changed.

Runtime: native commit `d2f1187197d7679cf26552b14834646e53629533` loaded through the official lifecycle at 20:56 Beijing time. Fresh post-reconnect status confirmed HP/food 20/20 and 8 received welcome messages/8 context parts. Main service and the then-current model generation were preserved during deployment. The model had independently reloaded earlier at 20:40–20:44; this audit did not restart it or change its deployment configuration. Configuration SHA-256 remained `CA7D5103F05DDCC21DD762311922C63B52C5438DF4EFBC227E0F636CDAEF6805`, selecting GPU 0 for text and vision.

The current emotion route accepted a fresh, correctly named CSRF header and returned its neutral empty-text response; the patched frontend asset is served. This probe sends no LLM request. One earlier diagnostic probe used the wrong header name and was correctly rejected; its unsuccessful result is retained separately from the successful proof.

The desktop alone was refreshed at 21:08 Beijing time through its existing launcher. Its backend connection became ready; main, model and native game process identities were preserved. A separate classifier-only request at 21:13 returned `happy`, confidence 0.95, in 1585 ms using the configured local model. This is one functional sample, not a quality or latency benchmark. No audible speech or rendered expression was inspected.

The initial plugin attention/deferred-feedback changes loaded with the native deployment. The additional five-minute queue/full-chat retention patch (`2427fbd`) is **prepared, not deployed**: sampled boundaries through 21:16 still had a pending physical task, and a fresh status at approximately 21:23 was online with HP 19, food 17 and a pending task. No task was cancelled to reload it. The next maintenance deployment must recheck the current source and stopped/unattended flag, then use the official plugin-only reload at an actual safe idle boundary. Until then, the live queue still has the previous expiry settings.

The final companion bundle replays 65 plugin and 5 host patches to the declared source. No real player messages, gifts or public test chat were injected. A matching offline replay proves the implemented path; actual server channel formats, receipt of a real gift, audible speech and rendered expression changes still require live observations.
