import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const simpleInventory = require('mineflayer/lib/plugins/simple_inventory.js');
const source = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
function actualFunction(name) {
    const start = source.indexOf(`export async function ${name}(`);
    const next = /\n\s*export (?:async )?function /.exec(source.slice(start + 1));
    const end = next ? start + 1 + next.index : -1;
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end).replace('export ', '');
}

function fixture({ empty = [], menu = false, cursor = false, ready = true, race = false, failedMove = false } = {}) {
    const slots = Array(46).fill(null);
    for (let i = 9; i < 45; i++) slots[i] = { name: i === 41 ? 'iron_pickaxe' : 'dirt', count: 1, slot: i };
    const calls = { clicks: [], moves: [], closed: 0, activated: 0 }, messages = [];
    const bot = { currentWindow: null, quickBarSlot: 5, inventory: { slots, selectedItem: null,
        firstEmptyInventorySlot: () => slots.findIndex((item, i) => i >= 9 && i < 45 && !item) === -1
            ? null : slots.findIndex((item, i) => i >= 9 && i < 45 && !item) },
        game: { gameMode: 'survival' }, supportFeature: () => false,
        _client: { write() {} }, updateHeldItem() {},
        get heldItem() { return slots[36 + this.quickBarSlot]; },
        closeWindow(window) {
            calls.closed++;
            for (let i = 0; i < 36; i++) slots[9 + i] = window.slots[3 + i];
            this.currentWindow = null;
        },
        async clickWindow(slot) {
            calls.clicks.push(slot);
            const limit = this.currentWindow ? 39 : 45;
            assert.ok(slot === -999 || slot >= 0 && slot < limit, 'invalid operation');
        },
        async moveSlotItem(from, to) {
            assert.equal(this.currentWindow, null, 'player indices must not address an NPC menu');
            calls.moves.push([from, to]);
            if (!failedMove) { slots[to] = slots[from]; slots[from] = null; }
        },
    };
    simpleInventory(bot); // Use the dependency's real unequip/drop fallback in the red reproduction.
    if (menu) {
        bot.currentWindow = { id: 5, type: 'minecraft:merchant', inventoryStart: 3, inventoryEnd: 39,
            slots: [null, null, null, ...slots.slice(9, 45)], selectedItem: cursor ? { name: 'diamond' } : null };
        if (ready) bot.currentWindow.close = () => {};
        for (const slot of empty) bot.currentWindow.slots[slot - 6] = null;
    } else {
        for (const slot of empty) slots[slot] = null;
        if (cursor) bot.inventory.selectedItem = { name: 'diamond' };
    }
    const context = vm.createContext({ log: (_, text) => messages.push(text),
        tickConfirm: { sleepMs: async () => {
            if (race && calls.closed) bot.currentWindow = { id: 99 };
        }, useOnEntityConfirmed: async () => { calls.activated++; return { ok: true }; } },
        world: { isEntityType: () => true, getNearestEntityWhere: () => ({ position: { x: 0, y: 64, z: 0 } }) },
        goToPosition: async () => true,
    });
    vm.runInContext(actualFunction('equip') + actualFunction('useToolOn')
        + '\nglobalThis.runEquip = equip; globalThis.runUse = useToolOn;', context);
    return { bot, calls, messages, equip: () => context.runEquip(bot, 'hand'),
        use: () => context.runUse(bot, 'hand', 'villager') };
}

test('full inventory with a merchant open refuses empty-hand interaction without wrong slots or dropping the pickaxe', async () => {
    const f = fixture({ menu: true });
    assert.equal(await f.use(), false);
    assert.equal(f.calls.closed, 1);
    assert.deepEqual(f.calls.clicks, []);
    assert.deepEqual(f.calls.moves, []);
    assert.equal(f.bot.inventory.slots[41].name, 'iron_pickaxe');
    assert.equal(f.calls.activated, 0);
    assert.match(f.messages.join('\n'), /empty.*slot|space/i);
});

test('an initialized merchant projects its actual free hotbar slot when closing before empty-hand selection', async () => {
    const f = fixture({ menu: true, empty: [38] });
    assert.equal(await f.use(), true);
    assert.equal(f.calls.closed, 1);
    assert.equal(f.bot.quickBarSlot, 2);
    assert.deepEqual(f.calls.clicks, []);
    assert.deepEqual(f.calls.moves, []);
    assert.equal(f.calls.activated, 1);
});

test('a full ordinary backpack never triggers the dependency automatic toss fallback', async () => {
    const f = fixture();
    assert.equal(await f.equip(), false);
    assert.deepEqual(f.calls.clicks, []);
    assert.equal(f.bot.heldItem.name, 'iron_pickaxe');
});

test('empty hand preserves the entire equipped item in a verified storage slot when the hotbar is full', async () => {
    const f = fixture({ empty: [12] });
    assert.equal(await f.equip(), true);
    assert.deepEqual(f.calls.moves, [[41, 12]]);
    assert.equal(f.bot.inventory.slots[12].name, 'iron_pickaxe');
    assert.equal(f.bot.heldItem, null);
    assert.deepEqual(f.calls.clicks, []);
});

test('an occupied cursor or uninitialized menu is preserved without closing or clicking it', async () => {
    for (const options of [{ cursor: true }, { menu: true, cursor: true }, { menu: true, ready: false }]) {
        const f = fixture(options);
        assert.equal(await f.equip(), false);
        assert.equal(f.calls.closed, 0);
        assert.deepEqual(f.calls.clicks, []);
        assert.deepEqual(f.calls.moves, []);
    }
});

test('a new menu racing the close or an ineffective item move cannot be reported as an empty hand', async () => {
    for (const options of [{ menu: true, empty: [12], race: true }, { empty: [12], failedMove: true }]) {
        const f = fixture(options);
        assert.equal(await f.equip(), false);
        assert.deepEqual(f.calls.clicks, []);
        assert.equal(f.calls.activated, 0);
        assert.equal(f.bot.inventory.slots[41].name, 'iron_pickaxe');
    }
});

test('the real useOn command propagates a refused interaction through the action wrapper', async () => {
    const context = vm.createContext({ skills: { useToolOn: async () => false, log() {} } });
    const actions = readFileSync(new URL('../src/agent/commands/actions.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(actions, context);
    const command = vm.runInContext('actionsList.find(a => a.name === "!useOn")', context);
    const agent = { bot: {}, actions: { runAction: async (_, fn) => {
        await fn(); return { message: 'No empty storage slot.', interrupted: false, timedout: false };
    } } };
    assert.match(await command.perform(agent, 'hand', 'villager'), /^Action failed:/);
});
