import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

async function gather(before, after, returned) {
    let items = before;
    const logs = [];
    const context = vm.createContext({
        skills: {
            customSkill: async () => { items = after; return returned; },
            log: (_, text) => logs.push(text),
        },
    });
    const source = readFileSync(new URL('../src/agent/commands/actions.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, context);
    const action = vm.runInContext("actionsList.find(a => a.name === '!getWood')", context);
    const agent = {
        bot: { inventory: { items: () => items } },
        actions: { runAction: async (_, fn) => {
            await fn();
            return { message: logs.join('\n'), interrupted: false, timedout: false };
        } },
    };
    return action.perform(agent, 1);
}

test('night/safety early exit cannot return an empty apparent wood success', async () => {
    const result = await gather([], [], 0);
    assert.match(result, /incomplete/i);
    assert.match(result, /gained 0/);
});

test('wood result uses actual inventory gain, never a claimed skill return value', async () => {
    const result = await gather([{ name: 'oak_log', count: 3 }], [{ name: 'oak_log', count: 3 }], 99);
    assert.match(result, /incomplete/i);
    assert.match(result, /gained 0/);
    assert.match(result, /total 3/);
});

test('actual log collection reports the measured gain', async () => {
    const result = await gather([], [{ name: 'birch_log', count: 1 }], 1);
    assert.match(result, /gained 1/);
    assert.doesNotMatch(result, /incomplete/i);
});
