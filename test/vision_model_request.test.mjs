import test from 'node:test';
import assert from 'node:assert/strict';
import { GPT } from '../src/models/gpt.js';

function fixture(fail = false) {
    let request;
    const model = Object.create(GPT.prototype);
    Object.assign(model, { url: 'http://127.0.0.1:18030/v1', model_name: 'local-qwen',
        params: { max_tokens: 384, reasoning_effort: 'none' },
        openai: { chat: { completions: { create: async (body, options) => {
            request = { body, options };
            if (fail) throw new Error('encoder unavailable');
            return { choices: [{ finish_reason: 'stop', message: { content: 'Red square.' } }] };
        } } } } });
    return { model, request: () => request };
}

test('vision sends a real image_url content array to the local chat-completions endpoint', async () => {
    const f = fixture();
    const turns = [{ role: 'user', content: 'Inspect the current view.' }];
    const original = structuredClone(turns);
    assert.equal(await f.model.sendVisionRequest(turns, 'Describe visible facts.', Buffer.from('jpeg')), 'Red square.');
    const { body, options } = f.request();
    assert.equal(body.model, 'local-qwen');
    assert.equal(body.messages[0].role, 'system');
    assert.deepEqual(body.messages.at(-1).content, [
        { type: 'text', text: 'Describe the attached current game view.' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,anBlZw==' } },
    ]);
    assert.equal(options.timeout, 45000);
    assert.equal(options.maxRetries, 0);
    assert.deepEqual(turns, original);
});

test('vision bounds historical text and keeps the current image intact', async () => {
    const f = fixture();
    await f.model.sendVisionRequest(Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `${i}:` + 'x'.repeat(5000) })), 'See.', Buffer.from('png'), 'image/png');
    const messages = f.request().body.messages;
    assert.equal(messages.length, 8);
    assert.ok(messages.slice(1, -1).every(m => m.content.length <= 1000));
    assert.match(messages.at(-1).content[1].image_url.url, /^data:image\/png;base64,/);
});

test('vision propagates endpoint failure instead of claiming an image analysis', async () => {
    const f = fixture(true);
    await assert.rejects(f.model.sendVisionRequest([], 'See.', Buffer.from('jpeg')), /encoder unavailable/);
});

test('vision forwards cancellation to the model transport', async () => {
    const f = fixture();
    const controller = new AbortController();
    await f.model.sendVisionRequest([], 'See.', Buffer.from('jpeg'), 'image/jpeg', { signal: controller.signal });
    assert.equal(f.request().options.signal, controller.signal);
});
