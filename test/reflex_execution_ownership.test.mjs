import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
    const calls = { runs: [], owners: [], releases: [], reprompts: [] };
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function execute(mode, agent, func, timeout=-1)');
    const end = source.indexOf('\nlet _agent = null;', start);
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        adminExclusiveActive: () => false, arbiterCurrentOwner: () => null,
        setBodyOwner: (bot, name) => calls.owners.push({ bot, name }),
        releaseBodyOwner: (bot, name) => calls.releases.push({ bot, name }),
        convoManager: { inConversation: () => false },
    });
    vm.runInContext(source.slice(start, end) + '\nglobalThis.execute = execute;', context);
    const body = () => ({ modes: { flushBehaviorLog: () => '' } });
    const agent = {
        bot: body(), self_prompter: { isActive: () => false, stopLoop() {} },
        actions: { currentActionLabel: '', resume_func: null,
            runAction: async (label, fn) => { calls.runs.push(label); await fn();
                return { interrupted: false, message: 'finished' }; } },
        handleMessage: (...args) => calls.reprompts.push(args),
    };
    const mode = { name: 'self_preservation', active: false };
    context.modes_list = [mode];
    context._agent = null;
    context.ModeController = class { loadJson() {} };
    agent.prompter = { getInitModes: () => ({}) };
    vm.runInContext(source.slice(source.indexOf('export function initModes')).replace('export ', '')
        + '\nglobalThis.initialize = initModes;', context);
    return { agent, mode, calls, body, execute: context.execute, initialize: context.initialize };
}

function pending() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test('a watchdog flag reset cannot start the same still-running reflex again', async () => {
    const f = fixture(), hold = pending();
    const first = f.execute(f.mode, f.agent, () => hold.promise);
    assert.equal(f.calls.runs.length, 1);
    f.mode.active = false;
    await f.execute(f.mode, f.agent, async () => {});
    assert.equal(f.calls.runs.length, 1, 'same reflex must not stop or interrupt its original action');
    hold.resolve(); await first;
    await f.execute(f.mode, f.agent, async () => {});
    assert.equal(f.calls.runs.length, 2, 'a completed invocation must not permanently latch the reflex');
});

test('a different reflex can still respond while the first invocation exists', async () => {
    const f = fixture(), hold = pending();
    const first = f.execute(f.mode, f.agent, () => hold.promise);
    await f.execute({ name: 'self_defense', active: false }, f.agent, async () => {});
    assert.deepEqual(f.calls.runs, ['mode:self_preservation', 'mode:self_defense']);
    hold.resolve(); await first;
});

test('rejected actions release their invocation so a later reflex can run', async () => {
    const f = fixture();
    await assert.rejects(f.execute(f.mode, f.agent, async () => { throw new Error('navigation failed'); }), /navigation failed/);
    await f.execute(f.mode, f.agent, async () => {});
    assert.equal(f.calls.runs.length, 2);
    assert.equal(f.mode.active, false);
});

test('retired body completion cannot clear the new body reflex or release its ownership', async () => {
    const f = fixture(), oldHold = pending(), newHold = pending();
    const oldBody = f.agent.bot;
    const oldRun = f.execute(f.mode, f.agent, () => oldHold.promise);
    oldBody._poisoned = true;
    f.agent.bot = f.body();
    const newBody = f.agent.bot;
    const newRun = f.execute(f.mode, f.agent, () => newHold.promise);
    oldHold.resolve(); await oldRun;
    assert.equal(f.mode.active, true, 'old finally must not reset the newer invocation');
    assert(!f.calls.releases.some(row => row.bot === newBody));
    newHold.resolve(); await newRun;
    assert.equal(f.mode.active, false);
    assert.equal(f.calls.releases.filter(row => row.bot === newBody).length, 1);
});

test('a retired invocation cannot reprompt the model on behalf of the new body', async () => {
    const f = fixture(), hold = pending();
    f.agent.actions.currentActionLabel = 'action:mineOres';
    const run = f.execute(f.mode, f.agent, () => hold.promise);
    f.agent.bot = f.body();
    hold.resolve(); await run;
    assert.equal(f.calls.reprompts.length, 0);
});

test('actual reconnect initialization rearms modes while the old body promise is still pending', async () => {
    const f = fixture(), oldHold = pending(), newHold = pending();
    const oldRun = f.execute(f.mode, f.agent, () => oldHold.promise);
    f.agent.bot = f.body();
    f.initialize(f.agent);
    assert.equal(f.mode.active, false, 'new mode scheduler must be allowed to enter');
    const newRun = f.execute(f.mode, f.agent, () => newHold.promise);
    oldHold.resolve(); await oldRun;
    assert.equal(f.mode.active, true);
    newHold.resolve(); await newRun;
});
