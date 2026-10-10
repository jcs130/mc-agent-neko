import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEventCursor, consumeEvents } from '../bots/_supervisor/event-cursor.mjs';

const NOW = 1791597700000;
const line = (at, text) => `[${new Date(at).toISOString()}] ${JSON.stringify({ type: 'log', message: text })}`;

test('migration uses the previous sentinel watermark and never replays its old alerts', async () => {
    const cursor = initialEventCursor(null, NOW - 1000, NOW);
    let calls = 0;
    const next = await consumeEvents([line(NOW - 2000, 'Pinned 15min+'), line(NOW, 'new')], cursor,
        async () => { calls++; return true; }, NOW);
    assert.equal(calls, 1);
    assert.equal(next.at, NOW);
});

test('a persisted cursor survives restart, including multiple events at one timestamp', async () => {
    const lines = [line(NOW, 'Pinned 15min+ #1'), line(NOW, 'Pinned 15min+ #2')];
    let calls = 0;
    const cursor = await consumeEvents(lines, initialEventCursor(null, NOW - 1000, NOW),
        async () => { calls++; return true; }, NOW);
    assert.equal(calls, 2);
    const saved = JSON.parse(JSON.stringify(cursor));
    await consumeEvents(lines, initialEventCursor(saved, NOW, NOW), async () => { calls++; return true; }, NOW);
    assert.equal(calls, 2);
});

test('unconfirmed ticket writes stay retryable and cannot be skipped by later log lines', async () => {
    const lines = [line(NOW - 2, 'ordinary'), line(NOW - 1, 'Pinned 15min+'), line(NOW, 'ordinary later')];
    const called = [];
    const cursor = await consumeEvents(lines, initialEventCursor(null, NOW - 1000, NOW),
        async value => { called.push(value); return !value.includes('Pinned'); }, NOW);
    assert.equal(cursor.at, NOW - 2);
    assert.equal(called.length, 2);
    const retried = await consumeEvents(lines, cursor, async () => true, NOW);
    assert.equal(retried.at, NOW);
});

test('malformed and future entries cannot advance the watermark', async () => {
    const cursor = initialEventCursor(null, NOW - 1000, NOW);
    assert.deepEqual(await consumeEvents(['partial', line(NOW + 60000, 'future')], cursor,
        async () => assert.fail('not a current event'), NOW), cursor);
    assert.equal(initialEventCursor({ at: NOW + 60000 }, null, NOW).at, NOW);
});
