import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import data from 'minecraft-data';
import injectCraft from 'mineflayer/lib/plugins/craft.js';
import windows from 'prismarine-windows';
import { makeableRecipes } from '../src/utils/crafting_recipes.js';
import * as inventorySync from '../src/utils/inv_sync.js';

const registry = data('1.20.6');
const source = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
const localCraftSource = source.slice(source.indexOf('export async function craftRecipeLocal('),
    source.indexOf('async function placeCraftingTableWithinReach(')).replace(/^export /, '');

async function runCraft({ stock = { spruce_log: 2 }, full = false, count = 1,
    predict = true, serverAccepts = true, confirmed = true, output = 'spruce_planks',
    occupiedSlots = 0, tableAvailable = false, cursorAfterCraft = false, legacy = false } = {}) {
    const logs = [], packets = [];
    const bot = new EventEmitter();
    bot.registry = registry;
    bot.entity = { position: { distanceTo: () => 0 } };
    bot.inventory = windows('1.20.6').createWindow(0, 'minecraft:inventory', 'Inventory');
    bot.clearControlStates = () => {};
    bot.supportFeature = name => name === (legacy ? 'transactionPacketExists' : 'stateIdUsed');
    const itemsForStock = target => [...target].flatMap(([name, amount]) => {
        const item = registry.itemsByName[name], stacks = [];
        while (amount > 0) {
            const count = Math.min(amount, item.stackSize);
            stacks.push({ name, type: item.id, count, metadata: 0, stackSize: item.stackSize });
            amount -= count;
        }
        return stacks;
    });
    const initial = itemsForStock(new Map(Object.entries(stock)));
    if (full || occupiedSlots) {
        while (initial.length < (full ? 36 : occupiedSlots)) initial.push({ name: 'dirt', type: registry.itemsByName.dirt.id,
            count: 64, metadata: 0, stackSize: 64, nbt: { protected: true } });
    }
    const assign = items => {
        bot.inventory.slots.fill(null);
        items.forEach((item, i) => { bot.inventory.slots[9 + i] = { ...item, slot: 9 + i }; });
    };
    assign(initial);
    const serverStock = new Map(Object.entries(stock));
    const predictedStock = new Map(Object.entries(stock));
    const applyRecipe = (target, recipe, n) => {
        for (const delta of recipe.delta) {
            const name = registry.items[delta.id].name;
            target.set(name, (target.get(name) || 0) + delta.count * n);
        }
    };
    const assignStock = target => assign(itemsForStock(target));
    bot._client = { write(name, packet) {
        packets.push({ name, packet });
        if (name === 'window_click') {
            // Model the authoritative server reply to the existing inventory-resync protocol.
            // This deliberately replaces the optimistic client prediction before confirming.
            queueMicrotask(() => { assignStock(serverStock); bot.emit('setWindowItems:0'); });
        }
    } };
    injectCraft(bot);
    let craftCalls = 0;
    bot.craft = async (recipe, n) => {
        craftCalls++;
        if (predict) { applyRecipe(predictedStock, recipe, n); assignStock(predictedStock); }
        if (serverAccepts) applyRecipe(serverStock, recipe, n);
        if (cursorAfterCraft) bot.inventory.selectedItem = { name: 'spruce_planks', count: 4 };
    };
    const counts = () => Object.fromEntries(bot.inventory.items().reduce((result, item) =>
        result.set(item.name, (result.get(item.name) || 0) + item.count), new Map()));
    const context = vm.createContext({ makeableRecipes, log: (_, s) => logs.push(s),
        resyncInventory: confirmed ? inventorySync.resync : async () => false,
        mc: { getItemId: name => registry.itemsByName[name]?.id,
            getItemCraftingRecipes: name => bot.recipesAll(registry.itemsByName[name].id, null, true),
            ingredientsFromPrismarineRecipe: recipe => Object.fromEntries(recipe.delta.filter(d => d.count < 0)
                .map(d => [registry.items[d.id].name, -d.count])),
            calculateLimitingResource: (available, ingredients) => ({ num: Math.min(...Object.entries(ingredients)
                .map(([name, amount]) => Math.floor((available[name] || 0) / amount))) }) },
        world: { getInventoryCounts: counts, getNearestBlockAsync: async () => tableAvailable
            ? { position: { x: 0, y: 0, z: 0 } } : null },
    });
    vm.runInContext(localCraftSource, context);
    const before = JSON.stringify(bot.inventory.items());
    const ok = await context.craftRecipeLocal(bot, output, count);
    return { ok, logs: logs.join('\n'), craftCalls, packets, counts: counts(),
        inventoryUnchanged: before === JSON.stringify(bot.inventory.items()) };
}

test('a full backpack refuses local craft before consuming or dropping any item', async () => {
    const result = await runCraft({ full: true });
    assert.equal(result.ok, false);
    assert.equal(result.craftCalls, 0);
    assert.equal(result.packets.length, 0);
    assert.equal(result.inventoryUnchanged, true);
    assert.match(result.logs, /inventory.*full|free.*slot/i);
    assert.doesNotMatch(result.logs, /Successfully crafted/);
});

test('server rejection rolls back optimistic output before success is reported', async () => {
    const result = await runCraft({ serverAccepts: false });
    assert.equal(result.ok, false);
    assert.equal(result.craftCalls, 1);
    assert.equal(result.counts.spruce_planks || 0, 0);
    assert.match(result.logs, /not confirmed|not received/i);
    assert.doesNotMatch(result.logs, /Successfully crafted/);
});

test('existing output stock cannot disguise a craft that delivered no new items', async () => {
    const result = await runCraft({ stock: { spruce_log: 2, spruce_planks: 4 }, serverAccepts: false });
    assert.equal(result.ok, false);
    assert.equal(result.counts.spruce_planks, 4);
    assert.doesNotMatch(result.logs, /Successfully crafted/);
});

test('a received whole-inventory snapshot verifies the expected craft output', async () => {
    const result = await runCraft();
    assert.equal(result.ok, true);
    assert.equal(result.counts.spruce_planks, 4);
    assert.equal(result.counts.spruce_log, 1);
    assert.match(result.logs, /Successfully crafted/);
    const click = result.packets.find(p => p.name === 'window_click')?.packet;
    assert.equal(click?.slot, -999);
    assert.equal(click?.stateId, -1);
    assert.equal(click?.cursorItem.itemCount, 0);
});

test('a missing inventory confirmation cannot be advertised as verified success', async () => {
    const result = await runCraft({ confirmed: false });
    assert.equal(result.ok, false);
    assert.match(result.logs, /not confirmed|confirmation/i);
    assert.doesNotMatch(result.logs, /Successfully crafted/);
});

test('a leftover cursor item prevents the empty-cursor verification protocol', async () => {
    const result = await runCraft({ cursorAfterCraft: true });
    assert.equal(result.ok, false);
    assert.equal(result.packets.length, 0);
    assert.match(result.logs, /cursor/);
    assert.doesNotMatch(result.logs, /Successfully crafted/);
});

test('legacy transaction-acknowledged crafts retain success without a modern sync packet', async () => {
    const result = await runCraft({ legacy: true });
    assert.equal(result.ok, true);
    assert.equal(result.counts.spruce_planks, 4);
    assert.equal(result.packets.length, 0);
    assert.match(result.logs, /Successfully crafted/);
});

test('batch capacity is reserved for every output stack', async () => {
    const result = await runCraft({ stock: { spruce_log: 600 }, count: 600 });
    assert.equal(result.ok, false);
    assert.equal(result.craftCalls, 0);
    assert.equal(result.inventoryUnchanged, true);
    assert.match(result.logs, /slot|capacity|space/i);
});

test('an unstackable tool batch reserves one empty slot per crafted tool', async () => {
    const result = await runCraft({ stock: { iron_ingot: 9, stick: 6 }, count: 3,
        occupiedSlots: 35, output: 'iron_pickaxe', tableAvailable: true });
    assert.equal(result.ok, false);
    assert.equal(result.craftCalls, 0);
    assert.equal(result.inventoryUnchanged, true);
    assert.match(result.logs, /free 3 backpack slots/);
});
