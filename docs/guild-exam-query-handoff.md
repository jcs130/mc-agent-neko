# Guild exam discovery and the idle execution handoff

On 2026-10-12 at 17:04–17:12 Beijing time, ag_NEKO remained authenticated,
healthy and physically idle while repeatedly reading guild exam status and
catalogues. The actual list/info receipts incorrectly reported `readOnly:false`.
The existing Neko host uses that metadata to distinguish query-only decisions
from actions: one such receipt removed the final execution opportunity and
fell back to a text-only request at the three-round tool cap.

The native bridge now classifies exactly `guild exam list` and
`guild exam info <ID>` as discovery. The original server replies and parsed
records remain whole. This changes receipt metadata only; it grants no new
serverQuery permissions, sends no extra commands, changes no user authority,
and adds no inference rounds. Start, submit, retry, cancel, extra arguments and
the unsupported `guild exam explain` form remain outside this classification.

Three focused regressions initially reproduced two failed query classifications.
After the one-line production change, all 52 command, protection and login
regressions passed. The existing host terminal-handoff regressions also passed
(14 cases), including busy/stopped state, unknown commands, explicit wait, and
asynchronous task ownership. Syntax checks and test-file ESLint passed. Source
ESLint retains its pre-existing control-character-regex finding at line 13;
the same finding was reproduced against the unchanged HEAD source.

Deployment and natural recovery are separate from those checks. Record the
measured safe boundary, exact file hash, protected process identities and fresh
runtime receipts before reporting deployment; report verified only after an
actual query-only decision reaches a task or documented gameplay action.
The broad autonomy incident remains open until its own acceptance evidence.

The server's inventory exam description says `list/explain/status`, but the
actual `explain inventory_basic` response advertises `info <ID>`. This is an
observed guidance mismatch, not a confirmed server outage. The maintainer's
forwardable report should request consistent syntax and explicit missing proof
states without inventing exam completion or removing real passage requirements.
