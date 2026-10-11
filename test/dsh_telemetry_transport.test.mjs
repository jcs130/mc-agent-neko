import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { TELEMETRY_MAX_PAYLOAD } from '../services/dsh-supervisor/app.mjs';
import { buildEvidence, validateIssue } from '../services/dsh-supervisor/core.mjs';

test('complete loopback game states over four MiB remain intact and a later snapshot is received', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const now = Date.now();
    const full = { type: 'game_state', online: true, observedAt: now, sessionId: 'current',
        state: { self: { health: 20 }, activity: { action: null } },
        recentEvents: [{ observedAt: now, kind: 'system', text: '完整原文'.repeat(550000) }],
        lastField: 'exact-tail-marker' };
    const encoded = JSON.stringify(full);
    assert.ok(Buffer.byteLength(encoded) > 4 * 1024 * 1024);
    server.on('connection', socket => {
        socket.send(encoded);
        socket.send(JSON.stringify({ ...full, recentEvents: [], observedAt: now + 1 }));
    });
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`, { maxPayload: TELEMETRY_MAX_PAYLOAD });
    const messages = [];
    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('No complete telemetry received')), 5000);
            client.on('error', error => { clearTimeout(timeout); reject(error); });
            client.on('message', raw => {
                messages.push(JSON.parse(raw));
                if (messages.length === 2) { clearTimeout(timeout); resolve(); }
            });
        });
        assert.deepEqual(messages[0], full);
        assert.equal(messages[1].observedAt, now + 1);
        const evidence = buildEvidence(messages[0], null, null, now);
        assert.equal(evidence.fresh, true);
        assert.ok(JSON.stringify(evidence).length < 9000, 'transport is complete; the existing model evidence budget remains');
    } finally {
        client.terminate();
        for (const socket of server.clients) socket.terminate();
        await new Promise(resolve => server.close(resolve));
    }
});

test('absent game state never creates progress evidence or throws while disconnected', () => {
    for (const frame of [null, undefined, {}]) {
        for (const progress of [null, undefined, {}, { sessionId: undefined, observedAt: Date.now() }]) {
            const evidence = buildEvidence(frame, null, null, Date.now(), { progress });
            assert.equal(evidence.fresh, false);
            assert.equal(evidence.observedAt, null);
            assert.ok(!evidence.facts.some(f => f.sourceId === 'autonomy.idle_decision_window'));
            assert.equal(validateIssue({ key: 'stall', title: 'stall', evidenceIds: ['game.self'] }, evidence), null);
        }
    }
});

test('progress belongs only to a real matching game session', () => {
    const now = Date.now();
    const frame = { online: true, observedAt: now, sessionId: 'current', state: {} };
    const same = buildEvidence(frame, null, null, now, { progress: { sessionId: 'current', observedAt: now } });
    assert.ok(same.facts.some(f => f.sourceId === 'autonomy.idle_decision_window'));
    const old = buildEvidence(frame, null, null, now, { progress: { sessionId: 'previous', observedAt: now } });
    assert.ok(!old.facts.some(f => f.sourceId === 'autonomy.idle_decision_window'));
});
