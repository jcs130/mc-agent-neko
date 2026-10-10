import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as tickConfirm from '../src/agent/library/tick_confirm.js';

const require = createRequire(import.meta.url);
const injectInventory = require('mineflayer/lib/plugins/simple_inventory.js');
const windows = require('prismarine-windows')('1.20.6');
const Item = require('prismarine-item')('1.20.6');
const data = require('minecraft-data')('1.20.6');
const source = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
const highest = source.slice(source.indexOf('async function equipHighestAttack('), source.indexOf('export async function craftRecipe('));
const makeItem = name => new Item(data.itemsByName[name].id, 1);

async function fixture({ menu = 'minecraft:merchant', cursor = false, ready = true, race = false, stale = false } = {}) {
    const inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory');
    for (let slot = 9; slot < 45; slot++) inventory.updateSlot(slot, makeItem(slot === 10 ? 'iron_sword' : 'dirt'));
    const calls = { closed: 0, clicks: [], attacks: 0 }, messages = [];
    const bot = { inventory, currentWindow: null, quickBarSlot: 5, supportFeature: () => false,
        _client: { write() {} }, updateHeldItem() {},
        get heldItem() { return inventory.slots[36 + this.quickBarSlot]; },
        closeWindow(window) {
            calls.closed++;
            for (let n = 0; n < 36; n++) inventory.updateSlot(9 + n, window.slots[window.inventoryStart + n]);
            this.currentWindow = race ? windows.createWindow(99, 'minecraft:merchant', 'New menu') : null;
        },
        async clickWindow(slot, mouseButton, mode) {
            const window = this.currentWindow || inventory;
            calls.clicks.push({ windowId: window.id, slot });
            window.acceptClick({ slot, mouseButton, mode, item: window.slots[slot] });
        },
    };
    injectInventory(bot); // Real dependency, including its hotbar LRU selection.
    const move = async (from, to) => {
        await bot.clickWindow(from, 0, 0);
        await bot.clickWindow(to, 0, 0);
        if (inventory.selectedItem) await bot.clickWindow(from, 0, 0);
    };
    // Prime LRU to slot 39, the first destination outside a merchant's window.
    bot.moveSlotItem = async () => {};
    for (let n = 0; n < 3; n++) await bot.equip(inventory.slots[10], 'hand');
    bot.moveSlotItem = move;
    if (menu) {
        const window = windows.createWindow(6, menu, 'Server menu');
        for (let n = 0; n < 36; n++) window.updateSlot(window.inventoryStart + n, makeItem(n === 1 ? 'iron_sword' : 'dirt'));
        window.updateSlot(0, makeItem('diamond')); // NPC control must never be touched.
        window.selectedItem = cursor ? makeItem('emerald') : null;
        if (ready) window.close = () => {};
        bot.currentWindow = window;
        if (stale) inventory.updateSlot(10, makeItem('dirt'));
    } else if (cursor) inventory.selectedItem = makeItem('emerald');
    const context = vm.createContext({ tickConfirm, log: (_, message) => messages.push(message) });
    vm.runInContext(highest + '\nglobalThis.equipWeapon = equipHighestAttack;', context);
    return { bot, calls, messages, equip: () => context.equipWeapon(bot) };
}

test('combat closes the initialized merchant before the real equipment LRU targets player slot 39', async () => {
    const f = await fixture();
    const menuControl = f.bot.currentWindow.slots[0];
    assert.equal(await f.equip(), true);
    assert.equal(f.calls.closed, 1);
    assert.equal(f.bot.heldItem.name, 'iron_sword');
    assert.ok(f.calls.clicks.every(click => click.windowId === 0));
    assert.equal(menuControl.name, 'diamond');
    assert.equal(f.bot.inventory.selectedItem, null);
});

test('large server menus also close before equipment even when player indices are in their valid range', async () => {
    const f = await fixture({ menu: 'minecraft:generic_9x5' });
    assert.equal(await f.equip(), true);
    assert.equal(f.calls.closed, 1);
    assert.equal(f.bot.heldItem.name, 'iron_sword');
    assert.ok(f.calls.clicks.every(click => click.windowId === 0));
});

test('weapon selection reads inventory copied from the menu instead of a stale player cache', async () => {
    const f = await fixture({ stale: true });
    assert.equal(await f.equip(), true);
    assert.equal(f.bot.heldItem.name, 'iron_sword');
});

test('occupied cursors and uninitialized windows refuse equipment without clicking or closing', async () => {
    for (const options of [{ cursor: true }, { menu: null, cursor: true }, { ready: false }]) {
        const f = await fixture(options);
        const result = await tickConfirm.equipConfirmed(f.bot, 'iron_sword', 'hand', { retries: 1, settleMs: 0, confirmTimeoutMs: 1 });
        assert.equal(result.ok, false);
        assert.equal(result.error_class, 'prerequisite');
        assert.equal(f.calls.closed, 0);
        assert.deepEqual(f.calls.clicks, []);
    }
});

test('a new window racing the close prevents any equipment click', async () => {
    const f = await fixture({ race: true });
    const result = await tickConfirm.equipConfirmed(f.bot, 'iron_sword', 'hand', { retries: 1, settleMs: 0, confirmTimeoutMs: 1 });
    assert.equal(result.ok, false);
    assert.equal(f.calls.closed, 1);
    assert.deepEqual(f.calls.clicks, []);
});

test('confirmed equipment preserves the requested named item across a window refresh', async () => {
    const f = await fixture();
    const requested = f.bot.inventory.slots[10];
    requested.nbt = { type: 'compound', value: { marker: { type: 'string', value: 'personal sword' } } };
    f.bot.currentWindow.slots[4].nbt = requested.nbt;
    const result = await tickConfirm.equipConfirmed(f.bot, requested, 'hand', { settleMs: 0 });
    assert.equal(result.ok, true);
    assert.deepEqual(f.bot.heldItem.nbt, requested.nbt);
    assert.ok(f.calls.clicks.every(click => click.windowId === 0));
});

test('both attack entry points stop when weapon handoff fails', async () => {
    for (const name of ['attackEntity', 'defendSelf']) {
        const start = source.indexOf(`export async function ${name}(`);
        const next = /\nexport (?:async )?function /.exec(source.slice(start + 1));
        const text = source.slice(start, next ? start + 1 + next.index : undefined).replace('export ', '');
        let attacks = 0;
        const entity = { position: {}, name: 'zombie' };
        const context = vm.createContext({ equipHighestAttack: async () => false, log() {}, console,
            world: { getNearestEntityWhere: () => entity, getNearbyEntities: () => [] },
            mc: { isHostile: () => true }, threatCanReachBot: () => true,
            goToGoal: async () => {}, pickupNearbyItems: async () => {}, pf: { goals: {} },
            setTimeout: fn => { fn(); return 1; },
        });
        vm.runInContext(text + `\nglobalThis.run = ${name};`, context);
        const bot = { entity: { position: { distanceTo: () => 3 } }, modes: { pause() {} },
            pvp: { stop() {}, attack() { attacks++; bot.interrupt_code = true; } } };
        assert.equal(await context.run(bot, entity), false);
        assert.equal(attacks, 0);
    }
});
