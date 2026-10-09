import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness(perform = async () => '生命 20/20；魔力 20/20；技能点 6', actions = []) {
    const finishes = [];
    const context = vm.createContext({
        console, Date, setTimeout, clearTimeout, process: { env: { DEBUG_CHAT: '0' } },
        wsServer: { beginMissionTask() {}, finishMission: (...args) => finishes.push(args) },
        queryList: [{ name: '!readBook', params: { slot: { type: 'int' } }, perform }],
        actionsList: [{ name: '!endGoal', perform: async agent => {
            await agent.adminMission.end('done');
            return 'Mission complete.';
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
