import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { playerInventorySlots } from '../src/agent/library/inventory_snapshot.js';
import { closeMenu, clickMenuSlot } from '../src/agent/library/menus.js';

function harness(perform = async () => '生命 20/20；魔力 20/20；技能点 6', actions = []) {
    const finishes = [];
    const context = vm.createContext({
        console, Date, setTimeout, clearTimeout, playerInventorySlots, process: { env: { DEBUG_CHAT: '0' } },
        wsServer: { beginMissionTask() {}, finishMission: (...args) => finishes.push(args) },
        queryList: [{ name: '!readBook', params: { slot: { type: 'int' } }, perform },
            { name: '!stats', perform }],
        actionsList: [{ name: '!endGoal', perform: async agent => {
            await agent.adminMission.end('done');
            return 'Mission complete.';
        } }, { name: '!cannotComplete', params: { reason: { type: 'string' } }, perform: async (agent, reason) => {
            await agent.adminMission.end('impossible', reason);
            return 'Marked the task as impossible.';
        } }, ...actions],
    });
    for (const relative of ['../src/agent/admin_mission.js', '../src/agent/commands/index.js']) {
        const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
            .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
        vm.runInContext(source, context);
    }
    const agent = { _missionEnabled: true, bot: {}, requestInterrupt() {}, name: 'Neko',
        self_prompter: { stop: async () => {} }, history: { getHistory: () => [] } };
    const Mission = vm.runInContext('AdminMission', context);
    agent.adminMission = new Mission(agent);
    const execute = vm.runInContext('executeCommand', context);
    return { agent, mission: agent.adminMission, finishes, execute };
}

function failedActionHarness() {
    let result = 'Action failed: !testTrade did not complete successfully.\nNot enough payment items. No trade executed.';
    const h = harness(undefined, [{ name: '!testTrade', params: { index: { type: 'int' } }, perform: () => result },
        { name: '!testSuccess', perform: () => 'Action output: completed a healthy wait.' }]);
    h.agent.bot.entity = { position: { x: 1, y: 64, z: 2 } };
    h.agent.bot.inventory = { slots: Array(46).fill(null) };
    h.agent.bot.inventory.slots[9] = { name: 'iron_ingot', count: 7 };
    h.agent.bot.health = h.agent.bot.food = 20;
    h.mission._handoff({ text: '找到合适的交易', taskId: 'failed-action', origin: 'ws' });
    return { ...h, setResult: value => { result = value; } };
}

function menuFailureHarness() {
    const h = harness(undefined, [
        { name: '!closeWindow', params: { id: { type: 'int' } }, perform: (agent, id) => closeMenu(agent.bot, id) },
        { name: '!clickWindow', params: { id: { type: 'int' }, slot: { type: 'int' } },
            perform: (agent, id, slot) => clickMenuSlot(agent.bot, id, slot) },
    ]);
    Object.assign(h.agent.bot, { entity: { position: { x: 1, y: 64, z: 2 } }, health: 20, food: 20,
        inventory: { slots: Array(46).fill(null) }, currentWindow: { id: 3, inventoryStart: 1, slots: [{ name: 'dirt', count: 1 }] },
        closeWindow: () => assert.fail('a stale close must never be submitted'),
        clickWindow: () => assert.fail('a stale click must never be submitted') });
    h.mission._handoff({ text: '检查实际菜单', taskId: 'menu-action', origin: 'ws' });
    return h;
}

function arrivalHarness() {
    let result = 'Action output:\nFound villager 1 blocks away.\nFound non-destructive path (success).\nYou have reached at 1, 64, 2.';
    const h = harness(undefined, [{ name: '!searchForEntity', params: {
        type: { type: 'string' }, range: { type: 'int' },
    }, perform: () => result }]);
    Object.assign(h.agent.bot, { entity: { position: { x: 1, y: 64, z: 2 } }, health: 20, food: 20,
        inventory: { slots: Array(46).fill(null) },
        entities: { 184: { id: 184, name: 'villager', position: { x: 2, y: 64, z: 2 } } } });
    h.mission._handoff({ text: '向实际村民询价', taskId: 'arrival', origin: 'ws' });
    return { ...h, setResult: value => { result = value; } };
}

test('repeated successful arrivals at the same measured NPC warn then hand back actual evidence', async () => {
    const h = arrivalHarness();
    const command = '!searchForEntity("villager", 255)';
    for (let i = 0; i < 2; i++) assert.doesNotMatch(await h.execute(h.agent, command, () => {}), /Repeated arrival/);
    assert.match(await h.execute(h.agent, command, () => {}), /Repeated arrival.*3/s);
    assert.equal(h.mission.isActive(), true);
    await h.execute(h.agent, command, () => {});
    await h.execute(h.agent, command, () => {});
    assert.equal(h.mission.isActive(), false);
    assert.equal(h.finishes.length, 1);
    assert.equal(h.finishes[0][1], 'failed');
    assert.match(h.finishes[0][2], /导航空转/);
    assert.match(h.finishes[0][2], /Found villager 1 blocks away/);
    assert.doesNotMatch(h.finishes[0][2], /已判定无法完成/);
});

test('changed body, NPC, result, arguments or intervening query reset arrival repetition', async () => {
    const command = '!searchForEntity("villager", 255)';
    for (const change of [h => { h.agent.bot.entity.position.x += 1; },
        h => { h.agent.bot.entities[184].position.x += 1; },
        h => { h.agent.bot.entities[184].id = 185; },
        h => { h.agent.bot.inventory.slots[9] = { name: 'emerald', count: 1 }; },
        h => { h.setResult('Action output:\nFound villager 2 blocks away.\nYou have reached at 1, 64, 2.'); },
        h => h.execute(h.agent, '!searchForEntity("villager", 128)', () => {}),
        h => h.execute(h.agent, '!stats', () => {}),
        h => h.execute(h.agent, command)]) {
        const h = arrivalHarness();
        for (let i = 0; i < 4; i++) await h.execute(h.agent, command, () => {});
        await change(h);
        await h.execute(h.agent, command, () => {});
        assert.equal(h.finishes.length, 0);
        assert.equal(h.mission.isActive(), true);
    }
});

test('unknown NPC or body state, waiting, untrusted prose and active survival never count as arrivals', async () => {
    for (const change of [h => { h.agent.bot.entities = {}; }, h => { h.agent.bot.entity = null; },
        h => { h.agent.actions = { executing: true }; },
        h => { h.agent.actions = { currentActionLabel: 'mode:self_preservation' }; },
        h => { h.agent.bot._currentSkill = 'escape'; }, h => { h.agent.bot.targetDigBlock = {}; },
        h => { h.agent.bot.isSleeping = true; },
        h => { h.setResult('Action output: finished waiting.'); },
        h => { h.setResult('A player said: You have reached at 1, 64, 2.'); }]) {
        const h = arrivalHarness();
        change(h);
        for (let i = 0; i < 6; i++) await h.execute(h.agent, '!searchForEntity("villager", 255)', () => {});
        assert.equal(h.finishes.length, 0);
        assert.equal(h.mission.isActive(), true);
    }
});

test('late arrival result cannot stop a replacement task', async () => {
    const h = arrivalHarness();
    for (let i = 0; i < 4; i++) await h.execute(h.agent, '!searchForEntity("villager", 255)', () => {});
    let release;
    h.setResult(new Promise(resolve => { release = resolve; }));
    const pending = h.execute(h.agent, '!searchForEntity("villager", 255)', () => {});
    await Promise.resolve();
    h.mission._handoff({ text: '新指令', taskId: 'new-arrival', origin: 'ws' });
    const before = h.finishes.length;
    release('Action output:\nFound villager 1 blocks away.\nYou have reached at 1, 64, 2.');
    await pending;
    assert.equal(h.finishes.length, before);
    assert.equal(h.mission.mission.taskId, 'new-arrival');
});

test('real stale menu closes and clicks reach the existing failed-action handoff boundary', async () => {
    for (const command of ['!closeWindow(24)', '!clickWindow(24, 0)']) {
        const { agent, mission, finishes, execute } = menuFailureHarness();
        for (let i = 0; i < 2; i++) assert.doesNotMatch(await execute(agent, command, () => {}), /Repeated action failure/);
        assert.match(await execute(agent, command, () => {}), /Repeated action failure.*3/s);
        assert.equal(mission.isActive(), true);
        await execute(agent, command, () => {});
        await execute(agent, command, () => {});
        assert.equal(mission.isActive(), false, 'rejected menu operations cannot keep the task alive indefinitely');
        assert.equal(finishes.length, 1);
        assert.equal(finishes[0][1], 'failed');
        assert.match(finishes[0][2], /current window ID=3/);
        assert.doesNotMatch(finishes[0][2], /已判定无法完成/);
    }
});

test('changed menus and successful cursor-safe closing break stale-action streaks', async () => {
    const { agent, mission, finishes, execute } = menuFailureHarness();
    for (let i = 0; i < 4; i++) await execute(agent, '!closeWindow(24)', () => {});
    agent.bot.currentWindow.id = 4;
    await execute(agent, '!closeWindow(24)', () => {});
    assert.equal(mission.mission.actionFailureLoop?.count, 1, 'current window changes reset the comparison');
    for (let i = 0; i < 3; i++) await execute(agent, '!closeWindow(24)', () => {});
    const window = agent.bot.currentWindow;
    window.selectedItem = { name: 'iron_sword', count: 1 };
    agent.bot.closeWindow = value => { assert.equal(value, window); agent.bot.currentWindow = null; };
    const result = await execute(agent, '!closeWindow(4)', () => {});
    assert.match(result, /^Submitted close/);
    assert.match(result, /CURSOR iron_sword/);
    assert.equal(window.selectedItem.count, 1, 'do not invent an inventory transfer');
    assert.equal(mission.mission.actionFailureLoop, null);
    assert.equal(finishes.length, 0);
    assert.equal(mission.isActive(), true);
});

test('identical completed model action failures warn then hand real evidence back without declaring the goal impossible', async () => {
    const { agent, mission, finishes, execute } = failedActionHarness();
    for (let i = 0; i < 2; i++) assert.doesNotMatch(await execute(agent, '!testTrade(0)', () => {}), /Repeated action failure/);
    assert.match(await execute(agent, '!testTrade(0)', () => {}), /Repeated action failure.*3/s);
    assert.equal(mission.isActive(), true, 'allow a changed plan after the warning');
    await execute(agent, '!testTrade(0)', () => {});
    await execute(agent, '!testTrade(0)', () => {});
    assert.equal(mission.isActive(), false);
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0][1], 'failed');
    assert.match(finishes[0][2], /动作空转/);
    assert.match(finishes[0][2], /Not enough payment items/);
    assert.doesNotMatch(finishes[0][2], /任务无法完成|已判定无法完成/);
});

test('changed measured state, arguments, outcomes and useful follow-up commands break the failed-action streak', async () => {
    const changes = [
        h => { h.agent.bot.inventory.slots[9].count++; },
        h => { h.agent.bot.entity.position.x += 1; },
        h => { h.agent.bot.health--; },
        h => { h.agent.bot.food--; },
        h => { h.agent.bot.game = { dimension: 'the_nether' }; },
        h => { h.setResult('Action failed: merchant moved away.'); },
        async h => { await h.execute(h.agent, '!stats', () => {}); },
        async h => { await h.execute(h.agent, '!testSuccess', () => {}); },
        async h => { await h.execute(h.agent, '!testTrade(1)', () => {}); },
        async h => { await h.execute(h.agent, '!testTrade(0)'); },
    ];
    for (const change of changes) {
        const h = failedActionHarness();
        for (let i = 0; i < 4; i++) await h.execute(h.agent, '!testTrade(0)', () => {});
        await change(h);
        await h.execute(h.agent, '!testTrade(0)', () => {});
        assert.equal(h.finishes.length, 0, 'new evidence or human authority must permit a fresh attempt');
        assert.equal(h.mission.isActive(), true);
    }
});

test('healthy long actions and live survival ownership are never interrupted by completed-failure accounting', async () => {
    const h = failedActionHarness();
    for (const busy of [() => { h.agent.actions = { executing: true }; },
        () => { h.agent.actions = { currentActionLabel: 'mode:self_preservation' }; },
        () => { h.agent.actions = {}; h.agent.bot._currentSkill = 'escape'; },
        () => { h.agent.bot._currentSkill = null; h.agent.bot.targetDigBlock = {}; }]) {
        busy();
        for (let i = 0; i < 6; i++) await h.execute(h.agent, '!testTrade(0)', () => {});
    }
    assert.equal(h.finishes.length, 0);
    h.agent.bot.targetDigBlock = null;
    for (let i = 0; i < 6; i++) await h.execute(h.agent, '!testSuccess', () => {});
    assert.equal(h.mission.isActive(), true, 'identical successful waits remain legitimate');
    let release;
    const long = harness(undefined, [{ name: '!longAction', perform: () => new Promise(resolve => { release = resolve; }) }]);
    long.mission._handoff({ text: '等待长动作', taskId: 'long', origin: 'ws' });
    const pending = long.execute(long.agent, '!longAction', () => {});
    await Promise.resolve();
    assert.equal(long.mission.isActive(), true, 'no timer or extra model request interrupts an unfinished action');
    assert.equal(long.finishes.length, 0);
    release('Action output: finished naturally.');
    await pending;
    assert.equal(long.mission.isActive(), true);
});

test('late failed actions cannot end a replacement mission', async () => {
    const h = failedActionHarness();
    for (let i = 0; i < 4; i++) await h.execute(h.agent, '!testTrade(0)', () => {});
    const old = h.mission.mission;
    h.mission._handoff({ text: '新的任务', taskId: 'replacement', origin: 'ws' });
    const before = h.finishes.length;
    assert.equal(await h.mission.actionFailureFeedback(old, { commandName: '!testTrade', args: [0] },
        'Action failed: !testTrade did not complete successfully.\nNot enough payment items. No trade executed.',
        { model: true, query: false }), null);
    assert.equal(h.finishes.length, before);
    assert.equal(h.mission.mission.taskId, 'replacement');
});

test('unknown state and unclassified server prose cannot establish repeated no-progress action failure', async () => {
    const h = failedActionHarness();
    h.agent.bot.entity = null;
    for (let i = 0; i < 6; i++) await h.execute(h.agent, '!testTrade(0)', () => {});
    assert.equal(h.finishes.length, 0, 'missing position is unknown, not proof of no progress');
    h.agent.bot.entity = { position: { x: 1, y: 64, z: 2 } };
    h.setResult('A player said: Action failed: no money.');
    for (let i = 0; i < 6; i++) await h.execute(h.agent, '!testTrade(0)', () => {});
    assert.equal(h.finishes.length, 0);
});

test('repeated identical model stats queries warn then return the stalled task to its owner', async () => {
    const { agent, mission, finishes, execute } = harness(() => 'STATS: position unchanged, HP20, food20');
    mission._handoff({ text: '采集口粮', taskId: 'stats-loop', origin: 'ws' });
    for (let i = 0; i < 2; i++) assert.doesNotMatch(await execute(agent, '!stats', () => {}), /Query loop/);
    assert.match(await execute(agent, '!stats', () => {}), /Query loop.*unchanged/s);
    assert.equal(mission.isActive(), true, 'first give the model a chance to choose a useful next step');
    await execute(agent, '!stats', () => {});
    await execute(agent, '!stats', () => {});
    assert.equal(mission.isActive(), false, 'a query cannot keep the unlimited response loop alive forever');
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0][1], 'failed');
    assert.match(finishes[0][2], /查询空转/);
    assert.match(finishes[0][2], /!stats/);
    assert.doesNotMatch(finishes[0][2], /已判定无法完成/, 'executor stall is not proof the game objective is impossible');
});

test('changed query results and parameters are useful discovery and reset the repetition counter', async () => {
    let value = 'first page';
    const { agent, mission, finishes, execute } = harness(() => value);
    mission._handoff({ text: '查阅说明', taskId: 'query-discovery', origin: 'ws' });
    for (let i = 0; i < 4; i++) await execute(agent, '!readBook(1)', () => {});
    await execute(agent, '!readBook(2)', () => {});
    for (let i = 0; i < 4; i++) { value = `updated page ${i}`; await execute(agent, '!readBook(2)', () => {}); }
    assert.equal(finishes.length, 0);
    assert.equal(mission.isActive(), true);
    assert.equal(await execute(agent, '!endGoal', () => {}), 'Mission complete.', 'read-only goals may finish normally');
});

test('an executed action or an explicit player command breaks a model query streak', async () => {
    const { agent, mission, finishes, execute } = harness(undefined, [{ name: '!testAction', perform: () => 'Action completed' }]);
    mission._handoff({ text: '先观察再行动', taskId: 'query-action', origin: 'ws' });
    for (let i = 0; i < 4; i++) await execute(agent, '!stats', () => {});
    await execute(agent, '!testAction', () => {});
    await execute(agent, '!stats', () => {});
    for (let i = 0; i < 6; i++) await execute(agent, '!stats');
    assert.equal(finishes.length, 0, 'manual status checks retain their authority');
    assert.equal(mission.isActive(), true);
});

test('query replies cannot end a legitimate long action, wait, dig or survival reflex', async () => {
    const { agent, mission, finishes, execute } = harness();
    mission._handoff({ text: '等待采集完成', taskId: 'busy-queries', origin: 'ws' });
    for (const busy of [() => { agent.actions = { executing: true }; },
        () => { agent.actions = { currentActionLabel: 'mode:self_preservation' }; },
        () => { agent.actions = {}; agent.bot.targetDigBlock = {}; }]) {
        busy();
        for (let i = 0; i < 6; i++) await execute(agent, '!stats', () => {});
    }
    assert.equal(finishes.length, 0);
    assert.equal(mission.isActive(), true);
});

test('model cannot finish a fresh task before any game result or measured change', async () => {
    const { agent, mission, finishes, execute } = harness();
    mission._handoff({ text: '存入泥土', taskId: 'unobserved', origin: 'ws' });
    let interrupts = 0;
    const result = await execute(agent, '!endGoal', () => { interrupts++; });
    assert.match(result, /Action not started:.*endGoal/);
    assert.match(result, /current task.*(?:observation|result)/i);
    assert.equal(interrupts, 0, 'rejection must precede the lifecycle interruption callback');
    assert.equal(finishes.length, 0);
    assert.equal(mission.isActive(), true);
});

test('a read-only task can finish after receiving its actual query result', async () => {
    const { agent, mission, finishes, execute } = harness();
    mission._handoff({ text: '读书', taskId: 'observed', origin: 'ws' });
    await execute(agent, '!readBook(-1)');
    let interrupts = 0;
    assert.equal(await execute(agent, '!endGoal', () => { interrupts++; }), 'Mission complete.');
    assert.equal(interrupts, 1);
    assert.equal(finishes.length, 1);
    assert.match(finishes[0][2], /技能点 6/);
});

test('old or late query results do not authorize finishing a replacement task', async () => {
    let release;
    const { agent, mission, finishes, execute } = harness(() => new Promise(resolve => { release = resolve; }));
    mission._handoff({ text: '旧查询', taskId: 'old-proof', origin: 'ws' });
    const pending = execute(agent, '!readBook(-1)');
    mission._handoff({ text: '新存储任务', taskId: 'new-proof', origin: 'ws' });
    release('Old task data');
    await pending;
    const count = finishes.length;
    assert.match(await execute(agent, '!endGoal', () => assert.fail('must not interrupt')), /Action not started:/);
    assert.equal(finishes.length, count);
    assert.equal(mission.mission.taskId, 'new-proof');
});

test('a measured inventory change permits reporting without requiring a redundant query', async () => {
    const { agent, mission, finishes, execute } = harness();
    agent.bot.entity = { position: {} };
    agent.bot.inventory = { slots: Array(46).fill(null) };
    mission._handoff({ text: '拾取木棍', taskId: 'measured', origin: 'ws' });
    agent.bot.inventory.slots[10] = { name: 'stick', count: 1 };
    assert.equal(await execute(agent, '!endGoal', () => {}), 'Mission complete.');
    assert.match(finishes[0][2], /stick.*before.*0.*now.*1/);
});

test('an explicit user lifecycle command retains its termination authority', async () => {
    const { agent, mission, finishes, execute } = harness();
    mission._handoff({ text: '仍可由玩家结束', taskId: 'human-end', origin: 'ws' });
    assert.equal(await execute(agent, '!endGoal'), 'Mission complete.');
    assert.equal(finishes.length, 1);
    assert.equal(mission.isActive(), false);
});

test('a prior failure story cannot terminate an unobserved replacement task', async () => {
    const { agent, mission, finishes, execute } = harness();
    agent.history.getHistory = () => [{ role: 'assistant', content: 'Not enough payment items on the old trade.' }];
    mission._handoff({ text: '找补给商', taskId: 'new-supply', origin: 'ws' });
    const result = await execute(agent, '!cannotComplete("Old trade failed")', () => assert.fail('must not interrupt'));
    assert.match(result, /Action not started: !cannotComplete/);
    assert.equal(finishes.length, 0);
    assert.equal(mission.isActive(), true);
});

test('a current failed action permits an evidence-backed impossible report', async () => {
    const { agent, mission, finishes, execute } = harness(undefined, [{ name: '!testAction',
        perform: async () => 'Action failed: route is protected' }]);
    mission._handoff({ text: '尝试路线', taskId: 'current-failure', origin: 'ws' });
    await execute(agent, '!testAction');
    assert.equal(await execute(agent, '!cannotComplete("route is protected")', () => {}), 'Marked the task as impossible.');
    assert.equal(finishes[0][1], 'failed');
    assert.match(finishes[0][2], /Action failed: route is protected/);
});

test('an explicit user impossible command keeps its lifecycle authority', async () => {
    const { agent, mission, finishes, execute } = harness();
    mission._handoff({ text: '玩家取消', taskId: 'human-failure', origin: 'ws' });
    assert.equal(await execute(agent, '!cannotComplete("cancel this task")'), 'Marked the task as impossible.');
    assert.equal(finishes[0][1], 'failed');
    assert.equal(mission.isActive(), false);
});

test('task inventory evidence measures merchant payment and output while the window stays open', async () => {
    const { agent, mission, finishes } = harness();
    agent.bot.entity = { position: {} };
    agent.bot.inventory = { slots: Array(46).fill(null) };
    agent.bot.inventory.slots[9] = { name: 'iron_ingot', count: 11 };
    mission._handoff({ text: '卖铁锭', taskId: 'trade-proof', origin: 'ws' });
    const slots = Array(39).fill(null);
    slots[0] = { name: 'iron_ingot', count: 3 };
    slots[2] = { name: 'emerald', count: 1 };
    slots[3] = { name: 'iron_ingot', count: 5 };
    slots[4] = { name: 'emerald', count: 2 };
    agent.bot.currentWindow = { inventoryStart: 3, inventoryEnd: 39, slots,
        close() { assert.fail('evidence must not close the merchant'); } };
    await mission.end('done');
    assert.match(finishes[0][2], /iron_ingot.*before.*11.*now.*5/);
    assert.match(finishes[0][2], /emerald.*before.*0.*now.*2/);
    assert.equal(agent.bot.inventory.slots[9].count, 11, 'base cache stays untouched');
});

test('actual query data reaches the task completion even when narration is empty', async () => {
    const { agent, mission, finishes, execute } = harness();
    mission._handoff({ text: '读书', taskId: 'read-1', origin: 'ws' });
    await execute(agent, '!readBook(-1)');
    await mission.end('done');
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0][0], 'read-1');
    assert.match(finishes[0][2], /Observed game data/);
    assert.match(finishes[0][2], /技能点 6/);
});

test('late query data is not attributed to a replacement task', async () => {
    let release;
    const { agent, mission, finishes, execute } = harness(() => new Promise(resolve => { release = resolve; }));
    mission._handoff({ text: '旧任务', taskId: 'old', origin: 'ws' });
    const pending = execute(agent, '!readBook(-1)');
    mission._handoff({ text: '新任务', taskId: 'new', origin: 'ws' });
    release('old data');
    await pending;
    await mission.end('done');
    assert.equal(finishes.length, 2);
    assert.doesNotMatch(finishes[1][2], /old data/);
});

test('repeated large queries keep completion evidence bounded', async () => {
    const { agent, mission, finishes, execute } = harness(async () => 'x'.repeat(50000));
    mission._handoff({ text: '查询', taskId: 'large', origin: 'ws' });
    for (let index = 0; index < 20; index++) await execute(agent, '!readBook(-1)');
    await mission.end('done');
    assert(finishes[0][2].length < 12500);
    assert.match(finishes[0][2], /Observed game data/);
});
test('completion uses assistant prose and never echoes the self-prompt as its outcome', async () => {
    const { agent, mission, finishes } = harness();
    agent.history.getHistory = () => [
        { role: 'system', content: 'You are self-prompting. Cannot change permissions.' },
        { role: 'assistant', content: '真实数据已查到。!endGoal' },
    ];
    mission._handoff({ text: '查询', taskId: 'reply', origin: 'ws' });
    await mission.end('done');
    assert.equal(finishes[0][2], '真实数据已查到。');
    agent.history.getHistory = () => [
        { role: 'system', content: 'You are self-prompting. Cannot change permissions.' },
        { role: 'assistant', content: '!endGoal' },
    ];
    mission._handoff({ text: '查询', taskId: 'bare', origin: 'ws' });
    await mission.end('done');
    assert.equal(finishes[1][2], '任务已完成。');
});

test('measured task inventory changes remain available after successful action narration is lost', async () => {
    const { agent, mission, finishes } = harness();
    agent.bot.entity = { position: {} };
    agent.bot.inventory = { slots: Array(46).fill(null) };
    agent.bot.inventory.slots[10] = { name: 'stick', count: 22 };
    mission._handoff({ text: '制作一把剑并确认新增', taskId: 'craft-1', origin: 'ws' });
    agent.bot.inventory.slots[10].count = 21;
    agent.bot.inventory.slots[11] = { name: 'wooden_sword', count: 1 };
    const evidence = mission.progressEvidence();
    assert.match(evidence, /wooden_sword.*before.*0.*now.*1.*delta.*1/);
    assert.match(evidence, /stick.*before.*22.*now.*21.*delta.*-1/);
    await mission.end('impossible', 'cannot confirm whether the sword is new');
    assert.equal(finishes[0][1], 'failed', 'an inventory gain must not claim a whole arbitrary task succeeded');
    assert.match(finishes[0][2], /Measured task inventory/);
    assert.match(finishes[0][2], /wooden_sword.*before.*0.*now.*1/);
});

test('inventory evidence is isolated by mission and unknown initial inventory stays unknown', () => {
    const { agent, mission } = harness();
    mission._handoff({ text: '旧任务', taskId: 'old', origin: 'ws' });
    agent.bot.entity = { position: {} };
    agent.bot.inventory = { slots: Array(46).fill(null) };
    agent.bot.inventory.slots[10] = { name: 'wooden_sword', count: 1 };
    assert.equal(mission.progressEvidence(), '', 'unknown baseline cannot assert a newly crafted item');
    const old = mission.mission;
    mission._handoff({ text: '新任务', taskId: 'new', origin: 'ws' });
    assert.equal(mission.progressEvidence(old), '');
    assert.equal(mission.progressEvidence(), '', 'a replacement starts with its own measured inventory');
});

test('equipment slot transfers are not acquisitions and large deltas stay bounded', () => {
    const { agent, mission } = harness();
    agent.bot.entity = { position: {} };
    agent.bot.inventory = { slots: Array(46).fill(null) };
    agent.bot.inventory.slots[10] = { name: 'iron_helmet', count: 1 };
    mission._handoff({ text: '装备', taskId: 'equip', origin: 'ws' });
    agent.bot.inventory.slots[5] = agent.bot.inventory.slots[10];
    agent.bot.inventory.slots[10] = null;
    assert.equal(mission.progressEvidence(), '');
    for (let i = 10; i < 40; i++) agent.bot.inventory.slots[i] = { name: 'item_' + 'x'.repeat(100) + i, count: 1 };
    agent.bot.inventory.slots[40] = { name: 'iron_sword', count: 1 };
    const evidence = mission.progressEvidence();
    assert(evidence.length < 1600);
    assert.match(evidence, /iron_sword/);
    assert.match(evidence, /omitted/);
});

test('actual action output is retained as command evidence for its task', async () => {
    const result = 'Successfully crafted wooden_sword; received 1 (server inventory confirmed).';
    const { agent, mission, finishes, execute } = harness(undefined, [{ name: '!craftRecipe',
        params: { item: { type: 'string' }, count: { type: 'int' } }, perform: async () => result }]);
    mission._handoff({ text: '采集', taskId: 'action', origin: 'ws' });
    await execute(agent, '!craftRecipe("wooden_sword", 1)');
    await mission.end('done');
    assert.match(finishes[0][2], /server inventory confirmed/);
});
