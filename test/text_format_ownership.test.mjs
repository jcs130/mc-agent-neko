import test from 'node:test';
import assert from 'node:assert/strict';
import { strictFormat } from '../src/utils/text.js';

test('formatting repeated receipts never changes or accumulates caller history', () => {
    const turns = [
        { role: 'system', content: '  actual protected action result A  ' },
        { role: 'system', content: 'actual inventory result B' },
        { role: 'assistant', content: 'accepted plan' },
        { role: 'assistant', content: 'actual failure' },
    ];
    const original = structuredClone(turns);
    const first = strictFormat(turns);
    const second = strictFormat(turns);
    assert.deepEqual(turns, original);
    assert.deepEqual(first, second);
    assert.equal(first[0].content, 'SYSTEM: actual protected action result A\nSYSTEM: actual inventory result B');
    first[0].content += '\nrequest-only suffix';
    assert.deepEqual(turns, original);
    assert(!second[0].content.includes('request-only suffix'));
});

test('read-only caller turns and independent fillers remain valid', () => {
    const turns = Object.freeze([
        Object.freeze({ role: 'assistant', content: ' A ' }),
        Object.freeze({ role: 'assistant', content: 'B' }),
        Object.freeze({ role: 'assistant', content: 'C' }),
    ]);
    const messages = strictFormat(turns);
    assert.deepEqual(messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    messages[0].content = 'only this filler';
    assert.equal(messages[2].content, '_');
    assert.equal(messages[4].content, '_');
    assert.equal(turns[0].content, ' A ');
});
