import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';
import { protectedRetreatHandoff, rememberRetreatDigRefusal } from '../src/agent/protected_retreat_recovery.js';

function fixture() {
    const events = [];
    const bot = { game: { dimension: 'overworld' }, health: 20, oxygenLevel: 20, lastDamageTime: 0,
        entity: { position: new Vec3(-546.5, 42, -490.5), isInLava: false, isOnFire: false },
        entities: { 1: { name: 'enderman', position: new Vec3(-542.5, 42, -490.5) } },
        serverProtection: { isDenied: (action, p) => action === 'break' && p.x === -547 && p.y === 41 && p.z === -491 },
        blockAt: p => ({ name: p.y < 42 ? 'spruce_planks' : 'air', position: p.floored(),
            boundingBox: p.y < 42 ? 'block' : 'empty' }),
        emit: (name, event) => events.push({ name, event }) };
    const check = (now, options = {}) => protectedRetreatHandoff(bot, { now, externalOwner: true, ...options });
    const prime = () => { check(100000); check(105000); check(110000); };
    return { bot, events, check, prime };
}

test('a denied floor and measured stationary retreat yield a bounded planning window', () => {
    const f = fixture();
    f.prime();
    assert.equal(f.check(115000), true);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].name, 'autonomyRecovery');
    assert.equal(f.events[0].event.type, 'protected-retreat-stall');
    assert.deepEqual(f.events[0].event.blockedTarget, { x: -547, y: 41, z: -491 });
    assert.equal(f.check(119000), true);
    assert.equal(f.events.length, 1, 'ongoing handoff must not become a repeated notification');
    assert.equal(f.check(176000), false, 'a lapsed window requires new measured observations');
});

test('unknown or other-target protection cannot yield a real threat', () => {
    for (const denied of [undefined, () => false, (_action, p) => p.x === -548]) {
        const f = fixture();
        f.bot.serverProtection = denied ? { isDenied: denied } : undefined;
        f.prime();
        assert.equal(f.check(115000), false);
        assert.equal(f.events.length, 0);
    }
});

test('damage, creepers, environmental emergency and user stop override a handoff immediately', () => {
    for (const mutate of [f => { f.bot.lastDamageTime = 114999; },
        f => { f.bot.entities[2] = { name: 'creeper', position: f.bot.entity.position.offset(3, 0, 0) }; },
        f => { f.bot.health = 8; }, f => { f.bot.oxygenLevel = 6; },
        f => { f.bot.entity.isOnFire = true; }, f => { f.bot.entity.isInLava = true; },
        f => { f.bot.interrupt_code = true; }]) {
        const f = fixture(); f.prime(); assert.equal(f.check(115000), true);
        mutate(f);
        assert.equal(f.check(115001), false);
        assert.equal(f.bot._protectedRetreatRecovery, null);
    }
    const f = fixture(); f.prime();
    assert.equal(f.check(115000, { externalOwner: false }), false);
    assert.equal(f.check(115000, { emergency: true }), false);
});

test('movement, world switch and stale/rewound clocks restart measurement', () => {
    for (const mutate of [f => { f.bot.entity.position = f.bot.entity.position.offset(3, 0, 0); },
        f => { f.bot.game.dimension = 'the_nether'; }]) {
        const f = fixture(); f.prime(); mutate(f);
        assert.equal(f.check(115000), false);
    }
    const f = fixture(); f.prime();
    assert.equal(f.check(140000), false);
    assert.equal(f.check(100001), false);
});

test('missing foot/head cells cannot establish a safe planner handoff', () => {
    const f = fixture(), original = f.bot.blockAt;
    f.bot.blockAt = p => p.y >= 42 ? null : original(p);
    f.prime();
    assert.equal(f.check(115000), false);
});

test('an exact recent missing-pick refusal can yield without claiming server protection', () => {
    const f = fixture();
    f.bot.serverProtection.isDenied = () => false;
    f.bot.inventory = { items: () => [] };
    const refusal = { type: 'missing-held-pick', observedAt: 100000, world: 'overworld',
        target: { x: -547, y: 41, z: -491 }, blockName: 'spruce_planks' };
    f.bot._retreatDigRefusal = refusal;
    f.prime();
    assert.equal(f.check(115000), true);
    assert.equal(f.events[0].event.type, 'tool-retreat-stall');
    assert.equal(f.events[0].event.constraint, 'missing_pickaxe');
    f.bot.inventory.items = () => [{ name: 'iron_pickaxe' }];
    assert.equal(f.check(115001), false, 'newly available tools must invalidate the local refusal');
    for (const invalid of [{ observedAt: -100000 }, { observedAt: 200000 }, { world: 'the_nether' },
        { target: { x: -548, y: 41, z: -491 } }, { blockName: 'air' }, { type: 'unclassified' }]) {
        f.bot.inventory.items = () => [];
        f.bot._retreatDigRefusal = { ...refusal, ...invalid };
        f.prime();
        assert.equal(f.check(115000), false);
    }
});

test('the production missing-pick guard retains its exact refusal for measured recovery', async () => {
    const f = fixture(), source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const start = source.indexOf('                if (!(await ensurePickForDig(block, seq))) {');
    const end = source.indexOf('                // ★泥土空手闸', start);
    assert(start > 0 && end > start);
    const block = f.bot.blockAt(f.bot.entity.position.floored().offset(0, -1, 0));
    const context = vm.createContext({ bot: f.bot, block, seq: 1, startedAt: 0,
        ensurePickForDig: async () => false, rememberRetreatDigRefusal, write() {},
        blockObj: value => value, envSnap: () => ({}) });
    vm.runInContext('globalThis.guard = async function() {' + source.slice(start, end) + '};', context);
    await assert.rejects(context.guard(), /stone dig blocked without held pick/);
    assert.equal(f.bot._retreatDigRefusal.type, 'missing-held-pick');
    assert.deepEqual(f.bot._retreatDigRefusal.target, { x: -547, y: 41, z: -491 });
});

test('production flee dispatch declines only the measured futile protected retreat', async () => {
    const f = fixture(); let now = 100000, dispatched = 0;
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const list = source.slice(source.indexOf('const modes_list = ['), source.indexOf('async function execute('));
    const context = vm.createContext({ Date: { now: () => now }, Vec3,
        protectedRetreatHandoff, arbiterVitalNow: () => false,
        execute: () => { dispatched++; }, say() {},
    });
    vm.runInContext(list + '\nglobalThis.mode = modes_list.find(m => m.name === "self_preservation");', context);
    // Exercise the exact production dispatch branch without unrelated water,
    // lava and mob fixture dependencies from the rest of the mode.
    const start = source.indexOf('            else if (this.shouldFlee(bot)) {');
    const end = source.indexOf('            else if (agent.isIdle())', start);
    assert(start > 0 && end > start);
    vm.runInContext('globalThis.dispatch = async function(agent) { const bot = agent.bot; if(false) {}'
        + source.slice(start, end) + '};', context);
    context.mode.shouldFlee = () => true;
    context.mode.nearbyHostiles = () => Object.values(f.bot.entities);
    context.mode.nearestCreeper = () => null;
    context.mode.isDay = () => false;
    context.mode.bunkerDown = async () => {};
    const agent = { bot: f.bot, hasExternalAutonomyOwner: () => true };
    for (const stamp of [100000, 105000, 110000, 115000]) {
        now = stamp;
        await context.dispatch.call(context.mode, agent);
    }
    assert.equal(dispatched, 3, 'the fourth failed retreat must release the external planner');
    f.bot.lastDamageTime = now;
    await context.dispatch.call(context.mode, agent);
    assert.equal(dispatched, 4, 'actual damage must restore emergency dispatch');
});
