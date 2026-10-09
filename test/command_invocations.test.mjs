import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prose = '连续无进展就用 !cannotComplete 返回具体证据。\n'
    + '或者先尝试 `!craftRecipe("stick", ...)`？没有 `!serverQuery` 的结果。\n'
    + '任务还没完成，不能 !endGoal。\n首先尝试获取木材。 !getWood(3)';

function fixture() {
    const calls = { performed: [], before: [], hooks: [], history: [], replies: [] };
    const action = (name, params) => ({ name, params, perform: async (_agent, ...args) => {
        calls.performed.push({ name, args }); return 'actual result';
    } });
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, Date, setTimeout, clearTimeout,
        process: { env: {} }, settings: { max_commands: 1, show_command_syntax: 'none' },
        actionsList: [action('!getWood', { num: { type: 'int', domain: [1, 1000] } }),
            action('!craftRecipe', { recipe: { type: 'ItemName' }, num: { type: 'int' } }),
            action('!cannotComplete', { reason: { type: 'string' } }), action('!endGoal')],
        queryList: [action('!inventory'), action('!stats'),
            action('!serverQuery', { command: { type: 'string' } })],
        getItemId: name => name === 'stick' ? 1 : null, getBlockId: () => null,
        wsServer: { hasGameInformationClient: () => false, markChatTaskComplete() {} },
        convoManager: { isOtherAgent: () => false, responseScheduledFor: () => false },
        handleEnglishTranslation: async text => text,
    });
    for (const file of ['../src/agent/commands/index.js', '../src/agent/agent.js']) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8')
            .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
        vm.runInContext(source, context);
    }
    const api = vm.runInContext('({ containsCommand, parseCommandStrings, parseCommandMessage, '
        + 'truncCommandMessage, truncCommandMessageMulti, executeCommand, getCommandDocs, Agent })', context);
    const agent = Object.create(api.Agent.prototype);
    Object.assign(agent, { name: 'ag_NEKO', _missionEnabled: false, supervised_skill: false, shut_up: false,
        bot: { modes: { flushBehaviorLog: () => '' } },
        history: { add: (role, content) => calls.history.push({ role, content }),
            save() {}, getHistory: () => [] },
        self_prompter: { isActive: () => false, isStopped: () => true, shouldInterrupt: () => false,
            handleUserPromptedCmd: (...args) => calls.hooks.push(args) },
        prompter: { promptConvo: async () => prose },
        _adminMultiCmdActive: () => true, _adminMultiCmdMax: () => 8, blocked_actions: [],
        routeResponse: (_source, reply) => calls.replies.push(reply), checkTaskDone: async () => {},
    });
    return { api, agent, calls };
}

test('reasoning references never precede the actual command selected for execution', () => {
    const { api } = fixture();
    assert.deepEqual([...api.parseCommandStrings(prose)], ['!getWood(3)']);
    assert.equal(api.containsCommand(prose), '!getWood');
    assert.equal(api.parseCommandMessage(prose).commandName, '!getWood');
});

test('malformed argument calls and required-argument bare references are skipped', () => {
    const { api } = fixture();
    assert.deepEqual([...api.parseCommandStrings('!craftRecipe("stick", ...)\n!getWood\n!getWood(3)')],
        ['!getWood(3)']);
});

test('bare zero-argument queries and standalone lifecycle commands remain available', () => {
    const { api } = fixture();
    assert.deepEqual([...api.parseCommandStrings('先看看 !inventory 再 !stats')], ['!inventory', '!stats']);
    assert.equal(api.containsCommand('!endGoal'), '!endGoal');
    assert.equal(api.containsCommand('!endGoal()'), '!endGoal');
    assert.equal(api.parseCommandMessage('!endGoal').args.length, 0);
});

test('quoted, reasoning-block and prose lifecycle mentions cannot end a mission', () => {
    const { api } = fixture();
    for (const message of ['不能 !endGoal；任务没有完成', '`!endGoal`', '"!endGoal"',
        '<think>!endGoal\n!getWood(9)</think>\n!inventory',
        '说明：!cannotComplete("无木材")\n!getWood(3)']) {
        assert(![...api.parseCommandStrings(message)].some(command => /!(endGoal|cannotComplete)/.test(command)), message);
    }
});

test('command tokens inside a reason string are not separate invocations', () => {
    const { api } = fixture();
    const command = '!cannotComplete("说明中的 !endGoal 不是命令")';
    assert.deepEqual([...api.parseCommandStrings(command)], [command]);
    assert.equal(api.parseCommandMessage(command).args[0], '说明中的 !endGoal 不是命令');
});

test('fenced examples and unfinished reasoning are never executed', () => {
    const { api } = fixture();
    for (const message of ['```text\n!endGoal\n```\n!inventory', '~~~\n!endGoal\n~~~\n!inventory']) {
        assert.deepEqual([...api.parseCommandStrings(message)], ['!inventory']);
    }
    for (const message of ['```text\n!endGoal', '~~~\n!getWood(3)', '<think>\n!endGoal\n!getWood(3)']) {
        assert.deepEqual([...api.parseCommandStrings(message)], []);
    }
});

test('generated command docs teach the lifecycle own-line syntax and avoid blocked controls', () => {
    const { api, agent } = fixture();
    assert.match(api.getCommandDocs(agent), /lifecycle controls.*!endGoal.*alone on their own line/);
    agent.blocked_actions = ['!endGoal', '!cannotComplete'];
    const rule = api.getCommandDocs(agent).split('\n').find(line => line.includes('Quoted/backtick'));
    assert.doesNotMatch(rule, /!endGoal|!cannotComplete/);
});

test('the active trial inherits lifecycle examples that execute under the documented grammar', () => {
    const { api } = fixture();
    const trial = JSON.parse(readFileSync(new URL('../profiles/neko-local-trial.json', import.meta.url), 'utf8'));
    const source = readFileSync(new URL('../src/models/prompter.js', import.meta.url), 'utf8');
    const constructor = source.slice(source.indexOf('    constructor(agent, profile) {'),
        source.indexOf('\n    getName()'));
    const context = vm.createContext({ readFileSync, path,
        __dirname: path.dirname(fileURLToPath(new URL('../src/models/prompter.js', import.meta.url))),
        settings: { base_profile: 'assistant' }, selectAPI: profile => profile,
        createModel: () => ({}), SkillLibrary: class {}, mkdirSync() {}, writeFileSync() {},
        console: { log() {} },
    });
    vm.runInContext(`class TrialPrompter {${constructor}};globalThis.TrialPrompter=TrialPrompter;`, context);
    const loaded = new context.TrialPrompter({}, trial).profile;
    const examples = loaded.conversation_examples.flat().filter(turn => turn.role === 'assistant'
        && /!(stop|goal|endGoal|cannotComplete)\b/.test(turn.content));
    assert(examples.length >= 4, 'the actual default goal/stop examples must be inherited');
    for (const example of examples) {
        assert(api.parseCommandStrings(example.content).some(command => /!(stop|goal|endGoal|cannotComplete)\b/.test(command)),
            example.content);
    }
    const stopExample = loaded.conversing.match(/instead say this: '(Sure, I'll stop\.[^']*)'/)?.[1];
    assert(stopExample, 'the active trial prompt still teaches the stop response');
    assert.equal(api.containsCommand(stopExample), '!stop');
});

test('all tracked positive lifecycle prompt examples use standalone command lines', () => {
    const { api } = fixture();
    for (const name of ['defaults/_default', 'andy-4-reasoning', 'neko-local-trial',
        'tasks/construction_profile', 'tasks/crafting_profile', 'tasks/cooking_profile']) {
        const profile = JSON.parse(readFileSync(new URL(`../profiles/${name}.json`, import.meta.url), 'utf8'));
        const example = profile.conversing.match(/instead say this: '(Sure, I'll stop\.[^']*)'/)?.[1];
        assert(example, name);
        assert.equal(api.containsCommand(example), '!stop', name);
    }
});

test('truncation uses the same actionable invocation boundaries as execution', () => {
    const { api } = fixture();
    const message = prose + '\n任务结束前不能 !endGoal。';
    assert.equal(api.truncCommandMessage(message), prose);
    assert.equal(api.truncCommandMessageMulti(message), prose);
});

test('validation runs before any caller-provided goal interruption hook', async () => {
    const { api, agent, calls } = fixture();
    const invalid = await api.executeCommand(agent, '!getWood("abc")', () => calls.before.push('stopped'));
    assert.match(invalid, /must be of type int/);
    assert.deepEqual(calls.before, []);
    assert.deepEqual(calls.performed, []);
    await api.executeCommand(agent, '!getWood(3)', () => calls.before.push('valid'));
    assert.deepEqual(calls.before, ['valid']);
    assert.equal(calls.performed[0].name, '!getWood');
});

test('agent dispatches only the real trailing action without stopping for prose references', async () => {
    const { agent, calls } = fixture();
    assert.equal(await agent.handleMessage('admin', '获取木材'), true);
    assert.deepEqual(calls.performed.map(call => call.name), ['!getWood']);
    assert.equal(calls.hooks.length, 1);
    assert(!calls.history.some(item => /given 0 args/.test(item.content)));
});

for (const batch of [false, true]) test(`display prefix follows the selected invocation in ${batch ? 'batch' : 'single'} mode`, async () => {
    const { agent, calls } = fixture();
    const prefix = '不要照搬 `!getWood(3)`；实际行动如下。';
    agent._adminMultiCmdActive = () => batch;
    agent.prompter.promptConvo = async () => `${prefix}\n!getWood(3)${batch ? '\n!inventory' : ''}`;
    await agent.handleMessage('admin', '获取木材');
    assert.equal(calls.replies[0], prefix);
    assert.equal(calls.performed[0].name, '!getWood');
});

for (const batch of [false, true]) test(`invalid action never stops a goal in ${batch ? 'batch' : 'single'} mode`, async () => {
    const { agent, calls } = fixture();
    agent._adminMultiCmdActive = () => batch;
    agent.prompter.promptConvo = async () => batch ? '!getWood("abc")\n!inventory' : '!getWood("abc")';
    await agent.handleMessage('admin', '获取木材');
    assert.equal(calls.hooks.filter(([, action]) => action).length, 0);
    assert(!calls.performed.some(call => call.name === '!getWood'));
});
