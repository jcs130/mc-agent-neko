import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import ItemFactory from 'prismarine-item';
import { applyMerchantTrades, merchantOffers, tradeAtWindow, waitForMerchantOffers } from '../src/agent/library/merchant_trades.js';
import { describeMenu, openNpcTradingInterface } from '../src/agent/library/menus.js';
import { showVillagerTrades, tradeWithVillager } from '../src/agent/library/skills.js';

const registry = minecraftData('1.20.6');
const Item = ItemFactory(registry);
const item = (name, count) => new Item(registry.itemsByName[name].id, count);
const notch = (name, count) => Item.toNotch(item(name, count));

function fixture() {
    const bot = new EventEmitter();
    const window = { id: 3, type: 'minecraft:merchant', title: '机关师·小铜', inventoryStart: 3, inventoryEnd: 39,
        slots: Array(39).fill(null) };
    window.slots[3] = item('coal', 64);
    const packet = { windowId: 3, trades: [{ inputItem1: notch('coal', 15), outputItem: notch('emerald', 1),
        tradeDisabled: false, nbTradeUses: 0, maximumNbTradeUses: 16, demand: 0, specialPrice: 0, priceMultiplier: 0.05 }] };
    Object.assign(bot, { registry, _client: new EventEmitter(), currentWindow: window, inventory: {} });
    return { bot, window, packet };
}

test('merchant empty ingredient slots still expose received offers, prices and stock', () => {
    const f = fixture();
    const original = structuredClone(f.packet);
    assert.equal(applyMerchantTrades(f.bot, f.packet), true);
    assert.deepEqual(f.packet, original, 'decode must not mutate packets used by Mineflayer listeners');
    const text = describeMenu(f.bot);
    assert.match(text, /OFFERS received=1/);
    assert.match(text, /trade 1.*coal.*15.*emerald.*1/);
    assert.match(text, /!tradeWindow\(3,/);
    assert.doesNotMatch(text, /\[slot 0\]/);
    assert.deepEqual(merchantOffers(f.window).offers[0].costs, [{ item: 'coal', count: 15 }]);
});

test('two-item prices use current demand and reputation discounts', () => {
    const f = fixture();
    Object.assign(f.packet.trades[0], { inputItem1: notch('emerald', 10), inputItem2: notch('book', 1),
        outputItem: notch('enchanted_book', 1), demand: 2, specialPrice: -3, priceMultiplier: 0.2 });
    assert(applyMerchantTrades(f.bot, f.packet));
    const offer = merchantOffers(f.window).offers[0];
    assert.deepEqual(offer.costs, [{ item: 'emerald', count: 11 }, { item: 'book', count: 1 }]);
    assert.equal(f.window.trades[0].hasItem2, true);
    assert.equal(f.window.trades[0].realPrice, 11);
});

test('unreceived, genuinely empty and malformed offers have distinct states', () => {
    const f = fixture();
    assert.equal(merchantOffers(f.window).status, 'pending');
    assert.match(describeMenu(f.bot), /empty slots do not mean empty trades/);
    assert(applyMerchantTrades(f.bot, { windowId: 3, trades: [] }));
    assert.deepEqual(merchantOffers(f.window).offers, []);
    assert.match(describeMenu(f.bot), /OFFERS received=0/);
    assert.equal(applyMerchantTrades(f.bot, { windowId: 3, trades: [{ inputItem1: notch('coal', 1) }] }), false);
    assert.equal(merchantOffers(f.window).status, 'decode_error');
});

test('late offers cannot populate another merchant or a generic menu', () => {
    const f = fixture();
    assert.equal(applyMerchantTrades(f.bot, { ...f.packet, windowId: 2 }), false);
    assert.equal(f.window.trades, undefined);
    f.window.type = 'minecraft:generic_9x1';
    assert.equal(applyMerchantTrades(f.bot, f.packet), false);
});

test('offers arriving after a custom-menu transition are awaited without reopening the NPC', async () => {
    const f = fixture();
    f.bot.currentWindow = null;
    f.bot.openEntity = async () => { f.bot.currentWindow = f.window; queueMicrotask(() => applyMerchantTrades(f.bot, f.packet)); return f.window; };
    f.bot.openVillager = () => assert.fail('must not reopen a custom NPC after reaching its merchant');
    const result = await openNpcTradingInterface(f.bot, { id: 18 });
    assert.equal(result.window, f.window);
    assert.equal(result.kind, 'merchant');
});

test('bounded offer wait cleans up listeners on timeout and close', async () => {
    const f = fixture();
    assert.equal(await waitForMerchantOffers(f.bot, f.window, 5), false);
    assert.equal(f.bot.listenerCount('merchantOffers'), 0);
    const pending = waitForMerchantOffers(f.bot, f.window, 1000);
    f.bot.emit('windowClose', f.window);
    assert.equal(await pending, false);
    assert.equal(f.bot.listenerCount('end'), 0);
});

test('a current-window trade uses the actual offer and verifies both payment and output', async () => {
    const f = fixture(); applyMerchantTrades(f.bot, f.packet);
    const calls = [];
    f.bot.openEntity = () => assert.fail('must keep the current merchant');
    f.bot.trade = async (...args) => {
        calls.push(args); f.window.slots[3].count = 49; f.window.slots[4] = item('emerald', 1);
        f.bot._client.emit('set_slot', { windowId: 3, slot: 3, item: notch('coal', 49) });
        f.bot._client.emit('set_slot', { windowId: 3, slot: 4, item: notch('emerald', 1) });
    };
    const result = await tradeAtWindow(f.bot, 3, 1, 1);
    assert.equal(result.success, true);
    assert.equal(f.bot.currentWindow, f.window);
    assert.deepEqual(calls, [[f.window, 0, 1]]);
    assert.equal(f.bot._client.listenerCount('set_slot'), 0);
    assert.equal(f.bot._client.listenerCount('window_items'), 0);
});

test('stale IDs, missing offers, exhausted stock, payment shortage and occupied cursors refuse trading', async () => {
    for (const scenario of ['stale', 'missing', 'disabled', 'stock', 'payment', 'cursor', 'input', 'bounds', 'interrupted', 'count']) {
        const f = fixture(); applyMerchantTrades(f.bot, f.packet);
        f.bot.trade = () => assert.fail(scenario);
        if (scenario === 'disabled') f.window.trades[0].tradeDisabled = true;
        if (scenario === 'stock') f.window.trades[0].nbTradeUses = 16;
        if (scenario === 'payment') f.window.slots[3].count = 14;
        if (scenario === 'cursor') f.window.selectedItem = item('dirt', 1);
        if (scenario === 'input') f.window.slots[0] = item('coal', 1);
        if (scenario === 'bounds') f.window.inventoryEnd = 400;
        if (scenario === 'interrupted') f.bot.interrupt_code = true;
        const result = await tradeAtWindow(f.bot, scenario === 'stale' ? 2 : 3, scenario === 'missing' ? 2 : 1, scenario === 'count' ? 0 : 1);
        assert.equal(result.success, false, scenario);
    }
});

test('a transaction without observed inventory changes is not reported successful or automatically retried', async () => {
    const f = fixture(); applyMerchantTrades(f.bot, f.packet);
    let calls = 0; f.bot.trade = async () => { calls++; f.bot.interrupt_code = true; };
    const result = await tradeAtWindow(f.bot, 3, 1, 1);
    assert.equal(result.success, false);
    assert.match(result.message, /not confirmed|outcome unknown/);
    assert.equal(calls, 1);
});

test('optimistic client slots and stale server packets cannot confirm a rejected trade', async () => {
    const f = fixture(); applyMerchantTrades(f.bot, f.packet);
    f.bot.trade = async () => {
        f.window.slots[3].count = 49; f.window.slots[4] = item('emerald', 1);
        f.bot._client.emit('set_slot', { windowId: 2, slot: 3, item: notch('coal', 49) });
        f.bot._client.emit('set_slot', { windowId: 2, slot: 4, item: notch('emerald', 1) });
        f.bot.interrupt_code = true;
    };
    assert.equal((await tradeAtWindow(f.bot, 3, 1, 1)).success, false);
    assert.equal(f.bot._client.listenerCount('set_slot'), 0);
});

test('merchant text stays bounded while retaining current-window trading instructions', () => {
    const f = fixture();
    f.packet.trades = Array.from({ length: 80 }, () => structuredClone(f.packet.trades[0]));
    applyMerchantTrades(f.bot, f.packet);
    for (const trade of f.window.trades) {
        for (const value of [trade.inputItem1, trade.outputItem]) value.components = [
            { type: 'custom_name', data: { type: 'string', value: '说明'.repeat(160) } },
            { type: 'lore', data: ['说明'.repeat(160), '玩法'.repeat(160), '规则'.repeat(160)] },
        ];
    }
    const text = describeMenu(f.bot);
    assert.ok(text.length < 9500, text.length);
    assert.match(text, /Additional offers omitted/);
    assert.match(text, /!tradeWindow\(3,/);
    assert.match(text, /lore/);
});

test('villager inspection retains decoded offers and the original window for the next action', async () => {
    const f = fixture();
    f.bot.entity = { position: new Vec3(0, 0, 0) };
    f.bot.entities = { 18: { id: 18, entityType: registry.entitiesByName.villager.id, position: new Vec3(1, 0, 0) } };
    f.bot.currentWindow = null;
    f.bot.openEntity = async () => { f.bot.currentWindow = f.window; applyMerchantTrades(f.bot, f.packet); return f.window; };
    f.bot.closeWindow = () => assert.fail('inspection must keep the merchant open');
    f.bot.output = '';
    assert.equal(await showVillagerTrades(f.bot, 18), true);
    assert.match(f.bot.output, /OFFERS received=1/);
    assert.equal(f.bot.currentWindow, f.window);
    f.bot.trade = async () => {
        const items = [...f.window.slots]; items[3] = item('coal', 49); items[4] = item('emerald', 1);
        f.bot._client.emit('window_items', { windowId: 3, items: items.map(value => Item.toNotch(value)) });
    };
    // Compatibility entry uses the same quoted prices and confirmation helper.
    f.bot.currentWindow = null;
    assert.equal(await tradeWithVillager(f.bot, 18, 1, 1), true);
    assert.match(f.bot.output, /Confirmed server inventory/);
});
