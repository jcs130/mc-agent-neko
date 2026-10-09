import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the complete skill with an offline block world and movement adapter.
// No Minecraft connection, pathfinder or model is created by this fixture.
function fixture({ lease, bedY = 70, skipBedUntil } = {}) {
    const clock = { now: 100000 };
    const calls = { bedTrips: [], digs: [], logs: [] };
    class Vec3 {
        constructor(x, y, z) { Object.assign(this, { x, y, z }); }
        clone() { return new Vec3(this.x, this.y, this.z); }
        distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z); }
    }
    const removed = new Set();
    let lookTarget;
    const bot = {
        _extIntentUntil: lease, _mdSkipBedAnchorUntil: skipBedUntil,
        _world: { landmarks: { bed: { x: 30.5, y: bedY, z: 0.5 } } },
        entity: { position: new Vec3(0.5, 70, 0.5), onGround: true },
        entities: {}, health: 20, food: 20,
        inventory: { items: () => [{ name: 'wooden_pickaxe', count: 1,
            maxDurability: 59, durabilityUsed: 0 }], emptySlotCount: () => 35 },
        waitForChunksToLoad: async () => {},
        blockAt(p) { return { name: removed.has(`${p.x},${p.y},${p.z}`) ? 'air' : 'stone',
            boundingBox: removed.has(`${p.x},${p.y},${p.z}`) ? 'empty' : 'block' }; },
        lookAt: async p => { lookTarget = p; },
        setControlState(name, enabled) {
            if (name === 'forward' && enabled) {
                this.entity.position = new Vec3(lookTarget.x, Math.floor(lookTarget.y), lookTarget.z);
            }
        },
        clearControlStates() {}, pathfinder: { stop() {} },
    };
    const ctx = { Vec3, mc: { isHostile: () => false }, log: (_bot, message) => calls.logs.push(message),
        skills: {
            async goToPosition(_bot, x, y, z, range) {
                calls.bedTrips.push({ x, y, z, range });
                bot.entity.position = new Vec3(x, bedY, z);
            },
            async breakBlockAt(_bot, x, y, z) {
                calls.digs.push({ x, y, z }); removed.add(`${x},${y},${z}`); return true;
            },
            pickRunway: () => ({ aboutToBreak: false, canFieldCraftPick: false }),
        },
    };
    const source = readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '')
        .replace('export default async function mineDown', 'async function mineDown')
        .replace(/^export \{.*\};\r?$/gm, '');
    const context = vm.createContext({
        Date: { now: () => clock.now },
        setTimeout(callback, delay) {
            // The winning chunk/bed promises resolve immediately. Their losing
            // timeout branches must neither advance this clock nor create timers.
            if (delay !== 3000 && delay !== 45000) { clock.now += delay; callback(); }
            return 0;
        },
        collectExposedOresDuringDescent: async () => ({ mined: 0 }),
    });
    vm.runInContext(source + '\nglobalThis.runMineDown = mineDown;', context);
    const run = () => context.runMineDown(bot, ctx, { steps: 1, targetY: 45 });
    return { bot, calls, run };
}

test('a fresh external task descends at its current location without returning to the remembered bed', async () => {
    const f = fixture({ lease: 100001 });
    const result = await f.run();
    assert.deepEqual(f.calls.bedTrips, [], 'an explicit local mining goal must not navigate home first');
    assert.deepEqual(f.calls.digs, [{ x: 1, y: 71, z: 0 }, { x: 1, y: 70, z: 0 }, { x: 1, y: 69, z: 0 }]);
    assert.equal(f.bot.entity.position.x, 1.5);
    assert.equal(result.endY, 69);
    assert.equal(result.dug, 3);
    assert.equal(result.failed, undefined, 'the actual local descent must count as progress');
});

for (const [label, lease] of [['stale', 99999], ['expired now', 100000], ['absent', undefined]]) {
    test(`${label} external lease preserves the legacy bed-first entrance`, async () => {
        const f = fixture({ lease });
        const result = await f.run();
        assert.deepEqual(f.calls.bedTrips, [{ x: 30.5, y: null, z: 0.5, range: 6 }]);
        assert.equal(f.calls.digs[0].x, 31, 'standalone descent still begins near the remembered bed');
        assert.equal(result.endY, 69);
    });
}

test('a stale task already below the bed keeps the existing below-bed relocation safeguard', async () => {
    const f = fixture({ lease: 99999, bedY: 80 });
    await f.run();
    assert.deepEqual(f.calls.bedTrips, []);
    assert.equal(f.calls.digs[0].x, 1);
});

test('a recent all-aborted-anchor relocation keeps its legacy bed-skip safeguard', async () => {
    const f = fixture({ skipBedUntil: 100001 });
    await f.run();
    assert.deepEqual(f.calls.bedTrips, []);
    assert.equal(f.calls.digs[0].x, 1);
});
