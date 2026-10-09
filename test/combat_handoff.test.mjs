import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';
import { hasMeleeWeapon, threatCanReachBot } from '../src/agent/combat_policy.js';

function fixture({ weapon = false, armor = true, mobs = [['zombie', 3]], hurt = false } = {}) {
    const now = 100000;
    const slots = [];
    if (armor) slots[5] = { name: 'iron_helmet' };
    const bot = {
        entity: { id: 0, position: new Vec3(0, 64, 0) },
        inventory: { slots, items: () => weapon ? [{ name: typeof weapon === 'string' ? weapon : 'iron_sword' }] : [{ name: 'wooden_pickaxe' }] },
        entities: Object.fromEntries(mobs.map(([name, distance], index) => [index + 1,
            { id: index + 1, type: 'hostile', name, position: new Vec3(distance, 64, 0) }])),
        lastDamageTime: hurt ? now - 1000 : 0,
        health: 20, food: 20, time: { timeOfDay: 14000 }, on() {},
    };
    const calls = [];
    const context = vm.createContext({
        Date: { now: () => now }, console,
        settings: { proactive_night_shelter: true },
        mc: { isHostile: entity => entity.type === 'hostile' },
        hasMeleeWeapon, threatCanReachBot: (body, entity) => threatCanReachBot(body, entity, now),
        commandedFightActive: () => false, rangedUnreachableTrap: () => false,
        isFutileMob: () => false, unblacklistAttackers() {}, say() {},
        execute: mode => calls.push(mode.name),
        world: { getNearestEntityWhere: (body, predicate, range) => Object.values(body.entities)
            .filter(entity => predicate(entity) && entity.position.distanceTo(body.entity.position) < range)
            .sort((a, b) => a.position.distanceTo(body.entity.position) - b.position.distanceTo(body.entity.position))[0] },
    });
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const solo = source.slice(source.indexOf('function armoredSoloBrawl('), source.indexOf('function rangedUnreachableTrap('));
    const list = source.slice(source.indexOf('const modes_list = ['), source.indexOf('async function execute('));
    vm.runInContext(solo + list + '\nglobalThis.modes = modes_list;', context);
    const preservation = context.modes.find(mode => mode.name === 'self_preservation');
    preservation.coveredNightHoldStatus = () => ({ hold: false });
    const defense = context.modes.find(mode => mode.name === 'self_defense');
    return { bot, calls, preservation, defend: () => defense.update({ bot }) };
}

test('armor without a melee weapon cannot yield retreat to armed combat', () => {
    const f = fixture();
    assert.equal(f.preservation.armoredZombieBrawl(f.bot), false);
    assert.equal(f.preservation.shouldFlee(f.bot), true);
});

test('an unarmed nearby zombie triggers retreat even at full health', () => {
    const f = fixture({ armor: false, mobs: [['zombie', 4.8]] });
    assert.equal(f.preservation.shouldFlee(f.bot), true);
});

test('a distant lone melee mob does not prevent unarmed bootstrap work', () => {
    const f = fixture({ mobs: [['zombie', 7]] });
    assert.equal(f.preservation.shouldFlee(f.bot), false);
});

test('actual recent damage cancels the unarmed bootstrap exemption', () => {
    const f = fixture({ mobs: [['zombie', 7]], hurt: true });
    assert.equal(f.preservation.shouldFlee(f.bot), true);
});

test('an armed solo zombie encounter hands off to actual defense', async () => {
    const f = fixture({ weapon: true });
    assert.equal(f.preservation.shouldFlee(f.bot), false);
    await f.defend();
    assert.deepEqual(f.calls, ['self_defense']);
});

test('a stone axe can finish a close zombie before preventive night shelter', async () => {
    const f = fixture({ weapon: 'stone_axe', armor: false });
    assert.equal(f.preservation.shouldFlee(f.bot), false);
    assert.equal(f.preservation.shouldNightShelter(f.bot), false);
    await f.defend();
    assert.deepEqual(f.calls, ['self_defense']);
});

test('armor cannot hand a three-mob swarm to a combat mode that rejects swarms', async () => {
    const f = fixture({ weapon: true, mobs: [['zombie', 2], ['zombie', 3], ['husk', 4]] });
    assert.equal(f.preservation.armoredZombieBrawl(f.bot), false);
    assert.equal(f.preservation.shouldFlee(f.bot), true);
    await f.defend();
    assert.deepEqual(f.calls, []);
});

test('a fresh disconnected mob behind a wall neither cancels work nor starts combat', async () => {
    const f = fixture({ weapon: true });
    f.bot._threatReach = { 1: { connected: false, at: 99500 } };
    assert.equal(f.preservation.nearbyHostiles(f.bot).length, 0);
    assert.equal(f.preservation.shouldFlee(f.bot), false);
    await f.defend();
    assert.deepEqual(f.calls, []);
});

test('stale or contradicted wall evidence cannot suppress a real threat', async () => {
    for (const [at, hurt] of [[95000, false], [99500, true]]) {
        const f = fixture({ weapon: true, hurt });
        f.bot._threatReach = { 1: { connected: false, at } };
        await f.defend();
        assert.deepEqual(f.calls, ['self_defense']);
    }
});

test('creepers retain retreat priority and are never melee combat targets', async () => {
    const f = fixture({ weapon: true, mobs: [['creeper', 3], ['zombie', 4]] });
    assert.equal(f.preservation.shouldFlee(f.bot), true);
    f.bot.entities = { 1: f.bot.entities[1] };
    await f.defend();
    assert.deepEqual(f.calls, []);
});

test('the inner defense loop also excludes creepers and disconnected targets', async () => {
    const f = fixture({ weapon: true, mobs: [['creeper', 1], ['zombie', 2.9], ['husk', 3.1]] });
    f.bot._threatReach = { 3: { connected: false, at: 99500 } };
    f.bot.modes = { pause() {} };
    const hits = [];
    f.bot.pvp = { attack(entity) { hits.push(entity.name); delete f.bot.entities[entity.id]; }, stop() {} };
    const source = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
    const start = source.indexOf('export async function defendSelf(');
    const end = source.indexOf('// ───────────────────────── DIG PRIMITIVES', start);
    const context = vm.createContext({
        Date: { now: () => 100000 },
        mc: { isHostile: entity => entity.type === 'hostile' },
        threatCanReachBot: (body, entity) => threatCanReachBot(body, entity, 100000),
        world: { getNearestEntityWhere: (body, predicate) => Object.values(body.entities).find(predicate) },
        equipHighestAttack: async () => {}, log() {}, setTimeout: resolve => resolve(),
    });
    vm.runInContext(source.slice(start, end).replace('export ', '') + '\nglobalThis.defend = defendSelf;', context);
    assert.equal(await context.defend(f.bot), true);
    assert.deepEqual(hits, ['zombie']);
});
