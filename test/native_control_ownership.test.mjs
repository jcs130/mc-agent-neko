import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture({ owner = true, managed = false, translate = async text => text } = {}) {
    const calls = { prompts: 0, commands: [], replies: [], finishes: [] };
    const state = { owner };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, Date, setTimeout, clearTimeout,
        process: { env: { DEBUG_CHAT: '0' } }, settings: { max_commands: 1, show_command_syntax: 'full',
            external_autonomy_owner: managed ? 'neko' : null },
        wsServer: { hasGameInformationClient: () => state.owner, beginMissionTask() {},
            finishMission: (...args) => calls.finishes.push(args), markChatTaskComplete() {} },
        convoManager: { isOtherAgent: () => false, responseScheduledFor: () => false },
        handleEnglishTranslation: translate,
        containsCommand: text => /![A-Za-z_]\w*/.exec(text)?.[0] || null,
        commandInvocationIndex: text => /![A-Za-z_]\w*/.exec(text)?.index ?? -1,
        commandFormatFeedback: () => null,
        commandExists: () => true, isAction: () => true, truncCommandMessage: text => text,
        executeCommand: async (_agent, text) => { calls.commands.push(text); return 'complete'; },
    });
    for (const file of ['../src/agent/agent.js', '../src/agent/admin_mission.js']) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8')
            .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
        vm.runInContext(source, context);
    }
    const Agent = vm.runInContext('Agent', context), Mission = vm.runInContext('AdminMission', context);
    const agent = Object.create(Agent.prototype), history = [];
    Object.assign(agent, { name: 'ag_NEKO', _missionEnabled: true, supervised_skill: false, shut_up: false,
        bot: { modes: { flushBehaviorLog: () => '' } }, actions: { executing: false },
        history: { add: (role, content) => history.push({ role, content }), save() {}, getHistory: () => history },
        self_prompter: { interrupt: false, isActive: () => false, isStopped: () => true,
            shouldInterrupt(self) { return self && this.interrupt; }, handleUserPromptedCmd() {},
            async stop() { this.interrupt = false; }, start() {} },
        prompter: { promptConvo: async () => { calls.prompts++; return '!digDown(10)'; } },
        requestInterrupt() {}, checkTaskDone: async () => {}, _adminMultiCmdActive: () => false,
        routeResponse: (_source, text) => calls.replies.push(text),
    });
    agent.adminMission = new Mission(agent);
    const begin = () => agent.adminMission._handoff({ text: '挖竖井找铁', taskId: 'current', origin: 'ws' });
    return { agent, mission: agent.adminMission, calls, state, begin,
        nativeInterrupt: () => Agent.prototype.requestInterrupt.call(agent) };
}

test('native interruption invalidates the actual chopWood generation even if a recovery path clears its flag', () => {
    const f = fixture(), stopped = [];
    Object.assign(f.agent.bot, { _chopGen: 7, stopDigging: () => stopped.push('dig'),
        collectBlock: { cancelTask: () => stopped.push('collect') },
        pathfinder: { stop: () => stopped.push('path') }, pvp: { stop: () => stopped.push('pvp') } });
    // Exercise the cancellation guard from the real long-running skill, rather than
    // duplicating its logic in this test. That guard survives interrupt_code resets.
    const source = readFileSync(new URL('../bots/_supervisor/skills/chopWood.js', import.meta.url), 'utf8');
    const declaration = source.split('\n').find(line => line.includes('const _superseded ='));
    assert(declaration, 'the skill must expose its existing generation guard');
    const oldRun = vm.runInNewContext(`(bot => { const _gen = bot._chopGen; ${declaration}\n return _superseded; })`)(f.agent.bot);
    assert.equal(oldRun(), false);
    f.nativeInterrupt();
    f.agent.bot.interrupt_code = false; // recovery can clear the transient flag
    assert.equal(oldRun(), true, 'the old chopWood stack must remain cancelled');
    assert.deepEqual(stopped, ['dig', 'collect', 'path', 'pvp']);
});

test('an interrupted dig throwing cannot prevent the rest of the body from stopping', () => {
    const f = fixture(), stopped = [];
    Object.assign(f.agent.bot, { _chopGen: 7, stopDigging() { throw new Error('dig already aborted'); },
        collectBlock: { cancelTask: () => stopped.push('collect') },
        pathfinder: { stop: () => stopped.push('path') }, pvp: { stop: () => stopped.push('pvp') } });
    assert.doesNotThrow(f.nativeInterrupt);
    assert.equal(f.agent.bot.interrupt_code, true);
    assert.deepEqual(stopped, ['collect', 'path', 'pvp']);
});

test('external Neko ownership rejects orphan native system prompts between skills', async () => {
    const f = fixture();
    const result = await f.agent.handleMessage('system', '(AUTO MESSAGE) previous mobility was interrupted; respond accordingly.');
    assert.equal(result, false);
    assert.equal(f.calls.prompts, 0);
    assert.deepEqual(f.calls.commands, []);
});

test('bot-originated native prompts also yield to Neko ownership', async () => {
    const f = fixture();
    assert.equal(await f.agent.handleMessage('ag_NEKO', 'Continue the old goal.'), false);
    assert.equal(f.calls.prompts, 0);
});

test('explicit admin commands remain available while Neko owns autonomy', async () => {
    const f = fixture();
    assert.equal(await f.agent.handleMessage('admin', '!stop'), true);
    assert.deepEqual(f.calls.commands, ['!stop']);
});

test('standalone native autonomy remains available', async () => {
    const f = fixture({ owner: false });
    assert.equal(await f.agent.handleMessage('system', 'Continue mining.'), true);
    assert.equal(f.calls.commands.length, 1);
});

test('configured Neko ownership blocks native prompts before the plugin connects', async () => {
    const f = fixture({ owner: false, managed: true });
    assert.equal(await f.agent.handleMessage('system', 'Continue mining.'), false);
    assert.equal(f.calls.prompts, 0);
    assert.deepEqual(f.calls.commands, []);
});

test('configured ownership still allows explicit tasks before the plugin connects', async () => {
    const f = fixture({ owner: false, managed: true });
    assert.equal(await f.agent.handleMessage('admin', '!stop'), true);
    assert.deepEqual(f.calls.commands, ['!stop']);
});

test('current Neko mission may still run its native self-prompt commands', async () => {
    const f = fixture(); f.begin();
    assert.equal(await f.agent.handleMessage('system', 'Continue the active mining mission.'), true);
    assert.equal(f.calls.commands.length, 1);
});

test('ending a mission invalidates an already pending model response even after loop stop clears interrupt', async () => {
    const f = fixture(); f.begin();
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    f.agent.prompter.promptConvo = () => { started(); return new Promise(resolve => { release = resolve; }); };
    const pending = f.agent.handleMessage('system', 'Continue the old mining mission.');
    await ready;
    const epoch = f.mission._epoch;
    await f.mission.end('deadline');
    assert(f.mission._epoch > epoch, 'end must invalidate the old generation synchronously');
    assert.equal(f.agent.self_prompter.interrupt, false, 'the loop teardown has finished');
    release('继续挖竖井。!digDown(10)');
    assert.equal(await pending, false);
    assert.deepEqual(f.calls.commands, []);
    assert.deepEqual(f.calls.replies, [], 'stale narration must not reach even the local UI');
});

test('a controller taking ownership while the model thinks cancels a standalone reply', async () => {
    const f = fixture({ owner: false });
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    f.agent.prompter.promptConvo = () => { started(); return new Promise(resolve => { release = resolve; }); };
    const pending = f.agent.handleMessage('system', 'Continue mining.');
    await ready; f.state.owner = true; release('!digDown(10)');
    assert.equal(await pending, false);
    assert.deepEqual(f.calls.commands, []);
    assert.deepEqual(f.calls.replies, []);
});

test('a supervised body skill starting during the model await cancels native execution', async () => {
    const f = fixture(); f.begin();
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    f.agent.prompter.promptConvo = () => { started(); return new Promise(resolve => { release = resolve; }); };
    const pending = f.agent.handleMessage('system', 'Continue mining.');
    await ready; f.agent.supervised_skill = 'ws'; release('!digDown(10)');
    assert.equal(await pending, false);
    assert.deepEqual(f.calls.commands, []);
});

test('authority is rechecked after input translation before spending a model call', async () => {
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const f = fixture({ owner: false, translate: () => { started(); return new Promise(resolve => { release = resolve; }); } });
    const pending = f.agent.handleMessage('system', 'Continue mining.');
    await ready; f.state.owner = true; release('Continue mining.');
    assert.equal(await pending, false);
    assert.equal(f.calls.prompts, 0);
    assert.deepEqual(f.calls.commands, []);
});

test('body preemption returns an explicit failure and never clears the running owner', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const f = fixture(); f.agent.supervised_skill = 'kernel'; f.agent.bot._currentSkill = 'chopWood';
    const pending = f.mission._preemptBody(100);
    t.mock.timers.tick(150);
    assert.equal(await pending, false);
    assert.equal(f.agent.supervised_skill, 'kernel');
    assert.equal(f.agent.bot._currentSkill, 'chopWood');
});

test('body preemption also waits for an ordinary live action and reports success only after release', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const f = fixture(); f.agent.actions.executing = true;
    const pending = f.mission._preemptBody(100);
    t.mock.timers.tick(150);
    assert.equal(await pending, false);
    f.agent.actions.executing = false;
    assert.equal(await f.mission._preemptBody(100), true);
});

for (const failure of ['timeout', 'error']) test(`mission ${failure} during body handoff never starts overlapping work`, async () => {
    const f = fixture(), mine = f.begin(); let starts = 0;
    f.agent.handleMessage = async () => { starts++; };
    f.mission._preemptBody = async () => { if (failure === 'error') throw new Error('old skill could not release'); return false; };
    await f.mission._drive(mine);
    assert.equal(starts, 0);
    assert.equal(f.mission.isActive(), false);
    assert.equal(f.calls.finishes.length, 1);
    assert.equal(f.calls.finishes[0][1], 'interrupted');
    assert.match(f.calls.finishes[0][2], /handoff|交接|退出|控制/);
});

test('a late rejected handoff cannot end the replacement mission', async () => {
    const f = fixture(), old = f.begin(); let release;
    f.mission._preemptBody = () => new Promise(resolve => { release = resolve; });
    const pending = f.mission._drive(old);
    const next = f.mission._handoff({ text: '新任务', taskId: 'replacement', origin: 'ws' });
    release(false); await pending;
    assert.equal(f.mission.mission, next);
    assert.equal(f.mission.isActive(), true);
    assert.equal(f.calls.finishes.length, 1, 'only the superseded mission is completed');
});

test('a released body starts the current mission and its persistent loop normally', async () => {
    const f = fixture(), mine = f.begin(); let starts = 0;
    f.agent.handleMessage = async () => { starts++; };
    await f.mission._drive(mine);
    assert.equal(starts, 1);
    assert.equal(f.mission.isActive(), true);
    assert.equal(mine.initialTurnPending, false);
    assert.equal(f.agent.self_prompter.owner, f.mission);
    assert.equal(f.calls.finishes.length, 0);
});
