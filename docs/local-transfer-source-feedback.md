# Current source feedback after a server-confirmed backpack transfer

On 2026-10-12 the supervisor retained two distinct task failures under T-0086.
The latest task repeatedly requested a source slot/count that no longer matched
the open window and stopped after five identical failures. Server-confirmed
withdrawals had changed or emptied the source, but successful replies did not
report the remaining stack. Refusals also lacked current slot/count feedback.
This is execution feedback evidence, not a server fault or a claim that the
inventory safety checks should be removed.

Successful `moveBackpackItem` replies now report the source from the confirmed
server slot array: remaining item/count or empty. An invalid source/count still
refuses the transfer, reports the observed window/slot/stack and requested count,
and points to `!window` for a fresh choice. No count is silently clamped, no
alternative slot is selected, and existing window/cursor/confirmation protections
remain intact.

Three regressions first failed on the missing feedback. They now pass together
with 52 related portable storage, inventory and container checks (55 total).
The new test passes ESLint; source syntax and whitespace checks pass. The two
source `require-await` lint findings in the existing open functions were
reproduced on the baseline and are unchanged.

Host companion patch 0036 separately indexes older archived game observations
in opted-in local requests. The newest complete facts and explicit detail reads
remain whole, and all original evidence remains queryable. Offline paired
tokenization of the retained overflowing request's earlier tool views saves
2,238 tokens, estimating 32,039 input plus 320 output within the 32,768 capacity.
It is not a complete HTTP replay or a guarantee for arbitrary large detail reads.
See its bundled regression report for compatibility and baseline test failures.

Deployment and natural acceptance are recorded in maintenance receipts. A reload
proves the code was loaded, not that the agent has subsequently used a changed
slot correctly. Keep T-0086 open until actual natural transfer evidence is
available; unrelated autonomous progress and speech issues remain independent.
