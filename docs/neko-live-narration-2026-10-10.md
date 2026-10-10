# Natural game narration without coordinate readouts

The user's live narration repeatedly exposed numeric positions. Game facts need
exact coordinates for navigation; spoken commentary usually benefits from a
known landmark or relative direction instead.

The N.E.K.O. companion plugin now adds localized position wording to the existing
responding-cue speech policy. It asks the main model to avoid coordinate readouts
unless the user explicitly requests them, and to avoid inventing landmarks or
directions. Chinese speech still translates item, skill, status and error names.
Other locales keep their language choice. Passive facts, player names, quantities,
server replies, task evidence, navigation parameters and viewer data are unchanged.

This is a model expression instruction for game narration, including when its
response is spoken during a stream. It does not strip numbers from TTS, generate
a second translation request, add periodic inference or alter the native executor.
It cannot guarantee perfect compliance by every model response.

For an installed NEKO Live deployment, append the same preference to its existing
`stream_avoid_topics` through the supported `update_config` entry. Preserve other
preferences. One suitable Chinese preference is:

> 口播不念游戏坐标、X/Y/Z或三轴数字，用实际已知的地标和自然方位描述位置，不编造地标；精确坐标留在导航工具参数，只有用户明确要求位置数字时才读。

No installed Live plugin source or private runtime configuration is bundled.
This preference does not itself enable a stream or send a room message.

## Verification

- N.E.K.O. source: `941f6ec26c6975707c1e12400fd7b528863b1d97`.
- Full Minecraft plugin suite: 207 tests passed. Focused speech/query regressions:
  15 passed; Ruff and `git diff --check` passed.
- Tests preserve raw coordinates in passive facts and execution text, keep the
  speech policy on responding cues only, and exercise idle, completion and player
  reply budget accounting. All eight supported locales receive localized guidance.
- The first, verbose policy caused the existing crowded idle-cue regression to
  reach 1,006 tokens. Compact wording, including removal of redundant translation
  examples, brought the measured Chinese callback to 948 tokens. The Chinese
  speech policy itself changed from 69 to 71 tokens. The existing context allocator
  and fact retention order were not changed to make the test pass.
- A read-only offline projection of that crowded fixture across all locales
  measured 948/961/891/908/899/905/886/889 tokens for
  zh/zh-TW/en/ja/ko/ru/es/pt respectively, below the host's 1,000-token cap. These
  are fixture measurements, not a bound on arbitrary future input or latency.
- All 63 plugin patches and three host patches replayed from the declared base;
  the resulting plugin tree and all 14 affected host-file blobs match source.

The live preference was confirmed by the official configuration API. The room
was offline during inspection, so actual audience interaction and audible
coordinate avoidance have not been established by a broadcast test. Deployment
and natural policy-forwarding evidence are recorded in the local inspection log;
no test game task, public chat or Bilibili message was sent.

At 20:16:36 Beijing time, the Minecraft plugin was reloaded at a fresh idle
boundary. The native game, main Neko process and local model generation were
preserved. Its reconnected state was fresh, and a natural priority-3 game cue at
20:17:27 forwarded the new position policy to the main model. This confirms
delivery of the rule, rather than audible or long-run output compliance.
