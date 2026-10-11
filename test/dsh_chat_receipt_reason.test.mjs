import test from 'node:test';
import assert from 'node:assert/strict';
import { sendGameChat } from '../src/websocket/chat_bridge.js';
import { buildEvidence } from '../services/dsh-supervisor/core.mjs';

const now = 1791678560000;
const frame = { sessionId: 'live', online: true, observedAt: now,
    state: { self: { health: 20 }, activity: { skill: null } } };
const evidenceFor = values => buildEvidence(frame, null, null, now, {
    nativeEvents: values.map((value, index) => ({ at: now - 1000 + index, value })),
});
const receipts = evidence => evidence.facts.filter(f => f.sourceId.startsWith('native.execution.'));

test('actual rejected NPC whisper retains the native reason in DSH evidence', async () => {
    const bot = { entity: {}, chat() { assert.fail('Rejected chat must never be sent'); } };
    const result = await sendGameChat(bot, { text: '你好', player: '禾仓' });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'Invalid player name.');
    const evidence = evidenceFor([{ type: 'chat_result', request_id: 'one', ...result }]);
    assert.equal(receipts(evidence)[0].value.message, result.reason);
    assert.equal(receipts(evidence)[0].kind, 'execution');
    assert.equal(evidence.facts.find(f => f.sourceId === 'native.failures').value.groups[0].excerpt, result.reason);
});

test('distinct native reasons are not collapsed into one empty failure group', async () => {
    const offline = await sendGameChat({}, { text: '你好' });
    const invalid = await sendGameChat({ entity: {}, chat() {} }, { text: '你好', player: '禾仓' });
    const evidence = evidenceFor([offline, invalid].map(result => ({ type: 'chat_result', ...result })));
    const groups = evidence.facts.find(f => f.sourceId === 'native.failures').value.groups;
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map(g => g.excerpt).sort(), ['Invalid player name.', 'offline']);
});

test('empty message and error cannot mask a nonempty reason', () => {
    const evidence = evidenceFor([{ type: 'chat_result', status: 'failed', message: '', error: '', reason: 'duplicate' }]);
    assert.equal(receipts(evidence)[0].value.message, 'duplicate');
});

test('existing message and exception priority is preserved', () => {
    for (const [value, expected] of [
        [{ message: 'specific message', error: 'other', reason: 'fallback' }, 'specific message'],
        [{ message: '', error: 'Error: explicit exception', reason: 'fallback' }, 'explicit exception'],
    ]) {
        const evidence = evidenceFor([{ type: 'task_finished', status: 'failed', ...value }]);
        assert.ok(receipts(evidence)[0].value.message.includes(expected));
        assert.ok(!receipts(evidence)[0].value.message.includes('fallback'));
    }
});

test('reason fallback remains bounded and does not mutate the native receipt', () => {
    const value = { type: 'chat_result', status: 'failed', reason: 'invalid '.repeat(200) };
    const copy = structuredClone(value);
    const evidence = evidenceFor([value]);
    assert.ok(receipts(evidence)[0].value.message.length <= 650);
    assert.deepEqual(value, copy);
});

test('unknown empty failure remains empty instead of inventing a cause', () => {
    const evidence = evidenceFor([{ type: 'chat_result', status: 'failed' }]);
    assert.equal(receipts(evidence)[0].value.message, '');
});
