import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { protectedSurfaceSwimHandoff, protectedWaterExitRoute } from '../src/agent/surface_swim_recovery.js';

function fixture() {
    const events = [];
    const denial = { status: 'deny', allowed: false, action: 'break', world: 'minecraft:overworld',
        x: 0, y: 63, z: 0, observedAt: 100000 };
    const bot = { entity: { position: { x: .5, y: 61, z: .5 } }, health: 20, oxygenLevel: 20,
        game: { dimension: 'overworld' }, serverProtection: { snapshot: () => ({ lastBlocked: denial }) },
        emit: (...args) => events.push(args) };
    const defaults = { externalOwner: true, inWater: true, headWater: false, closeThreat: false };
    const sample = (now, options = {}) => protectedSurfaceSwimHandoff(bot, { ...defaults, now, ...options });
    const stalled = () => [0, 10000, 20000, 30000, 45000].map(t => sample(100000 + t));
    return { bot, denial, events, sample, stalled };
}

test('a protected shallow-water stall yields once after sustained evidence', () => {
    const f = fixture();
    assert.deepEqual(f.stalled(), [false, false, false, false, true]);
    assert.equal(f.bot._surfaceSwimRecovery.type, 'protected-surface-swim-stall');
    assert.equal(f.sample(150000), true);
    assert.equal(f.events.length, 1, 'a yield window does not re-emit each tick');
});

test('the yield ends immediately on drowning, fire, lava, threat, or low health', () => {
    for (const mutation of [f => { f.bot.oxygenLevel = 14; }, f => { f.bot.health = 7; },
        f => { f.bot.entity.isInLava = true; }, f => { f.bot.entity.isOnFire = true; },
        f => { f.bot._currentSkill = 'goToPosition'; }]) {
        const f = fixture(); f.stalled(); mutation(f);
        assert.equal(f.sample(150000), false); assert.equal(f.bot._surfaceSwimRecovery, null);
    }
    for (const options of [{ closeThreat: true }, { headWater: true }, { inWater: false }, { externalOwner: false }]) {
        const f = fixture(); f.stalled(); assert.equal(f.sample(150000, options), false);
    }
});

test('unknown oxygen and unconfirmed, distant, stale, or other-world denials cannot yield', () => {
    for (const mutation of [f => { f.bot.oxygenLevel = undefined; }, f => { f.denial.status = 'unknown'; },
        f => { f.denial.allowed = null; }, f => { f.denial.x = 12; },
        f => { f.denial.world = 'minecraft:the_nether'; }, f => { f.denial.observedAt = -300000; },
        f => { f.denial.observedAt = 500000; }, f => { f.denial.action = 'place'; }]) {
        const f = fixture(); mutation(f); assert.equal(f.stalled().some(Boolean), false);
    }
});

test('actual movement and long observation gaps reset the failed-escape window', () => {
    const f = fixture(); f.sample(100000); f.sample(110000); f.sample(120000);
    f.bot.entity.position.x = 4.5; assert.equal(f.sample(130000), false);
    f.denial.x = 4;
    assert.equal(f.sample(145000), false, 'new location has not stalled for 45 seconds');
    assert.equal(f.sample(170000), false, 'a long unobserved gap is not evidence of a stall');
});

test('small bobbing cannot reset the window, while a new body starts from scratch', () => {
    const f = fixture();
    for (let t = 0; t <= 45000; t += 5000) {
        f.bot.entity.position.x = t % 10000 ? 2 : .5;
        f.sample(100000 + t);
    }
    assert.equal(f.events.length, 1);
    const replacement = { ...f.bot, entity: { ...f.bot.entity }, _surfaceSwimRecovery: null };
    assert.equal(protectedSurfaceSwimHandoff(replacement,
        { externalOwner: true, inWater: true, headWater: false, closeThreat: false, now: 150000 }), false);
});

test('a bounded yield expires without repeatedly renewing itself', () => {
    const f = fixture(); f.stalled();
    for (let t = 150000; t < 235000; t += 10000) assert.equal(f.sample(t), true);
    assert.equal(f.sample(235000), false); assert.equal(f.bot._surfaceSwimRecovery, null);
    assert.equal(f.events.length, 1);
});

test('sustained surface evidence cannot yield a deep-water emergency', () => {
    const f = fixture(); f.bot.entity.position.y = 40;
    assert.equal(f.stalled().some(Boolean), false);
});

function canal({ denied = true } = {}) {
    const block = (name, position) => ({ name, position, boundingBox: ['stone', 'spruce_planks'].includes(name) ? 'block' : 'empty' });
    const bot = { entity: { position: new Vec3(.5, 61, .5) },
        serverProtection: { isDenied: () => denied },
        blockAt(p) {
            if (Math.abs(p.x) > 3 || Math.abs(p.z) > 2) return null;
            if (p.y < 61) return block('stone', p);
            // The east exit requires a north detour around a wall.
            if (p.x === 1 && p.z === 0) return block('stone', p);
            if (p.y < 63) return block('water', p);
            if (p.y === 63 && p.x < 3) return block('spruce_planks', p);
            return block('air', p);
        } };
    return bot;
}

test('protected underwater escape follows a real bend rather than the bank above its roof', () => {
    const bot = canal(), route = protectedWaterExitRoute(bot);
    assert.equal(route.target.x, 3);
    assert.ok(route.steps >= 4);
    assert.notEqual(route.next.z, 0, 'the immediate wall is not a waypoint');
    assert.equal(route.next.y, 61, 'do not steer into the protected ceiling');
});

test('unloaded cells, solid walls, hazards and unsupported air do not create an escape route', () => {
    for (const blocked of [null, { name: 'stone', boundingBox: 'block' },
        { name: 'lava', boundingBox: 'empty' }, { name: 'air', boundingBox: 'empty' }]) {
        const bot = canal(), original = bot.blockAt;
        bot.blockAt = p => p.x !== 0 || p.z !== 0 ? blocked : original(p);
        assert.equal(protectedWaterExitRoute(bot), null);
    }
});

test('a water route requires an exact known ceiling denial and respects its work bound', () => {
    assert.equal(protectedWaterExitRoute(canal({ denied: false })), null);
    assert.equal(protectedWaterExitRoute(canal(), { maxNodes: 1 }), null);
    assert.equal(protectedWaterExitRoute(canal(), { radius: 1 }), null);
});

test('a recent cached denial remains evidence even if lastBlocked is no longer present', () => {
    const f = fixture();
    f.bot.serverProtection.snapshot = () => ({ lastBlocked: null, denied: [f.denial] });
    assert.equal(f.stalled().at(-1), true);
});
