import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness(perform = async () => '生命 20/20；魔力 20/20；技能点 6') {
    const finishes = [];
    const context = vm.createContext({
        console, Date, setTimeout, clearTimeout, process: { env: { DEBUG_CHAT: '0' } },
        wsServer: { beginMissionTask() {}, finishMission: (...args) => finishes.push(args) },
        queryList: [{ name: '!readBook', params: { slot: { type: 'int' } }, perform }],
        actionsList: [],
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
