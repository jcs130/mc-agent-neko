# Private server password authentication

The Java 1.20.6 gateway can accept the offline account connection while withholding
world spawn until `/login` succeeds. On 2026-10-11 the running ag_NEKO connection
received `请先 /login 密码 … [MC_AUTH_DENIED]`, then reached its existing world
position after an operator-authorized login. Protocol login, a listening control
socket and a generic keepalive timeout had not established that world access was
available. The earlier maintenance reply and later authentication requirement are
separate observations; this does not establish that all previous failures had the
same cause.

`src/utils/server_auth.js` installs before spawn in `initBot`. It recognizes the
observed system challenge and sends only `/login` on that same bot connection.
Player messages, public lines containing the marker, disabled configuration and
mismatched server/account bindings cannot trigger it. It does not register new
accounts, change passwords, run arbitrary commands or ask an LLM for credentials.
The explicit local `serverLogin` skill permits one operator-triggered attempt on
an already-connected authentication lobby, with no password arguments.

Store credentials outside version control in `bots/_supervisor/server-auth.json`,
which is ignored by the repository. An operator may instead supply an absolute
`MC_SERVER_AUTH_FILE` path. The JSON fields are `enabled`, `host`, numeric `port`,
`username` and `password`. The host, port and account must exactly match the bot's
connection (host comparison is case insensitive). No private configuration,
password, complete login command or exception body belongs in commits, model
context, task text or diagnostic logs. Logs and operator results contain only
authentication status and confirmation flags. Keep the private file restricted
to the local account that runs the bot.

One connection submits at most once. Unconfirmed attempts share a limit of three
per five minutes in the process. An explicit wrong-password response blocks that
credential across reconnects; an operator must correct the private configuration.
Changing the credential clears that block. A server success reply and a world
spawn after submission are recorded separately. A spawn alone is not represented
as an explicit authentication acknowledgment. End/kick retires this adapter's
listeners without removing other consumers.

This is a targeted adapter for the observed gateway, not a general AuthMe prompt
parser. It leaves normal game chat, welcome instructions, permissions, action
ownership, model routing and viewer behavior intact. Local Qwen and vision keep
their existing RTX 3090 settings; authentication adds no model calls.

Validation: 11 isolated authentication regressions and 8 existing chat regressions
passed, together with syntax and whitespace checks. A real one-time attempt at
21:57 Beijing entered the world on the existing native process, restored full
health/hunger and received the skill catalogue, mana and welcome instructions.
The returned `submitted` status was not used as the success criterion. Runtime
proof and private configuration remain outside this repository. Automatic
reconnect acceptance and viewer streaming are checked separately during deployment.

Follow-up: a 45-second passive observation through both LAN Socket.IO paths
received 406–407 avatar frames per path, 81 chunks, 89 minimaps with 625 cells,
mana 28/28 and nine ability entries, with no stream errors. A natural quest task
was subsequently pending and physical activity resumed. That does not establish
quest completion, appropriate planning or a resolution of earlier repetition.
The current process received the one-time adapter through the hot skill; the
startup hook is prepared in the native checkout but awaits an idle loading
boundary. No main service, game process, model, TTS or observer was restarted to
force a reconnect test. The next maintainer must distinguish prepared startup
code from the already successful one-time login.

## Gateway prompt compatibility follow-up (2026-10-11)

At 22:31–22:32 Beijing, the spectator log recorded the gateway's current
`[MC_AUTH_LOGIN] 请先登录：/login …` challenge, followed by
`[MC_AUTH_PASSWORD_OK]` and `[MC_AUTH_SUCCESS] 登录成功…`. The previous adapter
recognized only the older trailing `MC_AUTH_DENIED/REQUIRED` challenge and
`MC_AUTH_OK` success. A reconnect could therefore remain in the authentication
lobby even with a correct private password. A generic spawn timeout does not
establish a network or backend outage.

The adapter now accepts the observed anchored system challenge and final success
format. Password acceptance alone does not claim full authentication or world
spawn. System channel, absent sender, exact account/server binding, private
credentials and the once-per-connection/process retry budget remain enforced.
There is no unconditional password send on connect, account registration or
two-factor bypass. Fourteen authentication regressions pass, including automatic
challenge handling on a replacement connection and rejection of forged public
prompts; two of the new assertions failed against the earlier adapter.

The earlier startup hook was loaded into the owned native child at 23:07, while
the game was offline and no task was active. The changed prompt adapter is a
subsequent repair; its deployment and actual world entry are recorded separately.

## Current-prompt deployment result

At 23:28 Beijing, only the owned native child loaded `ff9549e83269` (fork code
`976cd1aa4bad`) through the existing MindServer restart route, after three
offline/no-task checks. Main/plugin, model/vision, local speech, monitor and
spectator identities were preserved. The adapter automatically submitted on the
real gateway challenge, recorded explicit `authenticated`, and reached world
spawn without a manually injected login command. A subsequent 45-second passive
native/LAN observation stayed online with full health and hunger, live avatar
and map streams. Login-time mana 28/28 and nine abilities were transported with
their original timestamp and a stale marker; this is not a fresh cooldown check.
Welcome instructions again reached the host context. No movement was observed
in this window, so productive gameplay is not claimed.

This verifies the repaired current gateway challenge and automatic world entry,
not every future outage or mission completion. The earlier 22:49 proxy closing
message and transient local socket errors retain their separate evidence; the
generic timeout had also hidden this client authentication incompatibility.
No current server fault is established and no owner intervention is required
for this recovered incident. Private credentials remain outside all artifacts.

## Login receipts in the main-brain context

At 23:29 Beijing on 2026-10-11, a generated reply said the password was missing
after the gateway had accepted the private automatic login. The observation
transport had no client authentication receipt. Mineflayer's generic `[name]`
chat parser also turned `MC_AUTH_SUCCESS` into an apparent player, and transient
login instructions were retained beside gameplay guides. This is a client
context defect; it does not demonstrate another server authentication failure.

`server.authentication` now exposes only the current adapter's status,
`submitted`, `serverConfirmed` and `worldSpawned`. A submission or spawn alone
does not imply confirmed login. The N.E.K.O. companion keeps these facts in every
focused context mode, including the 256-token fallback, and discards them when
the frame is stale or the connection changes. Authentication transitions update
one passive context slot; they do not add a model request. Passwords remain in
the private adapter and must never be requested, narrated or submitted by the
dialogue model.

Gateway controls retain their original event text and time for observation,
but are not durable gameplay guides or a reason to generate social replies.
Known online players, private messages, public messages quoting auth markers,
normal gameplay instructions, protection denials and errors keep their existing
delivery. Welcome references explicitly describe historical connection messages;
current authenticated receipts take precedence over an old login instruction.
This changes no heartbeat interval, model, thinking setting or gameplay policy.

The private YUI installation also used a default master display name and two
persona lines containing an unwanted mechanical form of address. Those three
configuration values were corrected locally, without committing personal
configuration, clearing history or changing the voice/avatar. Other installations
choose their own profile names.

Validation before deployment: the two new native reproductions fail on the old
source; the final native authentication/observation suite passes 44 cases. The
plugin suite passes 243 cases and 38 subtests, including authentication freshness,
tight budgets, passive transition deduplication and player/error delivery. Syntax,
Ruff and whitespace checks pass. Runtime deployment and fresh conversation
acceptance are recorded separately; these tests do not prove all repetition fixed.
