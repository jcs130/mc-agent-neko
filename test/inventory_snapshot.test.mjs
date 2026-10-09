import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGameState } from '../src/websocket/game_information.js';
import { getInventoryCounts } from '../src/agent/library/world.js';
import { inventoryIdentityLines } from '../src/agent/library/item_identity.js';
import { playerHeldItem } from '../src/agent/library/inventory_snapshot.js';

function fixture(start = 3) {
    const slots = Array(46).fill(null);
    slots[5] = { name: 'iron_helmet', count: 1 };
    slots[9] = { name: 'iron_ingot', count: 11 };
    slots[45] = { name: 'shield', count: 1 };
    const player = Array(36).fill(null);
    player[0] = { name: 'iron_ingot', count: 5, slot: start };
    player[1] = { name: 'emerald', count: 2, slot: start + 1 };
    const currentWindow = { id: 17, type: 'minecraft:merchant', inventoryStart: start,
        inventoryEnd: start + 36, slots: [...Array(start).fill(null), ...player],
        close() { assert.fail('a snapshot must never close the window'); } };
    currentWindow.slots[0] = { name: 'iron_ingot', count: 3 };
    currentWindow.slots[2] = { name: 'emerald', count: 1 };
    currentWindow.selectedItem = { name: 'diamond', count: 1 };
    return { inventory: { slots, inventoryStart: 9, inventoryEnd: 45, emptySlotCount: () => 35 },
        currentWindow, entity: { position: null } };
}

test('inventory queries read current merchant player slots without counting trade inputs or output', () => {
    const bot = fixture();
    assert.deepEqual(getInventoryCounts(bot), { iron_helmet: 1, iron_ingot: 5, emerald: 2, shield: 1 });
});

test('game snapshot reports current inventory capacity and player slot numbers without mutating caches', () => {
    const bot = fixture();
    const before = JSON.stringify(bot);
    const state = collectGameState({ bot });
    assert.deepEqual(state.inventory.counts, { iron_ingot: 5, emerald: 2, shield: 1 });
    assert.equal(state.inventory.emptySlots, 34);
    assert.equal(state.inventory.slots.find(item => item.name === 'emerald').slot, 10);
    assert.equal(state.self.equipment[0].name, 'iron_helmet');
    assert.equal(state.self.offhand.name, 'shield');
    assert.equal(JSON.stringify(bot), before);
});

test('custom item identity follows the active container player slots', () => {
    const bot = fixture(54);
    bot.currentWindow.slots[55] = { name: 'player_head', count: 1, slot: 55, customName: '大背包' };
    assert.match(inventoryIdentityLines(bot), /\[slot 10\] player_head x1.*大背包/);
    assert.equal(getInventoryCounts(bot).player_head, 1);
    assert.equal(getInventoryCounts(bot).emerald, undefined, 'container output is not carried inventory');
});

test('uninitialized windows and invalid player ranges retain the known player cache', () => {
    for (const change of [window => { delete window.close; }, window => { window.inventoryEnd--; },
        window => { window.inventoryStart = -1; }, window => { window.slots.length = 2; }]) {
        const bot = fixture();
        change(bot.currentWindow);
        assert.equal(getInventoryCounts(bot).iron_ingot, 11);
        assert.equal(collectGameState({ bot }).inventory.emptySlots, 35);
    }
});

test('closing the window uses the subsequently synchronized base cache', () => {
    const bot = fixture();
    bot.inventory.slots[9] = { name: 'iron_ingot', count: 5 };
    bot.inventory.slots[10] = { name: 'emerald', count: 2 };
    bot.currentWindow = null;
    assert.equal(getInventoryCounts(bot).iron_ingot, 5);
    assert.equal(getInventoryCounts(bot).emerald, 2);
    assert.equal(collectGameState({ bot }).inventory.emptySlots, 35);
});

test('held item observation follows the selected player hotbar slot in the current window', () => {
    const bot = fixture();
    bot.quickBarSlot = 0;
    bot.heldItem = { name: 'iron_ingot', count: 11 };
    bot.currentWindow.slots[30] = { name: 'emerald', count: 2 };
    assert.equal(playerHeldItem(bot).name, 'emerald');
    assert.equal(collectGameState({ bot }).inventory.held.name, 'emerald');
    bot.currentWindow.slots[30] = null;
    assert.equal(collectGameState({ bot }).inventory.held, null);
    bot.currentWindow = null;
    assert.equal(playerHeldItem(bot), bot.heldItem);
});
