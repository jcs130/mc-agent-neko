import test from 'node:test';
import assert from 'node:assert/strict';

const { executeGeneratedCode } = await import('../src/agent/code_executor.js');
function fixture(options = {}) {
    const calls = [];
    const bot = { health: 20, food: 18, output: '', interrupt_code: false,
        entity: { position: { x: 1, y: 64, z: 2 }, yaw: 0, pitch: 0 },
        inventory: { items: () => [{ name: 'oak_log', count: 2 }] } };
    const agent = { bot, prompter: { skill_libary: { getRunnableSkillNames: () => new Set(['approved']) } } };
    const api = { skills: { log: (_bot, message) => { bot.output += message; },
        wait: async (_bot, ms) => { calls.push(ms); await new Promise(r => setTimeout(r, Math.min(ms, 50))); return true; },
        collectBlock: async (_bot, block) => { calls.push(block); return true; },
        customSkill: async (_bot, name) => { calls.push(name); return true; } },
        world: { getInventoryCounts: () => ({ oak_log: 2 }) } };
    return { agent, bot, calls, run: code => executeGeneratedCode(agent, code, api, {
        timeoutMs: 2000, allowed: ['skills.log', 'skills.wait', 'skills.collectBlock', 'skills.customSkill', 'world.getInventoryCounts'], ...options,
    }) };
}

test('generated code uses real documented RPCs and fresh inventory without raw bot access', async () => {
    const f = fixture();
    await f.run('const counts = world.getInventoryCounts(bot); const items = bot.inventory.items(); await skills.collectBlock(bot, items[0].name); log(bot, counts.oak_log);');
    assert.deepEqual(f.calls, ['oak_log']);
    assert.equal(f.bot.output, '2');
});

test('CPU infinite loops terminate without blocking the parent event loop', async () => {
    const f = fixture({ timeoutMs: 300 });
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    try { await assert.rejects(f.run('while (true) {}'), /timed out/); }
    finally { clearInterval(timer); }
    assert.ok(ticks >= 3);
});

test('an interrupted script cannot issue later calls', async () => {
    const f = fixture();
    setTimeout(() => { f.bot.interrupt_code = true; }, 250);
    await assert.rejects(f.run('while (true) { await skills.wait(bot, 40); }'), /interrupted/);
    const count = f.calls.length;
    await new Promise(r => setTimeout(r, 100));
    assert.equal(f.calls.length, count);
});

test('body replacement retires a script and never calls skills on the new body', async () => {
    const f = fixture();
    setTimeout(() => { f.agent.bot = { ...f.bot, interrupt_code: false }; }, 250);
    await assert.rejects(f.run('while (true) { await skills.wait(bot, 40); }'), /body changed/);
    assert.equal(f.agent.bot.interrupt_code, false);
});

test('worker call budget bounds a quick infinite RPC loop', async () => {
    const f = fixture({ maxCalls: 3 });
    await assert.rejects(f.run('while (true) { await skills.wait(bot, 0); }'), /call budget/);
    assert.equal(f.calls.length, 3);
});

test('developer-only custom skills remain blocked inside generated scripts', async () => {
    const f = fixture();
    await assert.rejects(f.run('await skills.customSkill(bot, "devGive");'), /not runnable/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.bot.interrupt_code, false, 'ordinary errors allow a bounded code correction attempt');
});

test('raw network/chat, host process, dynamic import and host constructors are unavailable', async () => {
    for (const code of ['bot.chat("spam");', 'process.exit(1);', 'await import("node:fs");',
        'skills.wait.constructor("return process")().exit(1);']) {
        const f = fixture();
        await assert.rejects(f.run(code));
        assert.deepEqual(f.calls, []);
    }
});

test('primitive false is explicit feedback and prevents dependent script operations', async () => {
    const f = fixture();
    f.agent.prompter.skill_libary.getRunnableSkillNames = () => new Set(['approved']);
    await assert.rejects(executeGeneratedCode(f.agent, 'await skills.fail(bot); await skills.wait(bot, 1);', {
        skills: { fail: () => false, wait: () => f.calls.push('bad') }, world: {},
    }, { timeoutMs: 2000, allowed: ['skills.fail', 'skills.wait'] }), /returned false/);
    assert.deepEqual(f.calls, []);
});

test('a silently skipped condition returns actual inventory IDs for code correction', async () => {
    const f = fixture();
    await assert.rejects(f.run('const inv = world.getInventoryCounts(bot); if (inv.sticks > 0) { await skills.wait(bot, 1); }'),
        /reported no result.*oak_log/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.bot.interrupt_code, false);
});
