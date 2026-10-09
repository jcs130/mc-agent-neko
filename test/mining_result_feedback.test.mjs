import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

async function mine(ore, before, after, { returned = false, emptySlots = 3, interrupted = false } = {}) {
    let items = before;
    const logs = [], calls = [];
    const context = vm.createContext({ skills: {
        customSkill: async (bot, name, options) => {
            calls.push({ name, ore: options.ore });
            items = after;
            bot.interrupt_code = interrupted;
            return returned;
        },
        log: (_, text) => logs.push(text),
    } });
    const source = readFileSync(new URL('../src/agent/commands/actions.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, context);
    const action = vm.runInContext("actionsList.find(a => a.name === '!mineOres')", context);
    const bot = { health: 20, inventory: { items: () => items, emptySlotCount: () => emptySlots } };
    const agent = { bot, actions: { runAction: async (_, fn) => {
        await fn();
        return { message: logs.join('\n'), interrupted: !!bot.interrupt_code, timedout: false };
    } } };
    return { output: await action.perform(agent, ore), logs: logs.join('\n'), calls };
}

for (const [ore, drop] of Object.entries({
    iron: 'raw_iron', copper: 'raw_copper', gold: 'raw_gold', coal: 'coal', diamonds: 'diamond',
})) {
    test(`${ore} mining exposes measured ${drop} gains after the skill finishes`, async () => {
        const result = await mine(ore,
            [{ name: drop, count: 4 }, { name: 'stone', count: 100 }],
            [{ name: drop, count: 7 }, { name: drop, count: 15 }, { name: 'stone', count: 120 }],
            { returned: { ore, gained: 18 } });
        assert.match(result.output, /verified/i);
        assert.match(result.output, new RegExp(`gained 18 ${drop}`));
        assert.match(result.output, /total 22/);
        assert.deepEqual(result.calls, [{ name: 'mineOres', ore }]);
    });
}

test('a claimed successful skill result cannot invent inventory gains', async () => {
    const result = await mine('copper', [{ name: 'raw_copper', count: 24 }],
        [{ name: 'raw_copper', count: 24 }], { returned: { ore: 'copper', gained: 100 } });
    assert.match(result.output, /no progress/i);
    assert.match(result.output, /gained 0 raw_copper/);
    assert.match(result.output, /total 24/);
    assert.doesNotMatch(result.output, /verified/i);
});

test('a full inventory no-op identifies the blocker and discourages unchanged retries', async () => {
    const result = await mine('copper', [], [], { emptySlots: 0 });
    assert.match(result.output, /no progress/i);
    assert.match(result.output, /inventory.*full/i);
    assert.match(result.output, /0 empty slots/);
    assert.match(result.output, /recover|space|another.*goal/i);
});

test('partial gains are reported without claiming the default stockpile is complete', async () => {
    const result = await mine('iron', [], [{ name: 'raw_iron', count: 3 }],
        { returned: { ore: 'iron', gained: 3 } });
    assert.match(result.output, /partial/i);
    assert.match(result.output, /gained 3 raw_iron/);
    assert.doesNotMatch(result.output, /verified/i);
});

test('interruption retains an honest measured summary without reporting completed mining', async () => {
    const result = await mine('copper', [], [{ name: 'raw_copper', count: 18 }],
        { returned: { ore: 'copper', gained: 18 }, interrupted: true });
    assert.equal(result.output, undefined, 'the existing action cancellation contract is preserved');
    assert.match(result.logs, /interrupted/i);
    assert.match(result.logs, /gained 18 raw_copper/);
    assert.doesNotMatch(result.logs, /verified/i);
});
