import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ActionManager } from '../src/agent/action_manager.js';

test('disconnect releases an action whose underlying window operation never settles', async () => {
    const bot = Object.assign(new EventEmitter(), { output: '', interrupt_code: false });
    const agent = { bot, clearBotLogs() { this.bot.output = ''; } };
    const manager = new ActionManager(agent);
    let began;
    const started = new Promise(resolve => { began = resolve; });
    const pending = manager.runAction('pending-window', async () => {
        began();
        return new Promise(() => {});
    }, { timeout: -1 });
    await started;
    bot.emit('end', 'socketClosed');
    const result = await pending;
    assert.equal(result.success, false);
    assert.equal(result.interrupted, true);
    assert.match(result.message, /disconnect/i);
    assert.equal(manager.executing, false);
    assert.equal(bot.listenerCount('end'), 0);
});

test('normal action completion removes its temporary disconnect listener', async () => {
    const bot = Object.assign(new EventEmitter(), { output: '', interrupt_code: false });
    const manager = new ActionManager({ bot, clearBotLogs() { this.bot.output = ''; } });
    const result = await manager.runAction('normal', async () => { bot.output = 'actual result'; }, { timeout: -1 });
    assert.equal(result.success, true);
    assert.match(result.message, /actual result/);
    assert.equal(bot.listenerCount('end'), 0);
});
