import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import ItemFactory from 'prismarine-item';
import { openBackpack, moveBackpackItem, backpackSource, describeBackpackWindow } from '../src/agent/library/portable_storage.js';
import { collectGameState } from '../src/websocket/game_information.js';
import { Vec3 } from 'vec3';

const registry = minecraftData('1.20.6'), Item = ItemFactory(registry);
const item = (name, count = 1) => new Item(registry.itemsByName[name].id, count);

test('loaded nearby containers expose positions, not invented ownership or contents', () => {
    const bot = { registry, entity: { position: new Vec3(0, 64, 0) }, inventory: { slots: [] },
        findBlocks: options => { assert.equal(options.maxDistance, 16); return [new Vec3(2, 64, 1)]; },
        blockAt: position => ({ name: 'barrel', position, getProperties: () => ({}) }) };
    const containers = collectGameState({ bot }).nearby.containers;
    assert.deepEqual(containers, [{ name: 'barrel', position: { x: 2, y: 64, z: 1 }, distance: 2.2 }]);
});
function fixture() {
    const bot = new EventEmitter();
    const bag = item('player_head');
    bag.components = [{ type: 'custom_name', data: { type: 'string', value: '§e大背包' } }];
    const window = { id: 10, type: 'minecraft:generic_9x3', title: '大背包', inventoryStart: 27, inventoryEnd: 63,
        slots: Array(63).fill(null) };
    window.slots[27] = item('coal', 16);
    const slots = Array(46).fill(null); slots[36] = bag;
    Object.assign(bot, { registry, _client: new EventEmitter(), inventory: { slots }, currentWindow: null,
        equip: async value => { bot.heldItem = value; },
        activateItem: () => queueMicrotask(() => { bot.currentWindow = window; bot.emit('windowOpen', window); }) });
    return { bot, bag, window };
}

test('opens the received named head by its exact slot and reads an empty backpack', async () => {
    const { bot, window } = fixture();
    assert.equal((await openBackpack(bot, 36)).success, true);
    assert.deepEqual(backpackSource(window), { slot: 36, id: 'player_head', name: '大背包' });
    assert.match(describeBackpackWindow(bot), /empty|Empty/);
    assert.match(describeBackpackWindow(bot), /slot 27.*coal/);
    assert.equal(bot.listenerCount('windowOpen'), 0);
});

test('unnamed heads, cursor items and wrong slots never activate an item', async () => {
    for (const mode of ['plain', 'cursor', 'slot']) {
        const f = fixture(); f.bot.activateItem = () => assert.fail(mode);
        if (mode === 'plain') f.bag.components = [];
        if (mode === 'cursor') f.bot.inventory.selectedItem = item('dirt');
        assert.equal((await openBackpack(f.bot, mode === 'slot' ? 5 : 36)).success, false);
    }
});

test('missing and unrelated windows do not claim a backpack or leave listeners', async () => {
    const f = fixture(); f.bot.activateItem = () => {};
    assert.equal((await openBackpack(f.bot, 36, { timeoutMs: 5 })).success, false);
    assert.equal(f.bot.listenerCount('windowOpen'), 0);
    f.window.title = '购买菜单';
    f.bot.activateItem = () => { f.bot.currentWindow = f.window; f.bot.emit('windowOpen', f.window); };
    assert.equal((await openBackpack(f.bot, 36)).success, false);
    assert.equal(backpackSource(f.window), null);
});

test('deposit and withdrawal require real matching server inventory updates', async () => {
    const { bot, window } = fixture(); await openBackpack(bot, 36);
    bot.transfer = async options => {
        assert.equal(options.window, window);
        const from = options.sourceStart, to = from < 27 ? 27 : 0;
        window.slots[from].count -= options.count;
        window.slots[to] = item('coal', (window.slots[to]?.count || 0) + options.count);
        bot._client.emit('window_items', { windowId: window.id, items: window.slots.map(value => Item.toNotch(value)) });
    };
    assert.equal((await moveBackpackItem(bot, 10, 27, 8)).success, true);
    assert.equal((await moveBackpackItem(bot, 10, 0, 8)).success, true);
    assert.equal(window.slots[27].count, 16);
    assert.equal(bot._client.listenerCount('window_items'), 0);
});

test('optimistic slots and packets from another window cannot verify a transfer', async () => {
    const { bot, window } = fixture(); await openBackpack(bot, 36);
    let calls = 0;
    bot.transfer = async () => {
        calls++; window.slots[27].count = 8; window.slots[0] = item('coal', 8);
        bot._client.emit('window_items', { windowId: 99, items: window.slots.map(value => Item.toNotch(value)) });
    };
    const result = await moveBackpackItem(bot, 10, 27, 8, { timeoutMs: 5 });
    assert.equal(result.success, false);
    assert.match(result.message, /not confirmed|unknown/);
    assert.equal(calls, 1);
    assert.equal(bot._client.listenerCount('set_slot'), 0);
});

test('stale, occupied, nested, invalid and full destinations refuse before transfer', async () => {
    for (const mode of ['stale', 'cursor', 'nested', 'count', 'slot', 'full']) {
        const { bot, window, bag } = fixture(); await openBackpack(bot, 36);
        bot.transfer = () => assert.fail(mode);
        if (mode === 'cursor') window.selectedItem = item('dirt');
        if (mode === 'nested') window.slots[27] = bag;
        if (mode === 'full') for (let n = 0; n < 27; n++) window.slots[n] = item('dirt', 64);
        assert.equal((await moveBackpackItem(bot, mode === 'stale' ? 99 : 10,
            mode === 'slot' ? 63 : 27, mode === 'count' ? 0 : 1)).success, false, mode);
    }
});
