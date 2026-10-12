import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentIdentity, groupIncidents, publishIncident, reconcileStateIncidents } from '../services/dsh-supervisor/incidents.mjs';

const NOW = 1791763928193;
const fact = (id = 'native.execution.1.a', reason = 'Window changed', task = 'task-a') => ({ id, sourceId: id,
    kind: 'execution', observedAt: NOW, value: { type: 'task_finished', taskId: task,
        failures: [{ command: '!moveBackpackItem', causeId: reason, reason, occurrences: 5 }] } });
const issue = (key, facts) => ({ key, title: key, detail: 'Observed repeated command refusal.', scope: 'execution',
    severity: 'high', evidenceIds: facts.map(f => f.id) });
const evidence = facts => ({ sessionId: 'live', observedAt: NOW, facts });
const state = (subject = 'own', at = NOW) => ({ id: `game.appearance@${at}`, sourceId: 'game.appearance',
    kind: 'observation', observedAt: at, value: { subject, playerName: 'ag_NEKO', available: false, reason: 'YSM_WORKER_STATE_UNAVAILABLE' } });

test('incident identity follows the observed cause rather than model key or task id', () => {
    const a = [fact()], b = [fact('native.execution.2.b', 'Window changed', 'task-b')];
    assert.equal(incidentIdentity(issue('executor_repeat_fail', a), evidence(a), 'ag_NEKO').key,
        incidentIdentity(issue('backpack-move-loop', b), evidence(b), 'ag_NEKO').key);
    assert.notEqual(incidentIdentity(issue('same-key', a), evidence(a), 'ag_NEKO').key,
        incidentIdentity(issue('same-key', [fact('other', 'No capacity')]), evidence([fact('other', 'No capacity')]), 'ag_NEKO').key);
    assert.notEqual(incidentIdentity(issue('same-key', a), evidence(a), 'ag_NEKO').key,
        incidentIdentity(issue('same-key', a), evidence(a), 'other-agent').key);
});

test('appearance identity includes subject and continuous state has one activation', async () => {
    const ledger = {}, tickets = []; let creates = 0;
    const create = async body => { creates++; const ticket = { id: 'T-0001', status: 'open', occurrences: creates,
        dedupKey: body.dedupKey, evidence: body.evidence }; tickets.splice(0, 1, ticket); return { ticket }; };
    const publish = at => {
        const f = [state('own', at)];
        return publishIncident({ issue: issue('model-key-' + at, f), evidence: evidence(f), tickets, ledger,
            subject: 'ag_NEKO', create, now: at });
    };
    await publish(NOW); await publish(NOW + 5000);
    assert.equal(creates, 1);
    const own = [state()], other = [state('other')];
    assert.notEqual(incidentIdentity(issue('a', own), evidence(own), 'ag_NEKO').key,
        incidentIdentity(issue('a', other), evidence(other), 'ag_NEKO').key);
    reconcileStateIncidents(ledger, { online: true, observedAt: NOW + 10000, state: {
        server: { channels: { 'mcagent:appearance': { observedAt: NOW + 10000,
            value: { playerUuid: 'own', playerName: 'ag_NEKO', available: true } } } } } }, NOW + 10000);
    await publish(NOW + 15000);
    assert.equal(creates, 2);
});

test('the same receipt is published once even after an ambiguous HTTP reply and restart', async () => {
    const facts = [fact()], ledger = {}, tickets = []; let creates = 0;
    const input = { issue: issue('first-key', facts), evidence: evidence(facts), tickets, ledger, subject: 'ag_NEKO', now: NOW,
        create: async body => { creates++; tickets.push({ id: 'T-0001', status: 'open', occurrences: 1,
            dedupKey: body.dedupKey, evidence: body.evidence }); throw Error('Reply lost after server write'); } };
    assert.equal((await publishIncident(input)).state, 'pending');
    const restarted = await publishIncident({ ...input, ledger: {}, issue: issue('different-key', facts), now: NOW + 301000 });
    assert.equal(restarted.state, 'duplicate');
    assert.equal(restarted.ticketId, 'T-0001');
    assert.equal(creates, 1);
});

test('an actual failed write remains pending and retries after cooldown instead of losing the occurrence', async () => {
    const facts = [fact()], ledger = {}; let creates = 0;
    const input = { issue: issue('key', facts), evidence: evidence(facts), tickets: [], ledger, subject: 'ag_NEKO', now: NOW,
        create: async body => { creates++; if (creates === 1) throw Error('No server write');
            return { ticket: { id: 'T-0001', status: 'open', occurrences: 1, dedupKey: body.dedupKey, evidence: body.evidence } }; } };
    assert.equal((await publishIncident(input)).state, 'pending');
    assert.equal((await publishIncident({ ...input, now: NOW + 1000 })).state, 'pending');
    assert.equal(creates, 1);
    assert.equal((await publishIncident({ ...input, now: NOW + 301000 })).state, 'written');
    assert.equal(creates, 2);
});

test('a new task occurrence updates the original ticket instead of creating a new model-key ticket', async () => {
    const ledger = {}, tickets = []; let creates = 0;
    const create = async body => {
        creates++; const ticket = { id: 'T-0001', status: 'open', occurrences: creates,
            dedupKey: body.dedupKey, evidence: body.evidence }; tickets.splice(0, 1, ticket); return { ticket };
    };
    for (const [key, f] of [['first', fact()], ['different', fact('native.execution.2.b', 'Window changed', 'task-b')]])
        await publishIncident({ issue: issue(key, [f]), evidence: evidence([f]), tickets, ledger, subject: 'ag_NEKO', create, now: NOW });
    assert.equal(creates, 2);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].evidence.incident.occurrenceIds.length, 2);
});

test('verified historical occurrences stay suppressed while later failures are real recurrences', async () => {
    const f = [fact()], identity = incidentIdentity(issue('old', f), evidence(f), 'ag_NEKO');
    const ticket = { id: 'T-0001', status: 'open', occurrences: 1, dedupKey: identity.key,
        evidence: { incident: { ...identity, occurrenceIds: f.map(f => f.id) } } };
    const repairs = [{ ticketId: ticket.id, ticketOccurrences: 1, phase: 'verified', recordedAt: NOW + 1000,
        verification: { passed: true, at: NOW + 1000 }, writeback: { state: 'written' } }];
    let creates = 0;
    const input = { issue: issue('old-again', f), evidence: evidence(f), tickets: [ticket], ledger: {}, subject: 'ag_NEKO', repairs,
        create: async body => { creates++; return { ticket: { ...ticket, occurrences: 2, evidence: body.evidence } }; }, now: NOW + 2000 };
    assert.equal((await publishIncident(input)).state, 'verified_history');
    const later = [{ ...fact('native.execution.2.b', 'Window changed', 'new-task'), observedAt: NOW + 3000 }];
    assert.equal((await publishIncident({ ...input, issue: issue('new-wording', later), evidence: evidence(later) })).state, 'written');
    assert.equal(creates, 1);
});

test('grouping keeps aliases and never changes or closes source tickets', () => {
    const a = [fact()], b = [fact('native.execution.2.b', 'Window changed', 'task-b')];
    const tickets = [a, b].map((facts, i) => ({ id: 'T-000' + i, title: 'different wording', status: 'open',
        evidence: { facts, ids: facts.map(f => f.id), scope: 'execution' }, dedupKey: 'old-' + i }));
    const before = structuredClone(tickets), groups = groupIncidents(tickets, { subject: 'ag_NEKO' });
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].ticketIds, ['T-0000', 'T-0001']);
    assert.deepEqual(tickets, before);
});
