import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const target = { name: 'oak_log', stateId: 45, position: { x: -574, y: 73, z: -505 } };
function fixture() {
    const bot = Object.assign(new EventEmitter(), {
        entity: { position: { x: -575, y: 71, z: -508 } },
        _client: new EventEmitter(), game: { dimension: 'overworld' }, output: '',
        blockAt: () => target, canDigBlock: () => true,
    });
    bot._client.state = 'play';
    bot.digs = []; bot.dig = async (...args) => { bot.digs.push(args); return 'dug'; };
    bot.stopDigging = () => {};
    return bot;
}
function reply(status = 'allow_likely', allowed = true, extra = {}) {
    return { status: 'received', records: [{ kind: 'MC_PROTECTION', value: {
        schemaVersion: 1, action: 'break', world: 'minecraft:overworld',
        ...target.position, status, allowed, reason: status === 'deny' ? 'original_building' : 'no_known_protection', ...extra,
    } }] };
}
async function install(bot, options = {}) {
    const { installServerProtection } = await import('../src/utils/server_protection.js');
    return installServerProtection(bot, { enabled: true, ...options });
}

test('a denied building never reaches the underlying dig; caches exact target and reason', async () => {
    const bot = fixture(), sent = [], events = [];
    bot.on('serverProtection', e => events.push(e));
    const guard = await install(bot, { send: async (_b, command) => { sent.push(command); return reply('deny', false); } });
    await assert.rejects(bot.dig(target), /original_building/);
    await assert.rejects(bot.dig(target), /original_building/);
    assert.equal(bot.digs.length, 0);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { command: '/mycli protect break -574 73 -505', readOnly: true });
    assert.equal(guard.isDenied('break', target.position), true);
    assert.equal(bot.canDigBlock(target), false);
    assert.equal(guard.snapshot().denied[0].reason, 'original_building');
    assert.equal(events.length, 1, 'identical cached failures do not flood attention');
});

test('allow_likely permits an attempt and keeps the server tentative status', async () => {
    const bot = fixture();
    const guard = await install(bot, { send: async () => reply() });
    assert.equal(await bot.dig(target, true), 'dug');
    assert.equal(bot.digs.length, 1);
    assert.equal(guard.snapshot().lastCheck.status, 'allow_likely');
    assert.equal(guard.isDenied('break', target.position), false);
});

test('unknown, missing, contradictory or mismatched replies never authorize a dig', async () => {
    for (const response of [reply('unknown', null), { status: 'submitted', records: [] },
        reply('deny', true), reply('allow_likely', true, { x: -573 }),
        reply('allow_likely', true, { action: 'place' }),
        reply('allow_likely', true, { world: 'minecraft:the_nether' }),
        reply('allow_likely', true, { schemaVersion: 99 }),
        { ...reply(), status: 'unknown' }, { status: 'received', records: 'malformed' }]) {
        const bot = fixture();
        const guard = await install(bot, { send: async () => response });
        await assert.rejects(bot.dig(target), /protection.*unknown/i);
        assert.equal(bot.digs.length, 0);
        assert.equal(guard.isDenied('break', target.position), false, 'unknown is not a protected building');
    }
});

test('same-target requests share one preflight while unrelated command activity is busy', async () => {
    const bot = fixture(); let calls = 0;
    const guard = await install(bot, { send: async () => { calls++; await new Promise(r => setTimeout(r, 2)); return calls === 1 ? { status: 'failed', reason: 'busy' } : reply(); } });
    const results = await Promise.all([guard.check('break', target.position), guard.check('break', target.position)]);
    assert.equal(calls, 2);
    assert.ok(results.every(r => r.allowed === true));
});

test('different target preflights are serialized even with an injected bridge', async () => {
    const bot = fixture(); let active = 0, maxActive = 0;
    const guard = await install(bot, { send: async (_b, { command }) => {
        active++; maxActive = Math.max(maxActive, active);
        await new Promise(r => setTimeout(r, 2)); active--;
        return reply('allow_likely', true, { x: Number(command.split(' ').at(-3)) });
    } });
    await Promise.all([guard.check('break', target.position), guard.check('break', { ...target.position, x: -573 })]);
    assert.equal(maxActive, 1);
});

test('denial TTL, dimension and lifecycle prevent stale permission decisions', async () => {
    const bot = fixture(); let clock = 1000, calls = 0;
    const guard = await install(bot, { now: () => clock, denyTtlMs: 100, send: async () => { calls++; return reply('deny', false); } });
    await guard.check('break', target.position);
    clock += 99; assert.equal(guard.isDenied('break', target.position), true);
    bot.game.dimension = 'the_nether'; assert.equal(guard.isDenied('break', target.position), false);
    bot.game.dimension = 'overworld'; clock += 2;
    assert.equal(guard.isDenied('break', target.position), false);
    await guard.check('break', target.position); assert.equal(calls, 2);
    bot.emit('respawn'); assert.equal(guard.isDenied('break', target.position), false);
});

test('stopping or disconnecting during permission lookup cancels the pending dig', async () => {
    for (const stop of [b => b.stopDigging(), b => b.emit('end'), b => { b.game.dimension = 'the_nether'; }]) {
        const bot = fixture(); let release;
        await install(bot, { send: () => new Promise(r => { release = r; }) });
        const pending = bot.dig(target);
        while (!release) await new Promise(r => setImmediate(r));
        stop(bot); release(reply());
        await assert.rejects(pending, /cancel|changed|disconnect/i);
        assert.equal(bot.digs.length, 0);
    }
});

test('a changed target after the asynchronous preflight is not dug', async () => {
    const bot = fixture();
    await install(bot, { send: async () => { bot.blockAt = () => ({ ...target, stateId: 99, name: 'stone' }); return reply(); } });
    await assert.rejects(bot.dig(target), /changed/);
    assert.equal(bot.digs.length, 0);
});

test('servers without configured or observed protection retain vanilla digging', async () => {
    const bot = fixture(); let sent = 0;
    const guard = await install(bot, { enabled: false, send: async () => { sent++; return reply(); } });
    assert.equal(await bot.dig(target), 'dug');
    assert.equal(sent, 0); assert.equal(guard.snapshot().enabled, false);
});

test('server protection advertisement enables checks; forged player advertisements do not', async () => {
    const bot = fixture(); let calls = 0;
    const guard = await install(bot, { enabled: false, send: async () => { calls++; return reply(); } });
    bot.emit('messagestr', '/mycli protect break|place|container|use <x> <y> <z>', 'chat', {}, 'player');
    assert.equal(guard.snapshot().enabled, false);
    bot.emit('messagestr', '/mycli protect break|place|container|use <x> <y> <z> 查询权限', 'system');
    await bot.dig(target); assert.equal(calls, 1);
});

test('a real server rejection after allow_likely cancels digging and prevents retries', async () => {
    const bot = fixture();
    bot.dig = async () => { bot.emit('messagestr', '村庄原有建筑受保护，不能破坏。', 'system'); throw new Error('Digging aborted'); };
    const guard = await install(bot, { send: async () => reply() });
    await assert.rejects(bot.dig(target));
    assert.equal(guard.isDenied('break', target.position), true);
    assert.match(guard.snapshot().lastBlocked.reason, /不能破坏/);
});

test('permission failure or transport exceptions never silently fall through to digging', async () => {
    const bot = fixture();
    await install(bot, { send: async () => { throw new Error('connection lost'); } });
    await assert.rejects(bot.dig(target), /unknown/i);
    assert.equal(bot.digs.length, 0);
});

test('guard installation is idempotent and a respawn cannot repopulate a stale check', async () => {
    const bot = fixture(); let release;
    const first = await install(bot, { send: () => new Promise(r => { release = r; }) });
    assert.equal(await install(bot), first);
    const pending = first.check('break', target.position);
    while (!release) await new Promise(r => setImmediate(r));
    bot.emit('respawn'); release(reply('deny', false)); await pending;
    assert.equal(first.snapshot().denied.length, 0);
});

test('denied wooden columns are avoided without excluding neighboring trees', async () => {
    const bot = fixture();
    const guard = await install(bot, { send: async () => reply('deny', false) });
    await assert.rejects(bot.dig(target));
    assert.equal(guard.isDeniedWoodColumn({ ...target.position, y: 79 }), true);
    assert.equal(guard.isDeniedWoodColumn({ ...target.position, x: -573 }), false);
});

test('the actual command bridge carries a private preflight before digging', async () => {
    const bot = fixture(), sent = [];
    bot.chat = command => { sent.push(command); bot.emit('messagestr', 'MC_PROTECTION ' + JSON.stringify(reply().records[0].value), 'system'); };
    await install(bot, { queryTimeoutMs: 200 });
    await bot.dig(target);
    assert.deepEqual(sent, ['/mycli protect break -574 73 -505']);
    assert.equal(bot.digs.length, 1);
    assert.equal(bot.listenerCount('messagestr'), 1, 'request listener released, permanent guard retained');
});

test('an asynchronously emitted structured denial also supersedes tentative permission', async () => {
    const bot = fixture();
    bot.dig = async () => { bot.emit('messagestr', 'MC_PROTECTION ' + JSON.stringify(reply('deny', false).records[0].value), 'system'); };
    const guard = await install(bot, { send: async () => reply() });
    await assert.rejects(bot.dig(target), /original_building/);
    assert.equal(guard.isDenied('break', target.position), true);
});

test('explicit permission queries update the body cache without starting an action', async () => {
    const { sendServerCommand } = await import('../src/websocket/server_commands.js');
    const bot = fixture();
    const guard = await install(bot);
    let response = reply('deny', false);
    bot.chat = () => bot.emit('messagestr', 'MC_PROTECTION ' + JSON.stringify(response.records[0].value), 'system');
    const query = { command: '/mycli protect break -574 73 -505', readOnly: true };
    await sendServerCommand(bot, query, { quietMs: 2, timeoutMs: 40 });
    assert.equal(guard.isDenied('break', target.position), true);
    assert.equal(bot.digs.length, 0);
    response = reply();
    await sendServerCommand(bot, query, { quietMs: 2, timeoutMs: 40 });
    assert.equal(guard.isDenied('break', target.position), true, 'a tentative reply cannot erase an unexpired known denial');
});
