import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';

function fixture({ distance = 2, result = true, cheat = false, loaded = true, movesDuringHandoff = false } = {}) {
    const calls = [], logs = [];
    const context = vm.createContext({ Vec3, skills: {
        breakBlockAt: async (bot, ...position) => { calls.push(position); return result; },
        log: (_, message) => logs.push(message),
    } });
    const source = readFileSync(new URL('../src/agent/commands/actions.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, context);
    const command = vm.runInContext('actionsList.find(a => a.name === "!breakBlockAt")', context);
    const bot = { entity: { position: new Vec3(0, 64, 0) },
        modes: { isOn: name => name === 'cheat' && cheat },
        blockAt: position => loaded ? { name: 'dirt', position } : null };
    const agent = { bot, actions: { runAction: async (_, fn) => {
        if (movesDuringHandoff) bot.entity.position = new Vec3(20, 64, 0);
        await fn(); return { success: true, interrupted: false, message: logs.join('\n') };
    } } };
    return { calls, run: async () => {
        assert.ok(command, 'the body needs an exact-coordinate digging command');
        return command.perform(agent, distance, 65, 0);
    } };
}

test('an exact nearby side/head block uses the existing dig primitive at the requested coordinates', async () => {
    const f = fixture();
    assert.doesNotMatch(await f.run(), /^Action (failed|not started):/);
    assert.deepEqual(f.calls, [[2, 65, 0]]);
});

test('a refused primitive keeps its failure without substituting resource collection', async () => {
    const f = fixture({ result: false });
    assert.match(await f.run(), /^Action failed:/);
    assert.deepEqual(f.calls, [[2, 65, 0]]);
});

test('out-of-reach and unloaded targets are rejected without pathing or digging elsewhere', async () => {
    for (const options of [{ distance: 8 }, { loaded: false }]) {
        const f = fixture(options);
        assert.match(await f.run(), /^Action not started:/);
        assert.equal(f.calls.length, 0);
    }
});

test('the targeted dig command cannot use the primitive cheat branch', async () => {
    const f = fixture({ cheat: true });
    assert.match(await f.run(), /^Action not started:/);
    assert.equal(f.calls.length, 0);
});

test('target reach is checked again after yielding the previous action', async () => {
    const f = fixture({ movesDuringHandoff: true });
    assert.match(await f.run(), /^Action failed:/);
    assert.equal(f.calls.length, 0);
});
