import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture({ maxMs = 180000, wallMs = 280000, active = true, enabled = true,
    interrupted = false } = {}) {
    const clock = { now: 1000000, items: 10 };
    const calls = { actions: [], waits: [], finishes: [], timers: 0 };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        Date: class extends Date { static now() { return clock.now; } },
        process: { env: { MC_ADMIN_MISSION_MAX_MS: String(maxMs), MC_ADMIN_MISSION_WALL_MS: String(wallMs),
            DEBUG_CHAT: '0' } },
        settings: {}, queryList: [],
        setTimeout() { calls.timers++; throw new Error('offline budget fixture must never wait'); },
        clearTimeout() {},
        wsServer: { beginMissionTask() {}, finishMission: (...args) => calls.finishes.push(args) },
        skills: { standby: async (_bot, seconds) => { calls.waits.push(seconds); } },
    });
    for (const file of ['../src/agent/admin_mission.js', '../src/agent/commands/actions.js',
        '../src/agent/commands/index.js']) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8')
            .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
        vm.runInContext(source, context);
    }
    const { AdminMission, executeCommand } = vm.runInContext('({AdminMission, executeCommand})', context);
    const agent = { name: 'ag_NEKO', _missionEnabled: enabled, requestInterrupt() {},
        self_prompter: { isActive: () => true, isStopped: () => false },
        bot: { entity: {}, game: { dimension: 'overworld' },
            inventory: { items: () => [{ count: clock.items }] } },
        actions: { runAction: async (name, action, options) => {
            calls.actions.push({ name, options });
            await action();
            return { message: 'wait action result', interrupted, timedout: false };
        } },
    };
    agent.adminMission = new AdminMission(agent);
    if (active) agent.adminMission._handoff({ text: '种下树苗后检查附近', taskId: 'sapling', origin: 'ws' });
    return { agent, mission: agent.adminMission, calls, clock,
        execute: command => executeCommand(agent, command), advance: ms => { clock.now += ms; } };
}

test('the captured 300s standby is refused before claiming the body of a short mission', async () => {
    const f = fixture();
    f.advance(10000);
    const result = await f.execute('!standby(300)');
    assert.match(result, /not started/i);
    assert.match(result, /170(?:\.0)?s.*remaining/i);
    assert.match(result, /30s.*(?:reply|check)/i);
    assert.match(result, /139s/);
    assert.match(result, /shorter wait/i);
    assert.match(result, /completed short step/i);
    assert.match(result, /reobserve later/i);
    assert.deepEqual(f.calls.actions, []);
    assert.deepEqual(f.calls.waits, []);
    assert.deepEqual(f.calls.finishes, []);
    assert.equal(f.calls.timers, 0);
    assert.equal(f.mission.isActive(), true, 'a refused wait must not end or complete the mission');
});

test('finite waits that leave reply time retain the existing action wrapper and result', async () => {
    const f = fixture();
    f.advance(10000);
    assert.equal(await f.execute('!standby(139)'), 'wait action result');
    assert.deepEqual(f.calls.waits, [139]);
    assert.equal(f.calls.actions[0].name, 'action:standby');
    assert.equal(f.calls.actions[0].options.resume, false);
    assert.equal(f.calls.actions[0].options.timeout, 25);
    assert.equal(f.calls.timers, 0);
});

for (const seconds of [140, 141]) test(`a ${seconds}s wait reaching or exceeding the reply boundary is refused`, async () => {
    const f = fixture();
    f.advance(10000);
    assert.match(await f.execute(`!standby(${seconds})`), /not started/i);
    assert.deepEqual(f.calls.actions, []);
    assert.deepEqual(f.calls.waits, []);
});

test('wall budget still limits a wait after real inventory progress extends the stall deadline', async () => {
    const f = fixture();
    f.mission.tick();
    f.advance(160000);
    f.clock.items++;
    f.mission.tick();
    assert.equal(f.mission.mission.deadlineAt, f.clock.now + 180000);
    f.advance(90000);
    const result = await f.execute('!standby(1)');
    assert.match(result, /30(?:\.0)?s.*remaining/i);
    assert.match(result, /not started/i);
    assert.deepEqual(f.calls.waits, []);
    assert.equal(f.mission.isActive(), true);
});

test('an expired mission refuses even the shortest wait without auto-ending it', async () => {
    const f = fixture();
    f.advance(181000);
    const result = await f.execute('!standby(1)');
    assert.match(result, /0(?:\.0)?s.*remaining/i);
    assert.deepEqual(f.calls.actions, []);
    assert.deepEqual(f.calls.finishes, []);
    assert.equal(f.mission.isActive(), true);
});

for (const options of [{ active: false }, { enabled: false }]) test(`standalone standby remains available with ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    f.advance(500000);
    assert.equal(await f.execute('!standby(300)'), 'wait action result');
    assert.deepEqual(f.calls.waits, [300]);
    assert.equal(f.calls.timers, 0);
});

test('absence of an AdminMission controller preserves ordinary standby', async () => {
    const f = fixture({ active: false });
    delete f.agent.adminMission;
    assert.equal(await f.execute('!standby(1200)'), 'wait action result');
    assert.deepEqual(f.calls.waits, [1200]);
});

test('indefinite and nonnumeric standby still fail the unchanged command schema', async () => {
    const f = fixture();
    assert.match(await f.execute('!standby(-1)'), /must be an element of/);
    assert.match(await f.execute('!standby("forever")'), /must be of type int/);
    assert.deepEqual(f.calls.actions, []);
    assert.deepEqual(f.calls.waits, []);
});

test('human or survival interruption of an accepted wait keeps the existing interrupted result', async () => {
    const f = fixture({ interrupted: true });
    assert.equal(await f.execute('!standby(1)'), undefined);
    assert.deepEqual(f.calls.waits, [1]);
    assert.equal(f.calls.actions[0].options.resume, false);
    assert.deepEqual(f.calls.finishes, []);
});
