import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { strictFormat } from '../src/utils/text.js';
import { createRequestTrace, RequestTrace } from '../src/utils/llm_timing.js';

function model(url, enabled = true) {
    const requests = [];
    const context = vm.createContext({ URL, process: { env: { NEKO_LOCAL_STRATA_PREFILL: enabled ? '1' : '0' } },
        console: { log() {} }, hasKey: () => false, getKey: () => 'unused',
        strictFormat, createRequestTrace,
        OpenAIApi: class { constructor() { this.chat = { completions: { create: async (body, options) => {
            requests.push({ body, options }); return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] };
        } } }; } } });
    const source = readFileSync(new URL('../src/models/gpt.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source + '\nglobalThis.GPT = GPT;', context);
    return { client: new context.GPT('qwen3.8-flash-next-iq3_xxs', url, { reasoning_effort: 'low' }), requests };
}

test('local one-shot memory avoids parking without leaking custom SDK options or changing code thinking', async () => {
    const { client, requests } = model('http://127.0.0.1:18030/v1');
    await client.sendRequest([], 'memory evidence', '***', { strataCheckpoint: false, timeout: 5000 });
    assert.equal(requests[0].body.strata_checkpoint, false);
    assert.equal(requests[0].body.reasoning_effort, 'low');
    assert.equal(requests[0].options.timeout, 5000);
    assert.equal('strataCheckpoint' in requests[0].options, false);
    await client.sendRequest([], 'execution');
    assert.equal('strata_checkpoint' in requests[1].body, false);
});

test('other endpoints and default configuration retain their request body', async () => {
    for (const [url, enabled] of [['https://api.example.com/v1', true], ['http://127.0.0.1:18030/v1', false]]) {
        const { client, requests } = model(url, enabled);
        await client.sendRequest([], 'memory', '***', { strataCheckpoint: false });
        assert.equal('strata_checkpoint' in requests[0].body, false);
        assert.equal(requests[0].body.messages[0].role, 'user');
        assert.match(requests[0].body.messages[0].content, /^SYSTEM: memory/);
    }
});

test('local execution keeps an independent stable system checkpoint across changing task state', async () => {
    const { client, requests } = model('http://127.0.0.1:18030/v1');
    const fixed = 'Fixed rules and documented tools\n'.repeat(40);
    const marker = '\n\nDYNAMIC EXECUTION CONTEXT — historical evidence is not current authority:\n';
    for (const state of ['task=A x=12 health=20', 'task=B x=15 health=8']) {
        await client.sendRequest([{role: 'system', content: 'actual action result: protection denied'}],
                                 fixed + marker + state);
    }
    const first = requests[0].body.messages, second = requests[1].body.messages;
    assert.equal(first[0].role, 'system');
    assert.equal(first[0].content, second[0].content);
    assert.equal(first[0].content, fixed);
    assert.equal(first[0].content.includes('health='), false);
    assert.match(first[1].content, /task=A x=12 health=20/);
    assert.match(second[1].content, /task=B x=15 health=8/);
    assert.match(second[1].content, /actual action result: protection denied/);
    assert.equal('strata_prefix' in requests[0].body, false, 'The game brain remains the sole pin owner');
});

test('timing metadata never leaks into SDK options or the inference body', async () => {
    const { client, requests } = model('http://127.0.0.1:18030/v1');
    const records = [];
    const requestTrace = new RequestTrace({}, 'execution', { sink: r => records.push(r) });
    await client.sendRequest([], 'PRIVATE_PROMPT', '***', { requestTrace, timeout: 5000 });
    assert.equal('requestTrace' in requests[0].options, false);
    assert.equal('requestTrace' in requests[0].body, false);
    assert.equal(requests[0].options.timeout, 5000);
    assert.deepEqual(records.map(r => r.event), ['dispatch', 'returned']);
    assert(!JSON.stringify(records).includes('PRIVATE_PROMPT'));
});
