# Game information for the Neko dialog

The Minecraft connection has a dedicated observation stream independent of
browser visualization. It observes the action player's own Mineflayer bot and
never sends game actions, chat, a second login or model requests.

`game_state` snapshots arrive every 3 seconds and on explicit queries. They carry
the player, world/time/weather, inventory/equipment/durability/effects, nearby
entities and loaded block samples, open container/menu and item components,
scoreboards, Boss bars, tab list, titles/actionbar, server plugin channels,
advancement/recipe/trade feedback, server-declared command names/arguments,
player abilities and the body's current activity/mobility. Declared commands
are discovery data, not proof of this account's execution permission.

`game_events` batches arrive after 250 ms. Public/custom/NPC chat, whispers,
system/command feedback, titles/actionbar and lifecycle events have a stable ID,
channel/kind, source and observation time. Text is retained up to 8,192 characters
instead of using the viewer HUD's display truncation. Recent events also travel
in snapshots, so a delayed or coalesced batch can be recovered and deduplicated.

Send a read-only query:

```json
{"type":"query_game_state","schemaVersion":1}
```

The Neko plugin additionally declares `"conversationOwner":true` on its own
connection. Only that explicit declaration routes ordinary conversation and
whispers exclusively to the dialog LLM. The standalone body keeps its whisper
handler when no external conversation owner is connected. Existing `@neko`/`!`
commands keep their original validation and command route; observations never
create admin missions. A monitoring query does not claim conversation ownership.
Observation frames are excluded from the game's debug-chat mirror.

The Neko plugin retains these facts, injects passive context at most every 10
seconds, and includes current state/recent events in autonomous decisions.
Incoming conversation and relevant server feedback can request judgment, paced
at one cue per 5 seconds with duplicate suppression. State updates and changing
actionbar counters alone do not request speech. Pending attention events are
carried into the next cue rather than dropped by the cooldown.

`minecraft_observe(sections, max_events)` requests a fresh snapshot without
interrupting the action. It exposes bounded details for `self`, `world`,
`inventory`, `nearby`, `window`, `activity`, `server` and `coverage`. In particular,
`window` and `inventory` extract readable book pages and item lore before
retaining bounded raw components/NBT, so deeply nested 1.20.6 text remains usable;
`server.channels` retains decodable JSON/text, including arbitrary server
namespaces such as `mcagent:state` and `mcagent:event`.

Facts older than 45 seconds, or an offline game connection, are not presented as
current state and stop autonomous scheduling. A new connection/session clears
old world context. Events have a 120-second retention window. Snapshots and
buffers are bounded: 32 nearby entities within 32 blocks, loaded block samples
within 4 blocks, 128 retained events, 48 snapshot events and 16 plugin channels.
Each state section has its own capacity. Server command names, scoreboards and
Tab hints precede bulky advancement display data. Truncation paths,
omitted-entity counts and event-buffer overflow are explicit.
Unknown binary plugin payloads expose channel, length and hash with an unavailable
decoded value. Unreceived server state and unloaded terrain remain unknown.

Routine context summarizes large item/terrain data; the observe tool supports
selecting a section for detail. The Neko host caps each callback at 1,000 tokens,
so its plugin renders a valid summary within 700 tokens and directs the model
to the full observation tool before decisions needing omitted facts. The cache
and tool retain full bounded message/book content. Item text can describe older
status; live entity/world fields take precedence for vitals, location and time.
Game/player/NPC text remains external data with
no instruction privilege. To send a reply into the game, the dialog must use
`minecraft_chat`; speaking or replying in the web UI does not send Minecraft chat.

When an external client owns conversation, `Agent.openChat` retains body tool
calls and action narration in local output/WS frames and never publishes them
to public chat or automatic whisper recipients. `chat_ingame=false` additionally
disables that automatic output when the external client is disconnected. This
setting does not disable deliberate `minecraft_chat` communication. Standalone
automatic conversation excludes the command suffix. Debug chat, status mirrors
and mission banners require explicit `DEBUG_CHAT=1`; the default is off.

The explicit chat bridge accepts genuine plain player conversation and rejects
tool-call syntax/raw diagnostic records. Optional `player` selects a real online
recipient for a whisper; unavailable/self recipients fail without public
fallback. The existing two-second send interval remains, and identical text to
the same channel/recipient has a sixty-second duplicate cooldown. Neko receives
the same communication policy in decision/attention prompts: keep plans and
progress local, use public chat for useful player communication, and prefer
private messages for individual contact, including politely initiating it.

Servers implementing `MC_PROTECTION` can enable `server_protection: "mycli"`
in the MC settings. A real server advertisement of `/mycli protect` also enables
the adapter. Every actual dig, including path excavation and local scripts,
privately queries `/mycli protect break <x> <y> <z>` before starting. Unknown or
mismatched replies do not authorize a dig. `allow_likely` remains tentative:
an actual subsequent server rejection cancels the attempt and supersedes it.
Exact action/world/coordinate denials are cached for five minutes, allowed
preflights for three seconds, and unknown results for 1.5 seconds; disconnect
and respawn clear them. Protected wood columns are excluded from wood selection,
and known denied blocks are excluded from destructive path planning.

`server.protection` exposes installed/enabled state, last check, last blocked
action, and up to eight denied targets with an omitted count. A blocked action
also emits a `protection` event carrying coordinates and the reason. Neko retains
the check entry and last blocked target even when reducing context to 400 tokens.
Ordinary permission command replies remain observations without another model
wake-up. The adapter automatically guards digging; placement, container and use
checks are available through `!serverQuery` / `minecraft_server` but do not yet
wrap their respective Mineflayer operations. Servers without this protocol keep
their existing behavior.

Validation (no live game/model required):

```sh
node --test test/game_information.test.mjs test/ingame_chat_routing.test.mjs test/chat_bridge.test.mjs test/reconnect-lifecycle.test.mjs test/self_prompt_lifecycle.test.mjs
```
