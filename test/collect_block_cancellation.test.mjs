import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
const collect = source.slice(source.indexOf('export async function collectBlock('),
    source.indexOf('export async function harvestConnectedVein(')).replace('export async function', 'async function');

function fixture({ onScan, onEquip, onDig, empty = false, harvestable = true, denied = false } = {}) {
    const calls = { scans: 0, equips: 0, digs: 0, cleanup: 0, pickups: 0 };
    let gained = 0;
    const position = (x = 1, y = 64, z = 0) => ({ x, y, z,
        offset(dx, dy, dz) { return position(x + dx, y + dy, z + dz); },
        distanceTo(p) { return Math.hypot(x - p.x, y - p.y, z - p.z); },
    });
    const block = p => ({ name: 'wheat', position: p, canHarvest: () => harvestable });
    const bot = {
        interrupt_code: false, death_abort: false, health: 20, _actionGeneration: 4,
        entity: { position: position(0) },
        inventory: { items: () => gained ? [{ name: 'wheat', count: gained }] : [] },
        blockAt: p => block(p),
        serverProtection: { isDenied: () => denied },
        tool: { async equipForBlock() { calls.equips++; await onEquip?.(bot); } },
    };
    class Movements {
        blocksCantBreak = new Set();
        liquids = new Set();
        safeToBreak() { return true; }
    }
    const context = vm.createContext({
        setImmediate, setTimeout, Vec3: function (x, y, z) { return position(x, y, z); },
        pf: { Movements }, mc: { getBlockId: name => name === 'wheat' ? 1 : null },
        world: {
            async getNearestBlocksWhereAsync() {
                calls.scans++;
                await onScan?.(bot);
                return empty ? [] : [block(position(calls.scans))];
            },
            async getNearestBlockAsync() { return null; },
        },
        oreCollectSpec: () => null, collectOreBlockTypes: name => [name], collectDropItemName: name => name,
        beginUnderwaterMiningTask: () => () => { calls.cleanup++; },
        _deathLinesCached: () => [], appendTelemetry() {}, log() {},
        async safeDig() {
            calls.digs++;
            if (onDig) return onDig(bot, calls.digs, () => { gained++; });
            gained++;
            return 'ok';
        },
        async pickupNearbyItems() { calls.pickups++; }, async ensurePickupAt() {},
        async goToPosition() {}, async autoLight() {},
    });
    vm.runInContext(collect + '\nglobalThis.collect = collectBlock;', context);
    return { bot, calls, run: () => context.collect(bot, 'wheat', 2) };
}

test('collection cancelled before entry does no scan or body work', async () => {
    const f = fixture(); f.bot.interrupt_code = true;
    assert.equal(await f.run(), false);
    assert.equal(f.calls.scans, 0);
    assert.equal(f.calls.equips, 0);
    assert.equal(f.calls.cleanup, 1);
});

test('cancellation during world scan prevents equipment and digging', async () => {
    const f = fixture({ onScan: bot => { bot.interrupt_code = true; } });
    assert.equal(await f.run(), false);
    assert.equal(f.calls.equips, 0);
    assert.equal(f.calls.digs, 0);
    assert.equal(f.calls.cleanup, 1);
});

for (const result of ['error', 'gone']) {
    test(`cancelled ${result} dig cannot retry through continue`, async () => {
        const f = fixture({ onDig: bot => { bot.interrupt_code = true; return result; } });
        assert.equal(await f.run(), false);
        assert.equal(f.calls.digs, 1);
        assert.equal(f.calls.scans, 1);
        assert.equal(f.calls.cleanup, 1);
    });
}

test('cancellation during tool equip prevents the next dig', async () => {
    const f = fixture({ onEquip: bot => { bot.interrupt_code = true; } });
    assert.equal(await f.run(), false);
    assert.equal(f.calls.digs, 0);
});

for (const reason of ['death_abort', 'health', 'generation']) {
    test(`${reason} stops stale collection work after an awaited scan`, async () => {
        const f = fixture({ onScan: bot => {
            if (reason === 'generation') bot._actionGeneration++;
            else if (reason === 'health') bot.health = 0;
            else bot.death_abort = true;
        } });
        assert.equal(await f.run(), false);
        assert.equal(f.calls.digs, 0);
    });
}

test('a normal failed target still retries and reports only actual inventory gain', async () => {
    const f = fixture({ onDig: (_bot, attempt, gain) => {
        if (attempt === 1) return 'error';
        gain(); return 'ok';
    } });
    assert.equal(await f.run(), true);
    assert.equal(f.calls.digs, 3);
    assert.equal(f.calls.cleanup, 1);
});

test('zero drop harvest is not reported as successful collection', async () => {
    const f = fixture({ onDig: () => 'ok' });
    assert.equal(await f.run(), false);
    assert.equal(f.calls.digs, 2);
});

test('interruption preserves an already received drop without more body work', async () => {
    const f = fixture({ onDig: (bot, _attempt, gain) => {
        gain(); bot.interrupt_code = true; return 'ok';
    } });
    assert.equal(await f.run(), true);
    assert.equal(f.calls.digs, 1);
    assert.equal(f.calls.scans, 1);
    assert.equal(f.calls.pickups, 0);
    assert.equal(f.calls.cleanup, 1);
});

test('known protection refusals keep scan candidates out of body work', async () => {
    const f = fixture({ denied: true });
    assert.equal(await f.run(), false);
    assert.equal(f.calls.digs, 0);
    assert.equal(f.calls.equips, 0);
});

test('absent blocks and unharvestable blocks remain failures', async () => {
    for (const options of [{ empty: true }, { harvestable: false }]) {
        const f = fixture(options);
        assert.equal(await f.run(), false);
        assert.equal(f.calls.digs, 0);
        assert.equal(f.calls.cleanup, 1);
    }
});
