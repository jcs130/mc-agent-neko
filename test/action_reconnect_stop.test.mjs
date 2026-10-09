import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionManager } from '../src/agent/action_manager.js';

function fixture() {
    const calls = { interrupts: 0, reconnects: 0, cleared: 0, idle: 0 };
    const bot = () => ({ interrupt_code: false, output: '', emit() { calls.idle++; } });
    const agent = { bot: bot(), requestInterrupt() { calls.interrupts++; },
        reconnectNow() { calls.reconnects++; }, clearBotLogs() { calls.cleared++; this.bot.output = ''; },
        history: { add() {} } };
    return { agent, calls, bot, manager: new ActionManager(agent) };
}

test('a stop waiting on the disconnected body cannot interrupt a replacement action', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { agent, calls, bot, manager } = fixture();
    manager.executing = true;
    manager.currentActionFn = () => {};
    const pending = manager.stop();
    agent.bot = bot();
    const current = () => {};
    manager.currentActionFn = current;
    manager.currentActionLabel = 'new-body';
    t.mock.timers.tick(15000);
    // Complete any incorrectly continued sleeps in the pre-fix version.
    for (let index = 0; index < 55; index++) { await Promise.resolve(); t.mock.timers.tick(300); }
    await pending;
    assert.equal(calls.reconnects, 0);
    assert.equal(calls.interrupts, 1, 'only the initial old-body interrupt is valid');
    assert.equal(manager.executing, true);
    assert.equal(manager.currentActionFn, current);
});

test('retiring a waiting stop releases only the old unfinished action', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { agent, calls, bot, manager } = fixture();
    manager.executing = true;
    manager.currentActionFn = () => {};
    const pending = manager.stop();
    agent.bot = bot();
    for (let index = 0; index < 55; index++) { t.mock.timers.tick(300); await Promise.resolve(); }
    await pending;
    assert.equal(calls.reconnects, 0);
    assert.equal(manager.executing, false);
    assert.equal(manager.currentActionFn, null);
});

for (const failure of [false, true]) test(`retired action ${failure ? 'error' : 'completion'} cannot clear replacement work`, async () => {
    const { agent, calls, bot, manager } = fixture();
    let release, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const pending = manager.runAction('old-body', async () => {
        entered();
        await new Promise(resolve => { release = resolve; });
        if (failure) throw new Error('old socket failure');
    }, { timeout: -1 });
    await ready;
    agent.bot = bot();
    const current = () => {};
    manager.currentActionFn = current;
    manager.currentActionLabel = 'new-body';
    const cleared = calls.cleared;
    release();
    const result = await pending;
    assert.equal(result.interrupted, true);
    if (failure) assert.match(result.message, /old socket failure/);
    assert.equal(manager.executing, true);
    assert.equal(manager.currentActionFn, current);
    assert.equal(manager.currentActionLabel, 'new-body');
    assert.equal(calls.cleared, cleared);
    assert.equal(calls.idle, 0);
});

test('old action timeout cannot time out or stop a replacement body', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { agent, bot, manager } = fixture();
    let stops = 0;
    manager.stop = async () => { stops++; };
    manager.executing = true;
    manager.currentActionFn = () => {};
    manager._startTimeout(1);
    agent.bot = bot();
    manager.currentActionFn = () => {};
    t.mock.timers.tick(60000);
    await Promise.resolve();
    assert.equal(stops, 0);
    assert.equal(manager.timedout, false);
});

for (const protectedCode of [false, true]) test(`a same-body wedge keeps the existing ${protectedCode ? 'generated-code protection' : 'reconnect backstop'}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { agent, calls, manager } = fixture();
    agent.bot._newActionActive = protectedCode;
    manager.executing = true;
    manager.currentActionFn = () => {};
    const pending = manager.stop();
    for (let index = 0; index < 55; index++) { t.mock.timers.tick(300); await Promise.resolve(); }
    await pending;
    assert.equal(calls.reconnects, protectedCode ? 0 : 1);
    assert.equal(manager.executing, false);
});
