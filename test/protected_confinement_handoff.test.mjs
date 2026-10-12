import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';
import { rememberConfinementDigRefusal, protectedConfinementHandoff } from '../src/agent/protected_confinement_recovery.js';

function fixture() {
    const events = [], floor = 64;
    const bot = { game: { dimension: 'overworld' }, health: 20, oxygenLevel: 20,
        entity: { position: new Vec3(-590.7, floor, -427.3) }, entities: {},
        _mobility: { state: 'ENTOMBED' },
        serverProtection: { isDenied: (_action, p) => p.y >= floor && (p.x !== -591 || p.z !== -428) },
        blockAt: p => ({ name: p.y < floor ? 'stone' : p.x === -591 && p.z === -428 && p.y < floor + 2 ? 'air' : 'spruce_stairs',
            boundingBox: p.y < floor || p.x !== -591 || p.z !== -428 || p.y >= floor + 2 ? 'block' : 'empty', position: p.floored() }),
        emit: (name, value) => events.push({ name, value }) };
    const wall = bot.blockAt(new Vec3(-592, 65, -428));
    const check = (now, options = {}) => protectedConfinementHandoff(bot, { now, externalOwner: true, ...options });
    const prime = () => {
        for (const now of [100000, 105000, 110000]) {
            rememberConfinementDigRefusal(bot, wall, now - 1); check(now);
        }
    };
    return { bot, wall, events, check, prime };
}

test('protected walls with a legal floor release a measured futile confinement reflex once', () => {
    const f = fixture(); f.prime();
    assert.equal(f.bot.serverProtection.isDenied('break', f.bot.entity.position.floored().offset(0, -1, 0)), false);
    assert.equal(f.check(115000), true);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].name, 'autonomyRecovery');
    assert.equal(f.events[0].value.type, 'protected-confinement-stall');
    assert.equal(f.events[0].value.noProgressSeconds, 15);
    assert.equal(f.events[0].value.expiresAt, 175000);
    assert.deepEqual(f.events[0].value.blockedTarget, { x: -592, y: 65, z: -428 });
    assert.equal(f.check(119000), true);
    assert.equal(f.events.length, 1);
    assert.equal(f.check(176000), false, 'a lapsed window requires new measurements');
});

test('rotating denied bearings preserve stationary evidence, one old refusal does not', () => {
    const f = fixture(); f.prime();
    rememberConfinementDigRefusal(f.bot, f.bot.blockAt(new Vec3(-591, 65, -429)), 114999);
    assert.equal(f.check(115000), true);
    const single = fixture(); rememberConfinementDigRefusal(single.bot, single.wall, 99999);
    for (const now of [100000, 105000, 110000, 115000]) assert.equal(single.check(now), false);
});

test('a guess, stale receipt, changed block or cleared protection cannot authorize a handoff', () => {
    for (const mutate of [f => { f.bot.serverProtection.isDenied = () => false; },
        f => { f.bot.blockAt = () => null; },
        f => { const original = f.bot.blockAt; f.bot.blockAt = p => ({ ...original(p), name: 'dirt' }); },
        f => { f.bot._confinementDigRefusal.observedAt = -100000; }]) {
        const f = fixture(); f.prime(); mutate(f); assert.equal(f.check(115000), false);
    }
    const f = fixture();
    for (const now of [100000, 105000, 110000, 115000]) assert.equal(f.check(now), false);
    assert.equal(f.events.length, 0);
});

test('movement, world changes, stale sampling and rewind restart the watch', () => {
    for (const mutate of [f => { f.bot.entity.position = f.bot.entity.position.offset(3, 0, 0); },
        f => { f.bot.game.dimension = 'the_nether'; }]) {
        const f = fixture(); f.prime(); mutate(f); assert.equal(f.check(115000), false);
    }
    const f = fixture(); f.prime(); assert.equal(f.check(140000), false); assert.equal(f.check(100001), false);
});

test('real work, dangerous conditions and loss of owner revoke the planning window', () => {
    for (const mutate of [f => { f.bot._currentSkill = 'goToPosition'; },
        f => { f.bot.targetDigBlock = f.wall; }, f => { f.bot.usingHeldItem = true; },
        f => { f.bot.currentWindow = {}; }, f => { f.bot.isSleeping = true; },
        f => { f.bot.lastDamageTime = 115000; }, f => { f.bot.health = 10; },
        f => { f.bot.oxygenLevel = 6; }, f => { f.bot.entity.isOnFire = true; },
        f => { f.bot.entity.isInLava = true; }, f => { f.bot.interrupt_code = true; },
        f => { f.bot.entities[1] = { name: 'creeper', position: f.bot.entity.position.offset(3, 0, 0) }; },
        f => { f.bot._mobility.state = 'FREE'; }]) {
        const f = fixture(); f.prime(); assert.equal(f.check(115000), true); mutate(f);
        assert.equal(f.check(115001), false); assert.equal(f.bot._confinementRecovery, null);
    }
    for (const options of [{ externalOwner: false }, { emergency: true }, { executingOther: true }]) {
        const f = fixture(); f.prime(); assert.equal(f.check(115000, options), false);
    }
});

test('production mobility dispatch yields before scheduling another denied excavation', () => {
    const f = fixture(); let now = 100000, dispatches = 0;
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const start = source.indexOf('            if (protectedRetreatHandoff(bot, {', source.indexOf("name: 'mobility'"));
    const end = source.indexOf('            // ── reactions ──', start);
    assert(start > 0 && end > start);
    const context = vm.createContext({ bot: f.bot, agent: { hasExternalAutonomyOwner: () => true, actions: {} },
        Date: { now: () => now }, arbiterVitalNow: () => false, protectedRetreatHandoff: () => false,
        protectedConfinementHandoff, next: () => { dispatches++; } });
    vm.runInContext('globalThis.run = function() {' + source.slice(start, end) + 'next();};', context);
    for (const stamp of [100000, 105000, 110000, 115000]) {
        now = stamp; rememberConfinementDigRefusal(f.bot, f.wall, now - 1); context.run();
    }
    assert.equal(dispatches, 3, 'the fourth futile burst must yield to the external planner');
});

test('the real guardedDig records only the actual failed protected target', async () => {
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const start = source.indexOf('            const guardedDig = async (block, why');
    const end = source.indexOf('            // Protected recovery owns', start);
    assert(start > 0 && end > start);
    for (const denied of [true, false]) {
        const f = fixture(); f.bot.serverProtection.isDenied = () => denied;
        Object.assign(f.bot, { clearControlStates() {}, stopDigging() {}, lookAt: async () => {},
            tool: { equipForBlock: async () => {} }, dig: async () => { throw new Error('dig refused'); } });
        const context = vm.createContext({ bot: f.bot, Date, Promise,
            setTimeout: callback => { queueMicrotask(callback); }, fs: { appendFileSync() {} },
            STONY_MOBILITY: /stone/, ensurePickForStone: async () => true, rememberConfinementDigRefusal });
        vm.runInContext(source.slice(start, end) + '\nglobalThis.run = guardedDig;', context);
        assert.equal(await context.run(f.wall, 'ENTOMBED'), false);
        assert.equal(!!f.bot._confinementDigRefusal, denied);
        if (denied) assert.deepEqual(f.bot._confinementDigRefusal.target, { x: -592, y: 65, z: -428 });
    }
});
