import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionManager } from '../src/agent/action_manager.js';

test('missing output during bot replacement reports unavailable logs instead of throwing', () => {
    const manager = new ActionManager({ bot: { interrupt_code: false } });
    assert.match(manager.getBotOutputSummary(), /output unavailable/i);
});

test('an action error after bot replacement preserves the original failure', async () => {
    const agent = { bot: { interrupt_code: false, output: '' },
        clearBotLogs() { this.bot.output = ''; } };
    const manager = new ActionManager(agent);
    const result = await manager.runAction('test:reconnect', async () => {
        agent.bot = { interrupt_code: false, emit() {} };
        throw new Error('socketClosed during reconnect');
    }, { timeout: -1 });
    assert.equal(result.success, false);
    assert.match(result.message, /socketClosed during reconnect/);
    assert.doesNotMatch(result.message, /reading 'length'/);
});

test('ordinary action logs retain their bounded output and are consumed once', () => {
    const agent = { bot: { output: 'first-' + 'x'.repeat(600) + '-last' } };
    const manager = new ActionManager(agent);
    const text = manager.getBotOutputSummary();
    assert.match(text, /first-/);
    assert.match(text, /-last/);
    assert.match(text, /has been shortened/);
    assert.equal(agent.bot.output, '');
    assert.equal(manager.getBotOutputSummary(), 'Action output:\n');
});
