import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';

// Exercise the real bunkerDown handler and its real unreachable-threat predicate,
// including the failed-seal branch. The bounded fake clock stops the old long
// loop after three attempted hops instead of leaving a failed test hanging.
function fixture({ boxed = false, hurt = false, creeper = false, stale = false,
    openObservation = false, boxAfterHop = false, stopAfterHop = false } = {}) {
    let now = 100000;
    const calls = { digs: 0, hops: 0, clears: 0 };
    const bot = {
        entity: { position: new Vec3(.5, 29, .5) },
        health: 20, food: 20, lastDamageTime: hurt ? now - 1000 : 0,
        time: { timeOfDay: 16000 }, interrupt_code: false,
        inventory: { slots: [], items: () => [{ name: 'bread', count: 7 }] },
        entities: { 1: { name: 'zombie', position: new Vec3(1.3, 29, .5) } },
        _mobility: { state: 'FREE', enclosed: false, exits: [[1, 0]] },
        blockAt(p) { return { name: p.y < 29 ? 'stone' : 'air',
            boundingBox: p.y < 29 ? 'block' : 'empty', position: p.floored() }; },
        clearControlStates() { calls.clears++; }, setControlState() {},
    };
    const observeBox = () => {
        bot._world = { ts: stale ? now - 6000 : now,
            mobility: { state: 'ENTOMBED', enclosed: true, exits: [] } };
    };
    if (boxed) observeBox();
    if (openObservation) {
        bot._mobility = { state: 'ENTOMBED', enclosed: true, exits: [] };
        bot._world = { ts: now, mobility: { state: 'FREE', enclosed: false, exits: [[1, 0]] } };
    }
    if (creeper) bot.entities[2] = { name: 'creeper', position: new Vec3(3.5, 29, .5) };
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const trapStart = source.indexOf('function rangedUnreachableTrap(');
    const trapEnd = source.indexOf('\n// ★C360', trapStart);
    const listStart = source.indexOf('const modes_list = [');
    const listEnd = source.indexOf('async function execute(', listStart);
    assert(trapStart >= 0 && trapEnd > trapStart && listEnd > listStart);
    const context = vm.createContext({
        Date: { now: () => now }, Vec3,
        fs: { appendFileSync() {} }, say() {},
        mc: { isHostile: e => /zombie|creeper/.test(e.name) },
        world: { getInventoryCounts: () => ({ bread: 7 }) },
        skills: { isPlankBlock: () => false,
            async digDown() { calls.digs++; },
            async wait(body, ms) { now += ms; },
        },
        setTimeout(done, ms) {
            now += ms;
            if (calls.hops >= 3) bot.interrupt_code = true;
            done();
        },
    });
    const matcher = source.match(/^const FILL_RE = .+;$/m)?.[0];
    assert(matcher);
    vm.runInContext(matcher + source.slice(trapStart, trapEnd) + source.slice(listStart, listEnd)
        + '\nglobalThis.mode = modes_list.find(m => m.name === "self_preservation");', context);
    const mode = context.mode;
    mode.coveredNightHoldStatus = () => ({ hold: false });
    mode.sealedNightBox = () => false;
    mode.nearbyHostiles = () => Object.values(bot.entities);
    mode.nearestCreeper = (body, range) => Object.values(body.entities)
        .find(e => e.name === 'creeper' && e.position.distanceTo(body.entity.position) < range);
    mode.safeFleeTarget = () => new Vec3(4, 29, .5);
    mode.fleeMove = async () => {
        calls.hops++;
        if (boxAfterHop) observeBox();
        if (stopAfterHop) bot.interrupt_code = true;
    };
    return { bot, calls, run: () => mode.bunkerDown({ bot }) };
}

test('an already boxed non-damaging threat yields before digging another bunker', async () => {
    const f = fixture({ boxed: true });
    await f.run();
    assert.equal(f.calls.digs, 0, 'recovery must not be driven deeper by another defensive dig');
    assert.equal(f.calls.hops, 0);
});

test('a failed-seal retreat returns when its next observation becomes an unreachable pocket', async () => {
    const f = fixture({ boxAfterHop: true });
    await f.run();
    assert.equal(f.calls.hops, 1, 'the running retreat must re-evaluate, not own the body until dawn');
    assert.equal(f.bot.interrupt_code, false, 'yield is a normal return, not a fabricated stop');
    assert(f.calls.clears > 0);
});

test('actual recent damage retains emergency retreat inside boxed geometry', async () => {
    const f = fixture({ boxed: true, hurt: true });
    await f.run();
    assert(f.calls.digs > 0);
    assert(f.calls.hops > 0);
});

test('a nearby creeper retains priority over the boxed non-damaging zombie', async () => {
    const f = fixture({ boxed: true, creeper: true });
    await f.run();
    assert(f.calls.hops > 0);
});

test('stale boxed observation cannot suppress retreat from current open geometry', async () => {
    const f = fixture({ boxed: true, stale: true });
    await f.run();
    assert.equal(f.calls.hops, 3);
});

test('fresh open geometry overrides an obsolete trapped mode for bunker entry', async () => {
    const f = fixture({ openObservation: true });
    await f.run();
    assert.equal(f.calls.hops, 3);
});

test('a new real stop still ends the failed-seal retreat at its next iteration', async () => {
    const f = fixture({ stopAfterHop: true });
    await f.run();
    assert.equal(f.calls.hops, 1);
    assert.equal(f.bot.interrupt_code, true);
});
