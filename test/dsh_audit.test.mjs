import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../services/dsh-supervisor/core.mjs';

const NOW = 1791562000000;
const frame = at => ({ sessionId: 'live', online: true, observedAt: at,
    state: { self: { health: 20 }, activity: { skill: null } } });
const failure = (at, taskId, message = 'Action output: TypeError: missing recipe') => ({ at,
    value: { type: 'task_finished', status: 'failed', task_id: taskId, message } });

test('immutable observations preserve old time when a new snapshot arrives', () => {
    const first = core.refreshEvidence(core.buildEvidence(frame(NOW), null, null, NOW), [], NOW);
    const old = first.facts.find(f => f.sourceId === 'game.activity');
    const next = core.refreshEvidence(core.buildEvidence(frame(NOW + 120000), null, null, NOW + 120000), [old], NOW + 120000);
    assert.equal(next.facts.find(f => f.id === old.id).observedAt, NOW);
    assert.equal(next.facts.find(f => f.id === old.id).stale, true);
    assert.notEqual(next.facts.find(f => f.sourceId === 'game.activity' && !f.stale).id, old.id);
});

test('native receipt IDs stay stable when unrelated events enter the history', () => {
    const event = failure(NOW - 1000, 'task-1');
    const build = events => core.buildEvidence(frame(NOW), null, null, NOW, { nativeEvents: events });
    const id = build([event]).facts.find(f => f.value?.taskId === 'task-1').id;
    assert.equal(build([failure(NOW - 2000, 'unrelated'), event]).facts.find(f => f.value?.taskId === 'task-1').id, id);
});

test('bounded repeated failures remain explicit historical execution evidence', () => {
    const events = [failure(NOW - 600000, 'a'), failure(NOW - 300000, 'b')];
    const evidence = core.buildEvidence(frame(NOW), null, null, NOW, { nativeEvents: events });
    const group = evidence.facts.find(f => f.sourceId === 'native.failures');
    assert.equal(group.value.groups[0].taskCount, 2);
    assert.equal(group.value.groups[0].firstAt, NOW - 600000);
    assert.equal(group.observedAt, NOW - 300000);
    const ids = evidence.facts.filter(f => f.kind === 'execution').map(f => f.id);
    const issue = { key: 'recipe-exception', title: 'Repeated execution exception', scope: 'execution', evidenceIds: ids };
    assert.ok(core.validateIssue(issue, evidence));
    assert.equal(core.validateIssue({ ...issue, scope: 'current' }, evidence), null);
    const expired = core.buildEvidence(frame(NOW + 1800001), null, null, NOW + 1800001, { nativeEvents: events });
    assert.equal(core.validateIssue(issue, expired), null);
});

test('failure signals wake after cooldown only when not yet inspected', () => {
    const revision = core.executionRevision([failure(NOW, 'a')], NOW);
    const state = { lastAuditAt: NOW, baselineComplete: true, executionRevision: 'old' };
    assert.equal(core.auditDue(state, [], NOW + 10000, revision), false);
    assert.equal(core.auditDue(state, [], NOW + 301000, revision), true);
    assert.equal(core.auditDue({ ...state, executionRevision: revision }, [], NOW + 301000, revision), false);
    assert.equal(core.auditDue(state, [], NOW + 301000, null), false);
});

test('other-session failures cannot become evidence in this session', () => {
    const event = failure(NOW, 'old'); event.value._supervisorSessionId = 'previous';
    assert.equal(core.buildEvidence(frame(NOW), null, null, NOW, { nativeEvents: [event] }).facts
        .some(f => f.kind === 'execution'), false);
});

test('each role captures only after admission, while old citations retain age', async () => {
    const { runAuditStages } = await import('../services/dsh-supervisor/audit.mjs');
    let now = NOW;
    const sampled = [], observed = [];
    const result = await runAuditStages({ now: () => now, ledger: {}, tickets: [],
        capture: () => { sampled.push(now); return core.buildEvidence(frame(now), null, null, now); },
        runRole: async (role, prepare) => {
            now += 120000; // waiting for game inference must precede evidence capture
            const prompt = prepare(); observed.push({ role, prompt });
            const report = role === 'observer' ? { summary: 'healthy', issues: [] }
                : role === 'diagnoser' ? { summary: 'No fault', evidenceIds: [prompt.evidence.facts[0].id] }
                    : { summary: 'healthy', decision: 'reject', acceptedKeys: [], evidenceIds: [] };
            return { sessionId: role, report, evidence: prompt.evidence };
        } });
    assert.deepEqual(sampled, [NOW + 120000, NOW + 240000, NOW + 360000]);
    assert.equal(result.evidence.observedAt, NOW + 360000);
    assert.equal(observed.every(x => x.prompt.evidence.fresh), true);
});

test('a reconnect between roles aborts before a cross-session review', async () => {
    const { runAuditStages } = await import('../services/dsh-supervisor/audit.mjs');
    let calls = 0;
    await assert.rejects(runAuditStages({ now: () => NOW, ledger: {}, tickets: [],
        capture: () => core.buildEvidence({ ...frame(NOW), sessionId: calls ? 'new' : 'live' }, null, null, NOW),
        runRole: async (role, prepare) => {
            const prompt = prepare(); calls++;
            return { report: { summary: 'healthy', issues: [] }, evidence: prompt.evidence };
        } }), /session changed/i);
    assert.equal(calls, 1);
});

test('slow review cannot refresh a current-state issue but can inspect a dated execution failure', async () => {
    const { runAuditStages } = await import('../services/dsh-supervisor/audit.mjs');
    for (const scope of ['current', 'execution']) {
        let now = NOW;
        const event = failure(NOW - 300000, 'a');
        const result = await runAuditStages({ now: () => now, ledger: { baselineComplete: true }, tickets: [],
            capture: () => core.buildEvidence(frame(now), null, null, now, { nativeEvents: [event] }),
            runRole: async (role, prepare) => {
                if (role !== 'observer') now += 120000;
                const prompt = prepare();
                const fact = role === 'observer' ? prompt.evidence.facts.find(f => scope === 'current'
                    ? f.sourceId === 'game.activity' : f.sourceId.startsWith('native.execution.')) : null;
                const report = role === 'observer' ? { issues: [{ key: 'fault', title: 'fault', scope, evidenceIds: [fact.id] }] }
                    : role === 'diagnoser' ? { summary: 'inspect error', evidenceIds: [prompt.issues[0].evidenceIds[0]] }
                        : { decision: 'accept', acceptedKeys: ['fault'], evidenceIds: prompt.issues[0].evidenceIds };
                return { report, evidence: prompt.evidence };
            } });
        const approved = core.approvedIssues(result.issues, result.reviewer.report, result.evidence,
            core.buildEvidence(frame(now), null, null, now), now);
        assert.equal(approved.length, scope === 'execution' ? 1 : 0);
        if (scope === 'execution') assert.equal(result.evidence.facts.find(f => f.id === approved[0].evidenceIds[0]).observedAt, event.at);
    }
});

test('failed audit attempts also obey the five-minute inference cooldown', () => {
    assert.equal(core.auditDue({ baselineComplete: false, lastAttemptAt: NOW }, [], NOW + 60000, 'new-failure'), false);
    assert.equal(core.auditDue({ baselineComplete: false, lastAttemptAt: NOW }, [], NOW + 300001), true);
});

test('long inventory text cannot hide a real command exception from the digest', () => {
    const event = failure(NOW - 1000, 'a', 'inventory '.repeat(200) + '\nError: TypeError: Cannot read properties of null (reading length)');
    const evidence = core.buildEvidence(frame(NOW), null, null, NOW, { nativeEvents: [event] });
    assert.match(evidence.facts.find(f => f.kind === 'execution').value.message, /TypeError/);
    assert.ok(JSON.stringify(evidence).length < 7000);
});
