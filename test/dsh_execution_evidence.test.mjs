import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildEvidence, validateIssue } from '../services/dsh-supervisor/core.mjs';

const NOW = 1791763928193;
const frame = () => ({ sessionId: 'live', online: true, observedAt: NOW, state: {
    self: { username: 'ag_NEKO', health: 20 }, activity: { action: '', skill: null },
    server: { channels: {} },
} });
const refusal = 'Backpack changed or unverified. Open the observed backpack and query !window again.';
const failed = (message, extra = {}) => ({ at: NOW - 1000, value: {
    type: 'task_finished', status: 'failed', task_id: 'backpack-task', message, ...extra,
} });
const receipt = (event, f = frame()) => buildEvidence(f, null, null, NOW, { nativeEvents: [event] })
    .facts.find(fact => fact.id.startsWith('native.execution.'));
const longResult = () => '任务因动作空转停止：!moveBackpackItem 连续5次明确失败，已停止。\n'
    + '!openBackpack:\nAction output:\nOpened storage; window=1.\n!window:\n'
    + Array.from({ length: 90 }, (_, i) => `[slot ${i}] cobblestone x64`).join('\n')
    + '\n' + Array(5).fill('!moveBackpackItem:\nAction failed: !moveBackpackItem did not complete successfully.\n' + refusal + '\n').join('\n');

test('actual command refusal survives a long successful window table', () => {
    const message = longResult(), fact = receipt(failed(message));
    assert.ok(message.indexOf(refusal) > 2000);
    assert.match(fact.value.message, /Backpack changed or unverified/);
    assert.equal(fact.value.failures.length, 1);
    assert.equal(fact.value.failures[0].command, '!moveBackpackItem');
    assert.equal(fact.value.failures[0].reason, refusal);
    assert.equal(fact.value.failures[0].occurrences, 5);
    assert.equal(fact.value.original.chars, message.length);
    assert.equal(fact.value.original.sha256, createHash('sha256').update(message).digest('hex'));
    assert.equal(fact.value.original.receiptId, fact.id);
    assert.equal(fact.value.executionStopped, true);
    assert.equal(fact.observedAt, NOW - 1000);
    assert.ok(!JSON.stringify(fact.value).includes('[slot 89]'));
});

test('different refusals remain distinct and successful output is not an error', () => {
    const message = '!window:\nAction output:\nA label says Error: decorative text.\n'
        + '!moveBackpackItem:\nAction failed: !moveBackpackItem did not complete successfully.\n' + refusal
        + '\n!moveBackpackItem:\nAction failed: !moveBackpackItem did not complete successfully.\nDestination has insufficient space; no items moved.';
    const fact = receipt(failed(message));
    assert.equal(fact.value.failures.length, 2);
    assert.ok(fact.value.failures.every(f => f.command === '!moveBackpackItem'));
    assert.notEqual(fact.value.failures[0].causeId, fact.value.failures[1].causeId);
});

test('long errors retain original references and explicit incomplete detail markers', () => {
    const message = '!newAction:\nAction failed: !newAction did not complete successfully.\n' + 'an actual long error '.repeat(400);
    const fact = receipt(failed(message));
    assert.equal(fact.value.failures[0].detailsIncomplete, true);
    assert.equal(fact.value.failures[0].original.receiptId, fact.id);
    assert.ok(fact.value.failures[0].original.end > fact.value.failures[0].original.start);
    assert.ok(JSON.stringify(fact.value).length < 5000);
});

test('direct command failure reasons survive while authentication operands remain private', () => {
    const event = { at: NOW, value: { type: 'server_command_result', ok: false,
        reason: 'Authentication refused for /login private-credential', command: '/login private-credential' } };
    const fact = receipt(event);
    assert.match(fact.value.message, /Authentication refused/);
    assert.ok(!JSON.stringify(fact.value).includes('private-credential'));
    assert.equal(fact.value.original.chars, event.value.reason.length);
});

test('private operand redaction does not shift immutable command-result offsets', () => {
    const message = 'Previous auth output: /login a-long-private-operand-before-the-command\n'
        + '!moveBackpackItem:\nAction failed: !moveBackpackItem did not complete successfully.\n' + refusal;
    const fact = receipt(failed(message)), ref = fact.value.failures[0].original;
    assert.ok(message.slice(ref.start, ref.end).includes(refusal));
    assert.ok(!JSON.stringify(fact.value).includes('a-long-private-operand'));
});

test('appearance evidence keeps the real subject and cause without a generic event prefix cut', () => {
    const f = frame();
    f.state.server.channels['mcagent:appearance'] = { observedAt: NOW - 2000, value: {
        playerName: 'ag_NEKO', playerUuid: 'own-uuid', available: false,
        reason: 'YSM_WORKER_STATE_UNAVAILABLE', source: 'freesia_worker',
    } };
    const evidence = buildEvidence(f, null, null, NOW);
    const own = evidence.facts.find(x => x.id === 'game.appearance');
    assert.equal(own.value.subject, 'own-uuid');
    assert.equal(own.value.reason, 'YSM_WORKER_STATE_UNAVAILABLE');
    assert.equal(own.observedAt, NOW - 2000);
});

test('another player appearance is context and cannot prove NEKO is broken', () => {
    const f = frame(), appearance = { playerName: 'AnotherPlayer', playerUuid: 'other-uuid',
        available: false, reason: 'YSM_WORKER_STATE_UNAVAILABLE' };
    f.state.server.channels['mcagent:appearance'] = { observedAt: NOW, value: appearance };
    f.recentEvents = [{ observedAt: NOW, kind: 'plugin_message', data: { channel: 'mcagent:appearance', value: appearance } }];
    const evidence = buildEvidence(f, null, null, NOW);
    assert.ok(!evidence.facts.find(x => x.id === 'game.appearance'));
    const other = evidence.facts.find(x => x.id === 'game.other_appearance');
    assert.equal(other.kind, 'record');
    assert.ok(!evidence.facts.find(x => x.id === 'game.events'));
    assert.equal(validateIssue({ key: 'own-model-down', title: 'own model down', evidenceIds: [other.id] }, evidence), null);
});
