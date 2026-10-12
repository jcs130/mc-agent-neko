import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { strictFormat } from '../src/utils/text.js';
import { createRequestTrace, RequestTrace } from '../src/utils/llm_timing.js';
import { executionPromptHistory } from '../src/agent/context_budget.js';

function model(url, enabled = true) {
    const requests = [];
    const context = vm.createContext({ URL, process: { env: { NEKO_LOCAL_STRATA_PREFILL: enabled ? '1' : '0' } },
        console: { log() {} }, hasKey: () => false, getKey: () => 'unused',
        strictFormat, createRequestTrace,
        OpenAIApi: class { constructor() { this.chat = { completions: { create: (body, options) => {
            requests.push({ body, options }); return Promise.resolve({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] });
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

test('local dynamic state follows retained history exactly once on every request', async () => {
    const { client, requests } = model('http://127.0.0.1:18030/v1');
    const fixed = 'Identity, stop rules and documented capabilities';
    const marker = '\n\nDYNAMIC EXECUTION CONTEXT — historical evidence is not current authority:\n';
    const turns = [
        { role: 'user', content: 'original player request' },
        { role: 'assistant', content: 'previous executed command' },
        { role: 'system', content: 'actual protection denied A' },
        { role: 'system', content: 'actual item received B' },
    ];
    const original = structuredClone(turns);
    for (const state of ['fresh health=20 x=12', 'fresh health=8 x=15']) {
        await client.sendRequest(turns, fixed + marker + state);
    }
    assert.deepEqual(turns, original);
    for (const { body } of requests) {
        const text = body.messages.map(m => m.content).join('\n');
        assert(text.indexOf('actual item received B') < text.indexOf('fresh health='));
        assert.equal(text.split('actual item received B').length - 1, 1);
        assert.equal(text.split('actual protection denied A').length - 1, 1);
        assert.equal(text.split(marker.trim()).length - 1, 1);
        assert.equal(body.messages[0].content, fixed);
        assert.equal(body.messages.at(-1).role, 'user');
    }
    assert.deepEqual(requests[0].body.messages.slice(0, -1), requests[1].body.messages.slice(0, -1));
});

test('a native capacity retry keeps remaining receipts once without mutating history', async () => {
    const { client, requests } = model('http://127.0.0.1:18030/v1');
    const send = client.openai.chat.completions.create;
    let attempt = 0;
    client.openai.chat.completions.create = async (...args) => {
        const result = await send(...args);
        if (!attempt++) throw Object.assign(new Error('context_length_exceeded'), { code: 'context_length_exceeded' });
        return result;
    };
    const turns = [
        { role: 'user', content: 'earlier retained evidence' },
        { role: 'system', content: 'receipt A' },
        { role: 'system', content: 'receipt B' },
    ];
    const original = structuredClone(turns);
    await client.sendRequest(turns, 'fixed rules');
    assert.deepEqual(turns, original);
    assert.equal(requests.length, 2);
    for (const { body } of requests) {
        const text = body.messages.map(m => m.content).join('\n');
        assert.equal(text.split('receipt A').length - 1, 1);
        assert.equal(text.split('receipt B').length - 1, 1);
    }
});

test('the native next-step instruction reaches the final HTTP user turn after a prose response', async () => {
    const agent = { adminMission: { isActive: () => true, mission: { origin: 'ws', text: 'Craft an iron sword' } } };
    const { client, requests } = model('http://127.0.0.1:18030/v1');
    const turns = [{ role: 'user', content: 'admin: Craft an iron sword' },
        { role: 'assistant', content: '先走到村庄补给商旁边' },
        { role: 'system', content: "You are self-prompting with the goal: 'Craft an iron sword'. Your next response MUST contain a command with this syntax: !commandName. Respond:" }];
    const fixed = 'Fixed safety, stop rules and command docs';
    await client.sendRequest(executionPromptHistory(turns, agent),
        fixed + '\n\nDYNAMIC EXECUTION CONTEXT — historical evidence is not current authority:\nCURRENT TASK: Craft an iron sword');
    const messages = requests[0].body.messages;
    assert.equal(messages[0].content, fixed);
    assert.equal(messages.at(-1).role, 'user', 'a new execution turn must not end at the previous assistant plan');
    assert.match(messages.at(-1).content, /EXECUTION TURN/);
    assert.match(messages.at(-1).content, /!commandName/);
    assert(!messages.some(turn => /self-prompting with the goal/.test(turn.content)));
    assert.equal('strata_checkpoint' in requests[0].body, false, 'continuous native checkpoints remain enabled');
});
