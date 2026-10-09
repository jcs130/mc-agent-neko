import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { boundedPromptHistory, executionPromptHistory, executionPromptTemplate } from '../src/agent/context_budget.js';
import { withTimeout } from '../src/utils/timeout.js';

function fixture(sendRequest) {
    const source = readFileSync(new URL('../src/models/prompter.js', import.meta.url), 'utf8');
    const context = vm.createContext({ console, AbortController, setTimeout, clearTimeout,
        boundedPromptHistory, executionPromptHistory, executionPromptTemplate, withTimeout });
    vm.runInContext(source.slice(source.indexOf('export class Prompter')).replace('export class', 'class'), context);
    const Prompter = vm.runInContext('Prompter', context);
    const prompter = Object.create(Prompter.prototype);
    Object.assign(prompter, { agent: {}, profile: { coding: 'Write code.' }, awaiting_coding: false,
        code_model: { sendRequest }, coding_examples: null,
        checkCooldown: async () => {}, replaceStrings: async text => text, _saveLog: async () => {} });
    return prompter;
}

test('a failed coding request releases its gate and a later request can succeed', async () => {
    let attempts = 0;
    const prompter = fixture(async () => { if (++attempts === 1) throw new Error('temporary disconnect'); return '```await skills.wait(bot, 1);```'; });
    await assert.rejects(prompter.promptCoding([]), /temporary disconnect/);
    assert.equal(prompter.awaiting_coding, false);
    assert.match(await prompter.promptCoding([]), /skills.wait/);
    assert.equal(attempts, 2);
});

test('coding bounds history, supplies the execution contract and forwards a finite API deadline', async () => {
    let request;
    const prompter = fixture(async (...args) => { request = args; return 'code'; });
    await prompter.promptCoding(Array.from({ length: 30 }, () => ({ role: 'user', content: 'x'.repeat(3000) })), 1000);
    assert.ok(request[0].reduce((n, m) => n + m.content.length, 0) <= 12000);
    assert.match(request[1], /No raw bot methods/);
    assert.equal(request[3].timeout, 1000);
    assert.equal(request[3].maxRetries, 0);
    assert.equal(prompter.awaiting_coding, false);
});

test('a nonresponsive code provider is bounded and permits a later attempt', async () => {
    let signal;
    const prompter = fixture(async (_turns, _prompt, _stop, options) => {
        signal = options.signal; return new Promise(() => {});
    });
    await assert.rejects(prompter.promptCoding([], 20), /timed out/);
    assert.equal(signal.aborted, true);
    assert.equal(prompter.awaiting_coding, false);
});
