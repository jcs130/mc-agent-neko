import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import ItemFactory from 'prismarine-item';
import { openBackpack, moveBackpackItem } from '../src/agent/library/portable_storage.js';

const registry = minecraftData('1.20.6'), Item = ItemFactory(registry);
const item = (name, count) => new Item(registry.itemsByName[name].id, count);

async function fixture() {
    const bot = new EventEmitter();
    const window = { id: 15, type: 'minecraft:generic_9x6', title: '大背包',
        inventoryStart: 54, inventoryEnd: 90, slots: Array(90).fill(null) };
    window.slots[21] = item('cobblestone', 2);
    const bag = item('player_head', 1);
    bag.components = [{ type: 'custom_name', data: { type: 'string', value: '大背包' } }];
    const inventory = { slots: Array(46).fill(null) }; inventory.slots[36] = bag;
    Object.assign(bot, { registry, inventory, _client: new EventEmitter(), currentWindow: null,
        equip: value => { bot.heldItem = value; }, activateItem: () => {
            bot.currentWindow = window; bot.emit('windowOpen', window);
        } });
    assert.equal((await openBackpack(bot, 36, { settleMs: 1 })).success, true);
    let submitted = 0;
    bot.transfer = ({ count }) => {
        submitted++;
        const left = window.slots[21].count - count;
        window.slots[21] = left ? item('cobblestone', left) : null;
        window.slots[54] = item('cobblestone', count);
        bot._client.emit('window_items', { windowId: window.id,
            items: window.slots.map(Item.toNotch), carriedItem: Item.toNotch(null) });
    };
    return { bot, window, submitted: () => submitted };
}

test('confirmed withdrawal exposes its actual remaining source rather than a stale table count', async () => {
    const { bot, submitted } = await fixture();
    const result = await moveBackpackItem(bot, 15, 21, 1);
    assert.equal(result.success, true);
    assert.match(result.message, /Source slot 21 now cobblestone x1/);
    assert.equal(submitted(), 1);
});

test('depleted source is explicit after success and on a later invalid repeat', async () => {
    const { bot, submitted } = await fixture();
    const result = await moveBackpackItem(bot, 15, 21, 2);
    assert.equal(result.success, true);
    assert.match(result.message, /Source slot 21 now empty/);
    const refused = await moveBackpackItem(bot, 15, 21, 2);
    assert.equal(refused.success, false);
    assert.match(refused.message, /Invalid observed source slot or count/);
    assert.match(refused.message, /window=15, slot=21, source=empty, requested=2/);
    assert.match(refused.message, /!window/);
    assert.equal(submitted(), 1, 'an invalid repeated request must never transfer');
});

test('excess count reports the current stack without silently reducing the requested quantity', async () => {
    const { bot, submitted } = await fixture();
    const result = await moveBackpackItem(bot, 15, 21, 64);
    assert.equal(result.success, false);
    assert.match(result.message, /source=cobblestone x2, requested=64/);
    assert.equal(submitted(), 0);
});
