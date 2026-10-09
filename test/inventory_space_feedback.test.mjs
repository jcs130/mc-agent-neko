import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as snapshots from '../src/agent/library/inventory_snapshot.js';
import { getInventoryCounts } from '../src/agent/library/world.js';

function query(bot) {
    const context = vm.createContext({ world: { getInventoryCounts },
        inventoryIdentityLines: () => '', inventorySpaceFeedback: snapshots.inventorySpaceFeedback });
    const source = readFileSync(new URL('../src/agent/commands/queries.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, context);
    return vm.runInContext('queryList.find(q => q.name === "!inventory")', context).perform({ bot });
}

function fixture() {
    const slots = Array(46).fill(null);
    slots[5] = { name: 'iron_helmet', count: 1 };
    for (let index = 9; index < 45; index++) slots[index] = { name: 'cobblestone', count: index === 9 ? 64 : 1 };
    return { inventory: { slots }, game: { gameMode: 'survival' } };
}

test('the actual inventory query exposes full capacity and exact stacks instead of suggesting partial toss frees a slot', () => {
    const bot = fixture();
    const before = JSON.stringify(bot);
    const output = query(bot);
    assert.match(output, /BACKPACK: 0 free storage slots/);
    assert.match(output, /\[slot 9\] cobblestone x64/);
    assert.match(output, /part of a stack.*no slot/);
    assert.doesNotMatch(output, /\[slot 5\]/);
    assert.equal(JSON.stringify(bot), before);
});

test('capacity and stacks follow initialized merchant player slots, excluding trade and cursor items', () => {
    const bot = fixture();
    const slots = Array(39).fill(null);
    slots[0] = { name: 'diamond', count: 1 };
    slots[3] = { name: 'emerald', count: 4 };
    bot.currentWindow = { inventoryStart: 3, inventoryEnd: 39, slots, close() {},
        selectedItem: { name: 'iron_ingot', count: 2 } };
    const output = query(bot);
    assert.match(output, /BACKPACK: 35 free storage slots/);
    assert.match(output, /CURSOR: iron_ingot x2/);
    assert.doesNotMatch(output, /STORAGE STACKS|diamond|cobblestone/);
    assert.match(output, /emerald: 4/);
});

test('normal roomy inventory stays brief and unknown capacity stays unknown', () => {
    const roomy = fixture();
    roomy.inventory.slots.fill(null, 9, 45);
    assert.match(query(roomy), /BACKPACK: 36 free storage slots/);
    assert.doesNotMatch(query(roomy), /STORAGE STACKS|part of a stack/);
    assert.match(query({ inventory: { slots: [] }, game: {} }), /BACKPACK: unknown/);
});

test('uninitialized merchant windows cannot erase capacity from the known base inventory', () => {
    const bot = fixture();
    bot.currentWindow = { inventoryStart: 3, inventoryEnd: 39, slots: Array(39).fill(null) };
    assert.match(query(bot), /BACKPACK: 0 free storage slots/);
});
