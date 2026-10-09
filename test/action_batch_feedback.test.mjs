import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture({ discard = false, advanceMs = 0, interrupted = false, equip = true } = {}) {
    const calls = { skills: [], prompts: 0, history: [], starts: [] };
    let now = 1000000;
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        Date: class extends Date { static now() { return now; } }, setTimeout, clearTimeout,
        process: { env: { DEBUG_CHAT: '0' } },
        settings: { max_commands: 3, show_command_syntax: 'none', allow_insecure_coding: true },
        skills: {
            discardAway: async (_bot, name) => { calls.skills.push(name); now += advanceMs; return discard; },
            equip: async (_bot, name) => { calls.skills.push(name); return equip; },
            goToPosition: async () => false, goToSurface: async () => false,
            pillarUp: async () => false, digDown: async () => false, customSkill: async () => false,
            craftRecipeLocal: async () => false, placeBlockNearby: async () => false,
            putInChest: async () => false, takeFromChest: async () => false,
        },
        queryList: [{ name: '!inventory', perform: async () => 'fresh inventory' }],
        getItemId: () => 1, getBlockId: () => 1,
        wsServer: { hasGameInformationClient: () => false, markChatTaskComplete() {} },
        convoManager: { isOtherAgent: () => false, responseScheduledFor: () => false },
        handleEnglishTranslation: async text => text,
    });
    for (const file of ['../src/agent/commands/actions.js', '../src/agent/commands/index.js', '../src/agent/agent.js']) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8')
            .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
        vm.runInContext(source, context);
    }
    const { Agent, executeCommand } = vm.runInContext('({ Agent, executeCommand })', context);
    const agent = Object.create(Agent.prototype);
    Object.assign(agent, {
        name: 'ag_NEKO', _missionEnabled: false, supervised_skill: false, shut_up: false,
        bot: { modes: { flushBehaviorLog: () => '' } },
        actions: { runAction: async (name, fn) => {
            calls.starts.push(name); await fn();
            return { success: true, message: 'Action output: internal warning Failed once; navigation recovered.',
                interrupted, timedout: false };
        } },
        history: { add: (role, content) => calls.history.push({ role, content }),
            save() {}, getHistory: () => calls.history },
        self_prompter: { isActive: () => false, isStopped: () => true, shouldInterrupt: () => false,
            handleUserPromptedCmd() {} },
        _adminMultiCmdActive: () => true, blocked_actions: [],
        routeResponse() {}, checkTaskDone: async () => {},
    });
    const replies = ['!discard("rotten_flesh", 7)\n!equip("stone_pickaxe")', '!inventory'];
    agent.prompter = { promptConvo: async () => { calls.prompts++; return replies.shift() || '!inventory'; } };
    return { agent, calls, execute: text => executeCommand(agent, text),
        setReplies: values => replies.splice(0, replies.length, ...values),
        setBatchMax: value => { context.process.env.MC_ADMIN_MULTICMD_MAX = value; } };
}

test('discard false reaches the model as explicit action failure instead of navigation success', async () => {
    const f = fixture();
    assert.match(await f.execute('!discard("rotten_flesh", 7)'), /^Action failed:/);
});

test('exhausted code attempts are explicit action failure, even with a nonempty error result', async () => {
    const f = fixture();
    f.agent.coder = { generateCode: async () => 'Code generation failed after 3 attempts.' };
    assert.match(await f.execute('!newAction("offline fixture")'), /^Action failed: Code generation failed/);
});

test('successful code execution preserves its actual receipt and private output', async () => {
    const f = fixture();
    f.agent.coder = { generateCode: async () => 'Agent wrote this code:\nCode Output: crafted one pickaxe.' };
    assert.match(await f.execute('!newAction("offline fixture")'), /^Agent wrote this code:/);
});

for (const command of ['!equip("stone_pickaxe")', '!goToCoordinates(1, 65, 2, 1)',
    '!goToSurface', '!pillarUp(67)', '!digDown(1)', '!smeltIron(1)',
    '!craftRecipe("stone_pickaxe", 1)', '!placeHere("crafting_table")',
    '!putInChest("cobblestone", 64)', '!takeFromChest("cobblestone", 64)']) {
    test(`explicit false from ${command} survives the real command wrapper`, async () => {
        const f = fixture({ equip: false });
        assert.match(await f.execute(command), /^Action failed:/);
    });
}

test('a failed discard skips the dependent batch and gets a fresh model decision', async () => {
    const f = fixture();
    await f.agent.handleMessage('system', '清理背包', 2);
    assert.deepEqual(f.calls.skills, ['rotten_flesh']);
    assert.equal(f.calls.prompts, 2);
    assert(f.calls.history.some(turn => /Batch stopped/.test(turn.content)));
    assert(f.calls.history.some(turn => /^Action failed:/.test(turn.content)));
    assert(f.calls.history.some(turn => turn.content === 'fresh inventory'));
});

test('internal warnings in a successful skill do not falsely abort the batch', async () => {
    const f = fixture({ discard: true });
    await f.agent.handleMessage('system', '清理背包', 1);
    assert.deepEqual(f.calls.skills, ['rotten_flesh', 'stone_pickaxe']);
});

test('a completed healthy action exceeding the batch budget yields before the next command', async () => {
    const f = fixture({ discard: true, advanceMs: 31000 });
    await f.agent.handleMessage('system', '清理背包', 2);
    assert.deepEqual(f.calls.skills, ['rotten_flesh']);
    assert.equal(f.calls.prompts, 2);
    assert(f.calls.history.some(turn => /Batch stopped.*budget/.test(turn.content)));
});

test('invalid arguments skip dependent commands without starting a body action', async () => {
    const f = fixture({ discard: true });
    f.setReplies(['!discard("rotten_flesh", "bad")\n!equip("stone_pickaxe")']);
    await f.agent.handleMessage('system', '清理背包', 1);
    assert.deepEqual(f.calls.starts, []);
    assert(f.calls.history.some(turn => /Batch stopped/.test(turn.content)));
});

test('actual interruption does not immediately start another model or body action', async () => {
    const f = fixture({ interrupted: true });
    await f.agent.handleMessage('system', '清理背包', 2);
    assert.deepEqual(f.calls.skills, ['rotten_flesh']);
    assert.equal(f.calls.prompts, 1);
});

test('default fixed batches are short while explicit existing limits remain configurable', () => {
    const f = fixture();
    assert.equal(f.agent._adminMultiCmdMax(), 3);
    f.setBatchMax('2');
    assert.equal(f.agent._adminMultiCmdMax(), 2);
    f.setBatchMax('bad');
    assert.equal(f.agent._adminMultiCmdMax(), 3);
});

test('a successful long command list executes only the default first three commands', async () => {
    const f = fixture();
    f.setReplies([Array(5).fill('!equip("stone_pickaxe")').join('\n')]);
    await f.agent.handleMessage('system', '拿好镐', 1);
    assert.equal(f.calls.skills.length, 3);
    assert(f.calls.history.some(turn => /Only the first 3 commands ran/.test(turn.content)));
});
