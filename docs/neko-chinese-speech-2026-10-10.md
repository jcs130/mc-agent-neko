# Chinese names in Minecraft speech

The persisted YUI narration was Chinese but read raw identifiers aloud, including
`hay_block`, `raw_iron`, `balance`, `FREE` and quest/status fields. The user
confirmed that item and skill names were the main problem. The configured persona
and interface language were already Chinese.

The Minecraft plugin now places a short speech-language rule before responding
idle, player-message and action-completion cues. Items, skills, states and errors
are spoken in Chinese, preferring names actually supplied by the game/server.
`raw_iron` and `hay_block` use the vanilla names 粗铁 and 干草捆. Execution IDs,
commands, player names and received evidence keep their original spelling.
Passive observations and other interface languages are unchanged. There is no
extra translation model request or new timer. The rule is included in the
existing 1,000-token response budget rather than appended after truncation.

Verification: all 183 Minecraft plugin tests passed, including seven new cases
covering speech cues, raw IDs, non-Chinese locales, sender names and crowded
callback budgets. The 57 companion patches replay from the declared base to the
exact source plugin tree, with each patch hash verified.

A local Qwen text-only probe spoke 干草捆、粗铁、圆石、煤炭、铁镐、小麦 and
the supplied skill name 烈焰爆发 without Latin words (2.068 seconds). A separate
unexecuted tool declaration retained `item="iron_pickaxe"` (1.540 seconds).
These probes sent no live Minecraft action or chat.

The plugin reloaded at 02:31:22 on 2026-10-10 with no pending task or busy body.
A passive bus capture confirmed the rule in live social and idle cues and in the
main model's input. This verifies deployment and delivery. It does not establish
every future spoken name or audio pronunciation; no subsequent live item-name
utterance was captured in that observation window.
