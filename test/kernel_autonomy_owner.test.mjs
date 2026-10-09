import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture(owner = true) {
    const state = { owner }, calls = { commits: 0 };
    const agent = { bot: { entity: { position: {} }, health: 20, food: 20 },
        actions: { executing: false }, hasExternalAutonomyOwner: () => state.owner };
    const proposal = { kind: 'REPLENISH_KIT', skill: 'replenishKit' };
    const context = vm.createContext({
        console, Date, process: { env: {} },
        AGENT_MODE: { SURVIVAL: 'survival', COMPANION: 'companion' }, FRAMEWORK_ENABLED_DEFAULT: true,
        foodInstinctsEnabled: () => false, selfProposeEnabled: () => true,
        getWorld: () => ({}), mentalState: () => ({ busy: false }),
        proposeTasks: () => [proposal], commitGoal: () => proposal,
        pendingInstincts: () => [], arbiterVitalNow: () => false,
    });
    const source = readFileSync(new URL('../src/agent/framework/kernel.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, context);
    const Kernel = vm.runInContext('Kernel', context);
    return { state, agent, calls, proposal, kernel: new Kernel(agent, { enabled: true, shadow: false, log() {} }) };
}

for (const mode of ['survival', 'companion']) test(`external autonomy blocks native ${mode} decisions`, async () => {
    const f = fixture(); f.kernel.mode = mode;
    f.kernel._survivalTick = f.kernel._companionNudge = () => { f.calls.commits++; };
    await f.kernel.tick(300);
    assert.equal(f.calls.commits, 0, 'the native scheduler must yield between Neko tasks too');
});

test('standalone native kernel still schedules its normal decisions', async () => {
    const f = fixture(false);
    f.kernel._survivalTick = () => { f.calls.commits++; };
    await f.kernel.tick(300);
    assert.equal(f.calls.commits, 1);
});

test('Neko ownership keeps orphan activity cleanup alive without native decisions', async () => {
    const f = fixture();
    let checks = 0;
    f.kernel._busyStuckWatchdog = () => { checks++; };
    f.kernel._survivalTick = () => { f.calls.commits++; };
    await f.kernel.tick(300);
    assert.equal(checks, 1, 'body activity maintenance must survive the autonomy gate');
    assert.equal(f.calls.commits, 0);
});

test('external cleanup clears an orphan label but preserves an executing action', async () => {
    const f = fixture();
    f.agent.bot._currentSkill = 'chopWood';
    f.agent.bot._skillActivity = { name: 'chopWood', active: true };
    f.kernel._busyStuck = { name: 'chopWood', since: Date.now() - 181000 };
    f.agent.actions.executing = true;
    await f.kernel.tick(300);
    assert.equal(f.agent.bot._currentSkill, 'chopWood');
    f.agent.actions.executing = false;
    await f.kernel.tick(300);
    assert.equal(f.agent.bot._currentSkill, null);
    assert.equal(f.agent.bot._skillActivity, null);
    assert.equal(f.calls.commits, 0);
});

test('ownership arriving during a native decision prevents its late dispatch', async () => {
    const f = fixture(false); let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    f.kernel.decide = () => { started(); return new Promise(resolve => { release = resolve; }); };
    f.kernel._commit = () => { f.calls.commits++; };
    const pending = f.kernel._survivalTick();
    await ready; f.state.owner = true; release({ chosen: f.proposal });
    await pending;
    assert.equal(f.calls.commits, 0);
});

test('a direct late commit cannot clear an external interrupt or take the body', async () => {
    const f = fixture(); f.agent.bot.interrupt_code = true;
    f.kernel._worldSnap = () => { throw new Error('native dispatch touched the external body'); };
    await assert.doesNotReject(f.kernel._commit({ chosen: f.proposal, reason: 'idle' }));
    assert.equal(f.agent.bot.interrupt_code, true);
    assert.equal(f.agent.bot._kernelDriverActive, undefined);
    assert.equal(f.agent.supervised_skill, undefined);
});
