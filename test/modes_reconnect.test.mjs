import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function controllerFor(bot) {
    // Run the real controller without importing the live MindServer socket.
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const start = source.indexOf('class ModeController {');
    const end = source.indexOf('export function initModes', start);
    const context = vm.createContext({ _agent: {
        bot, isIdle: () => { throw new Error('scheduler reached'); },
    } });
    vm.runInContext(source.slice(start, end) + '\n globalThis.controller = new ModeController();', context);
    return context.controller;
}

test('disconnect and pre-spawn intervals never run movement or preservation modes', async () => {
    for (const bot of [{}, { entity: null }, { _poisoned: true, entity: { position: {} } }]) {
        const controller = controllerFor(bot);
        await assert.doesNotReject(() => controller.update());
    }
});

test('the mode scheduler resumes after the live body spawns', async () => {
    const bot = {};
    const controller = controllerFor(bot);
    bot.entity = { position: {} };
    await assert.rejects(() => controller.update(), /scheduler reached/);
});
