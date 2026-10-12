import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTicket, auditDue } from '../services/dsh-supervisor/core.mjs';
import { ticketRevision, recordReviewed } from '../services/dsh-supervisor/scheduling.mjs';
import { runAuditStages } from '../services/dsh-supervisor/audit.mjs';

const NOW = 1791763928193;
const ticket = (id, at, extra = {}) => ({ id, status: 'open', occurrences: 1, severity: 'med',
    title: 'Actual failure', updatedAt: new Date(at).toISOString(), history: [],
    evidence: { snapshotAt: at, scope: 'execution', facts: [{ id: 'native.execution.' + id,
        observedAt: at, kind: 'execution', value: { type: 'task_finished', taskId: id,
            failures: [{ command: '!moveBackpackItem', causeId: 'same-refusal', reason: 'Window changed' }] } }] }, ...extra });

test('diagnosis comments do not change evidence revisions or wake another model audit', () => {
    const first = ticket('T-0001', NOW), comment = { ...first, updatedAt: new Date(NOW + 1000).toISOString(),
        history: [{ actor: 'dsh-diagnoser', note: 'same old hypothesis' }] };
    assert.equal(ticketRevision(first), ticketRevision(comment));
    const ledger = { baselineComplete: true, lastAuditAt: NOW, reviewedEvidence: { [first.id]: ticketRevision(first) } };
    assert.equal(selectTicket([comment], ledger, NOW + 301000), null);
    assert.equal(auditDue(ledger, [comment], NOW + 301000), false);
    assert.equal(auditDue(ledger, [comment], NOW + 901000), true);
});

test('fresh actionable failure precedes an old high-severity repeatedly updated detector', () => {
    const old = ticket('T-0001', NOW - 86400000, { severity: 'critical', occurrences: 600,
        updatedAt: new Date(NOW).toISOString() });
    const fresh = ticket('T-0002', NOW - 5000);
    assert.equal(selectTicket([old, fresh], { reviewedEvidence: {} }, NOW).id, fresh.id);
});

test('matching confirmed verification is quiet but a later real occurrence becomes eligible', () => {
    const old = ticket('T-0001', NOW - 5000);
    const repairs = [{ ticketId: old.id, ticketOccurrences: 1, recordedAt: NOW - 1000,
        phase: 'verified', verification: { passed: true, at: NOW - 1000 }, writeback: { state: 'written' } }];
    assert.equal(selectTicket([old], { reviewedEvidence: {} }, NOW, { receipts: repairs }), null);
    assert.equal(selectTicket([{ ...old, occurrences: 2 }], { reviewedEvidence: {} }, NOW, { receipts: repairs }).id, old.id);
});

test('aliases of a reviewed incident do not become a second independent diagnosis', () => {
    const a = ticket('T-0001', NOW - 3000), b = ticket('T-0002', NOW - 1000), ledger = { reviewedEvidence: {} };
    const selected = selectTicket([a, b], ledger, NOW);
    assert.deepEqual(selected._incidentGroup.ticketIds, [a.id, b.id]);
    recordReviewed(ledger, selected, 'new-comment-time', NOW);
    assert.equal(selectTicket([a, b], ledger, NOW + 301000), null);
    const recurrent = { ...b, occurrences: 2 };
    assert.ok(selectTicket([a, recurrent], ledger, NOW + 301000));
});

test('healthy steady-state audit uses one observer and no diagnostic or review calls', async () => {
    const roles = [];
    const result = await runAuditStages({ now: () => NOW, ledger: { baselineComplete: true, reviewedEvidence: {} }, tickets: [],
        capture: () => ({ sessionId: 'live', fresh: true, observedAt: NOW, facts: [], executionRevision: null }),
        runRole: async (role, prepare) => { roles.push(role); const prompt = prepare();
            return { report: { summary: 'No new evidence', issues: [] }, evidence: prompt.evidence }; } });
    assert.deepEqual(roles, ['observer']);
    assert.equal(result.diagnoser, null);
    assert.equal(result.reviewer, null);
});
