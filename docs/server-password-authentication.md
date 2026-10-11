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
