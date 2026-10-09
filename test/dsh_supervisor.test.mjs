import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidence, parseReport, validateIssue, auditDue, assertLocalModel, makeProfile, canStartInference, approvedIssues, selectTicket, isActivityEvent } from '../services/dsh-supervisor/core.mjs';

const NOW = 1791562000000;
const frame = { sessionId: 'live-session', observedAt: NOW, online: true, state: {
    self: { health: 20, food: 18, position: { x: 1, y: 64, z: 2 } },
    inventory: { counts: { coal: 64, wooden_pickaxe: 1 } }, activity: { skill: 'mine', action: null, digging: true },
    server: { channels: { 'mcagent:market': { text: 'MC_MARKET_CHECK stage=2 ready=false' } } },
} };

test('model route is restricted to this machine', () => {
    for (const url of ['http://127.0.0.1:18030/v1', 'http://localhost:18030/v1']) assert.doesNotThrow(() => assertLocalModel(url));
    for (const url of ['https://api.deepseek.com/v1', 'http://192.168.3.162:18030/v1', 'http://localhost.evil.test/v1']) assert.throws(() => assertLocalModel(url));
});

test('evidence preserves live activity and server quest while bounding a large payload', () => {
    const large = structuredClone(frame);
    large.state.server.welcome = [{ text: 'welcome '.repeat(20000) }];
    const evidence = buildEvidence(large, { ts: NOW, commitment: { skill: 'mine' } }, null, NOW);
    assert.ok(JSON.stringify(evidence).length < 9000);
    assert.equal(evidence.fresh, true);
    assert.ok(JSON.stringify(evidence).includes('MC_MARKET_CHECK'));
    assert.ok(evidence.facts.find(x => x.id === 'game.activity').value.digging);
});

test('stale or offline snapshots cannot establish a current problem', () => {
    assert.equal(buildEvidence(frame, null, null, NOW + 120000).fresh, false);
    assert.equal(buildEvidence({ ...frame, online: false }, null, null, NOW).fresh, false);
    const evidence = buildEvidence(frame, { ts: NOW - 600000, commitment: 'old' }, null, NOW);
    assert.equal(evidence.facts.find(x => x.id === 'native.world').stale, true);
    assert.equal(validateIssue({ key: 'stuck', title: 'stuck', evidenceIds: ['native.world'] }, evidence), null);
});

test('fresh telemetry does not refresh cached server quest evidence', () => {
    const cached = structuredClone(frame);
    cached.state.server.channels['mcagent:market'].observedAt = NOW - 600000;
    const evidence = buildEvidence(cached, null, null, NOW);
    assert.equal(evidence.fresh, true);
    const quest = evidence.facts.find(x => x.id === 'game.quest');
    assert.equal(quest.ageMs, 600000);
    assert.equal(quest.stale, true);
    assert.ok(JSON.stringify(quest.value).includes('MC_MARKET_CHECK'));
    assert.equal(validateIssue({ key: 'pending', title: 'pending quest', evidenceIds: ['game.quest'] }, evidence), null);
});

test('old events, welcome messages and stale sentinel inputs cannot prove a live fault', () => {
    const cached = { ...frame, recentEvents: [{ observedAt: NOW - 600000, text: 'old failure' }],
        state: { ...frame.state, server: { ...frame.state.server, welcome: { startedAt: NOW - 600000, messages: ['welcome'] } } } };
    const evidence = buildEvidence(cached, null, { ts: NOW, telemetryAgeS: 120, realProgress: { staleMin: 8 } }, NOW);
    assert.ok(!evidence.facts.some(x => x.id === 'game.events'));
    for (const id of ['game.welcome', 'sentinel']) {
        assert.equal(evidence.facts.find(x => x.id === id).stale, true);
        assert.equal(validateIssue({ key: 'old', title: 'old fault', evidenceIds: [id] }, evidence), null);
    }
    cached.recentEvents.push({ observedAt: NOW, text: 'new failure' });
    const events = buildEvidence(cached, null, null, NOW).facts.find(x => x.id === 'game.events');
    assert.deepEqual(events.value.map(x => x.text), ['new failure']);
});

test('only real task events feed the native event-silence detector', () => {
    assert.equal(isActivityEvent({ type: 'task_finished', status: 'failed' }), true);
    assert.equal(isActivityEvent({ type: 'server_command_result', ok: false }), true);
    for (const type of ['game_state', 'vitals', 'bot_status_nl', 'screenshot', 'pong', 'ingame_chat']) {
        assert.equal(isActivityEvent({ type }), false);
    }
});

test('reports need actual evidence references, and generated text is never executable', () => {
    const evidence = buildEvidence(frame, null, null, NOW);
    assert.equal(validateIssue({ key: 'stuck', title: 'stuck', evidenceIds: ['invented'] }, evidence), null);
    const accepted = validateIssue({ key: 'stuck', title: 'possible stall', severity: 'high', evidenceIds: ['game.activity'] }, evidence);
    assert.equal(accepted.severity, 'high');
    assert.throws(() => parseReport('process.exit(0)'));
    assert.deepEqual(parseReport('```json\n{"issues":[]}\n```'), { issues: [] });
});

test('no model heartbeat between audits; fresh/recurrent tickets wake after cooldown', () => {
    const state = { lastAuditAt: NOW, baselineComplete: true, reviewed: {} };
    assert.equal(auditDue(state, [], NOW + 15000), false);
    assert.equal(auditDue(state, [], NOW + 901000), true);
    const ticket = { id: 'T-0001', status: 'open', updatedAt: 'new' };
    assert.equal(auditDue(state, [ticket], NOW + 301000), true);
    assert.equal(auditDue({ ...state, reviewed: { 'T-0001': 'new' } }, [ticket], NOW + 301000), false);
    assert.equal(auditDue({ ...state, baselineComplete: false }, [], NOW), true);
});

test('recurring high-priority tickets cannot starve unreviewed work', () => {
    const tickets = [{ id: 'T-0001', updatedAt: 'recurrence' }, { id: 'T-0002', updatedAt: 'first' }];
    assert.equal(selectTicket(tickets, { reviewed: { 'T-0001': 'old' }, reviewedAt: { 'T-0001': NOW } }).id, 'T-0002');
    assert.equal(selectTicket([], {}), null);
    assert.equal(selectTicket(tickets, { reviewed: { 'T-0001': 'recurrence', 'T-0002': 'first' } }).id, 'T-0001');
});

test('the isolated DSH profile has one local provider and no shell or remote model runner', () => {
    const rows = makeProfile({ appPath: 'D:/work/app.mjs', runtimeRoot: 'D:/state', nativeRoot: 'D:/mc' }).flatMap(x => x.insert ?? [x]);
    for (const id of ['llm-deepseek', 'sdk-jsonrpc-server', 'persistent-pwsh', 'persistent-bash']) assert.equal(rows.find(x => x.id === id).disabled, true);
    const provider = rows.find(x => x.id === 'llm-pi-ai').config.providers;
    assert.deepEqual(Object.keys(provider), ['neko-local']);
    assert.equal(provider['neko-local'].baseURL, 'http://127.0.0.1:18030/v1');
    assert.equal(provider['neko-local'].models[0].reasoningEfforts.off, null);
    assert.equal(provider['neko-local'].compat.thinkingFormat, 'qwen-chat-template');
    assert.equal(rows.find(x => x.id === 'neko-supervisor').config.runtimeRoot, 'D:/state');
});

test('monitor inference yields to a running or queued game request and unknown metrics', () => {
    assert.equal(canStartInference({ live: { state: 'idle', queued: 0 } }), true);
    for (const metrics of [null, {}, { live: { state: 'generating', queued: 0 } }, { live: { state: 'idle', queued: 1 } }]) {
        assert.equal(canStartInference(metrics), false);
    }
});

test('independent review cannot publish unsupported, expired, or previous-session issues', () => {
    const evidence = buildEvidence(frame, null, null, NOW);
    const issue = validateIssue({ key: 'stuck', title: 'possible stall', evidenceIds: ['game.activity'] }, evidence);
    const reviewer = { decision: 'accept', acceptedKeys: ['stuck'], evidenceIds: ['game.activity'] };
    assert.equal(approvedIssues([issue], reviewer, evidence, evidence, NOW).length, 1);
    for (const invalid of [
        { ...reviewer, decision: 'uncertain' }, { ...reviewer, acceptedKeys: ['invented'] },
        { ...reviewer, evidenceIds: ['invented'] }, { ...reviewer, evidenceIds: ['game.self'] },
    ]) assert.equal(approvedIssues([issue], invalid, evidence, evidence, NOW).length, 0);
    assert.equal(approvedIssues([issue], reviewer, evidence, { ...evidence, sessionId: 'next-session' }, NOW).length, 0);
    assert.equal(approvedIssues([issue], reviewer, evidence, evidence, NOW + 91000).length, 0);
});
