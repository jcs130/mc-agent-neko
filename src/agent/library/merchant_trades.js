import ItemFactory from 'prismarine-item';
import { readItemIdentity } from './item_identity.js';

export const isMerchantWindow = window => /^(?:minecraft:)?(?:merchant|villager)$/.test(window?.type || '');

// Use the same packet representation and demand/reputation pricing as
// Mineflayer's villager plugin, including windows reached through custom menus.
export function applyMerchantTrades(bot, packet) {
    const window = bot.currentWindow;
    if (!isMerchantWindow(window) || packet.windowId !== window.id || !Array.isArray(packet.trades)) return false;
    try {
        const Item = ItemFactory(bot.registry);
        const trades = packet.trades.map(raw => {
            const inputItem1 = Item.fromNotch(raw.inputItem1);
            const inputItem2 = raw.inputItem2 ? Item.fromNotch(raw.inputItem2) : null;
            const outputItem = Item.fromNotch(raw.outputItem);
            if (!inputItem1 || !outputItem) throw new Error('Missing offer input/output item');
            let realPrice = inputItem1.count;
            if ([raw.demand, raw.specialPrice, raw.priceMultiplier].every(Number.isFinite)) {
                const demand = Math.max(0, Math.floor(realPrice * raw.demand * raw.priceMultiplier));
                realPrice = Math.min(Math.max(realPrice + raw.specialPrice + demand, 1), inputItem1.stackSize);
            }
            return { ...raw, inputItem1, inputItem2, outputItem, realPrice,
                hasItem2: !!inputItem2?.count, inputs: [inputItem1, ...(inputItem2?.count ? [inputItem2] : [])],
                outputs: [outputItem], disabled: !!raw.tradeDisabled || raw.nbTradeUses >= raw.maximumNbTradeUses };
        });
        window.trades = trades;
        window._tradeDecodeError = null;
        bot.emit?.('merchantOffers', window);
        return true;
    } catch (error) {
        window.trades = null;
        window._tradeDecodeError = String(error.message || error).slice(0, 160);
        return false;
    }
}

function offerItem(item, count = item.count) {
    const identity = readItemIdentity(item);
    return { item: item.name, count, ...(identity.customName ? { name: identity.customName.slice(0, 80) } : {}),
        ...(identity.lore.length ? { lore: identity.lore } : {}) };
}

export function merchantOffers(window, maxOffers = 32) {
    if (!isMerchantWindow(window)) return null;
    if (!Array.isArray(window.trades)) return { status: window._tradeDecodeError ? 'decode_error' : 'pending',
        ...(window._tradeDecodeError ? { error: window._tradeDecodeError } : {}) };
    return { status: 'ready', source: 'server trade_list', receivedCount: window.trades.length,
        offers: window.trades.slice(0, maxOffers).map((trade, index) => ({
        index: index + 1, costs: [offerItem(trade.inputItem1, trade.realPrice),
            ...(trade.hasItem2 ? [offerItem(trade.inputItem2)] : [])], result: offerItem(trade.outputItem),
        uses: trade.nbTradeUses, maxUses: trade.maximumNbTradeUses, disabled: !!(trade.disabled || trade.tradeDisabled),
    })), ...(window.trades.length > maxOffers ? { omitted: window.trades.length - maxOffers } : {}) };
}

export async function waitForMerchantOffers(bot, window, timeoutMs = 3000) {
    if (bot.currentWindow !== window || !isMerchantWindow(window)) return false;
    if (Array.isArray(window.trades)) return true;
    if (!bot.on || !bot.off) return false;
    return await new Promise(resolve => {
        let timer;
        const done = value => { clearTimeout(timer); bot.off('merchantOffers', updated); bot.off('windowClose', closed); bot.off('end', closed); resolve(value); };
        const updated = candidate => { if (candidate === window) done(bot.currentWindow === window && Array.isArray(window.trades)); };
        const closed = () => done(false);
        bot.on('merchantOffers', updated); bot.on('windowClose', closed); bot.on('end', closed);
        timer = setTimeout(() => done(false), timeoutMs);
    });
}

function itemCounts(items) {
    const counts = new Map();
    for (const item of items) {
        if (item) counts.set(`${item.type}:${item.metadata || 0}`, (counts.get(`${item.type}:${item.metadata || 0}`) || 0) + item.count);
    }
    return counts;
}

// Mineflayer can optimistically update slots after a click. Confirm against
// received server slots instead, so a rejected trade cannot become a success.
function observeMerchantInventory(bot, window) {
    if (!bot._client?.on || !bot._client?.off) return null;
    const Item = ItemFactory(bot.registry);
    const slots = window.slots.slice(window.inventoryStart, window.inventoryEnd).map(item => item && { ...item });
    let received = false, invalid = false;
    const start = packet => packet.windowId === window.id ? window.inventoryStart
        : packet.windowId === 0 && Number.isInteger(bot.inventory?.inventoryStart) ? bot.inventory.inventoryStart : null;
    const update = packet => {
        const offset = start(packet), index = packet.slot - offset;
        if (offset === null || index < 0 || index >= slots.length) return;
        try { slots[index] = Item.fromNotch(packet.item); received = true; } catch { invalid = true; }
    };
    const replace = packet => {
        const offset = start(packet);
        if (offset === null || !Array.isArray(packet.items) || packet.items.length < offset + slots.length) return;
        try { packet.items.slice(offset, offset + slots.length).forEach((raw, index) => { slots[index] = Item.fromNotch(raw); }); received = true; }
        catch { invalid = true; }
    };
    bot._client.on('set_slot', update); bot._client.on('window_items', replace);
    return { counts: () => received && !invalid ? itemCounts(slots) : null,
        close: () => { bot._client.off('set_slot', update); bot._client.off('window_items', replace); } };
}

export async function tradeAtWindow(bot, windowId, index, count) {
    const fail = message => ({ success: false, message });
    const window = bot.currentWindow;
    if (!isMerchantWindow(window) || window.id !== windowId) return fail('Merchant changed or closed. Query !window again. No trade executed.');
    if (!Number.isSafeInteger(index) || index < 1 || !Number.isSafeInteger(count) || count < 1) return fail('Use an observed 1-based trade number and a positive execution count.');
    if (window.selectedItem || bot.inventory?.selectedItem) return fail('Cursor is holding an item; trade refused.');
    if (!await waitForMerchantOffers(bot, window)) return fail('Current merchant offers are unavailable; empty input slots do not prove there are no offers.');
    if (bot.currentWindow !== window) return fail('Merchant changed while waiting for offers. No trade executed.');
    if (bot.interrupt_code) return fail('Action interrupted before trade submission. No trade executed.');
    if (window.selectedItem || bot.inventory?.selectedItem) return fail('Cursor changed while waiting for offers; trade refused.');
    const trade = window.trades[index - 1];
    if (!trade) return fail(`Trade ${index} was not received. Query !window; do not guess an offer.`);
    if (trade.disabled || trade.tradeDisabled || trade.maximumNbTradeUses - trade.nbTradeUses < count) return fail('Trade disabled, exhausted, or requested count exceeds remaining stock.');
    if (!Array.isArray(window.slots) || !Number.isInteger(window.inventoryStart) || !Number.isInteger(window.inventoryEnd)
        || window.inventoryStart < 3 || window.inventoryEnd <= window.inventoryStart || window.inventoryEnd > window.slots.length)
        return fail('Player inventory boundaries unavailable; trade refused.');
    if (window.slots[0] || window.slots[1]) return fail('Merchant input slots already contain items; inspect/recover them before another trade.');
    const before = itemCounts(window.slots.slice(window.inventoryStart, window.inventoryEnd)), expected = new Map();
    const key = item => `${item.type}:${item.metadata || 0}`;
    const inputs = [[trade.inputItem1, trade.realPrice], ...(trade.hasItem2 ? [[trade.inputItem2, trade.inputItem2.count]] : [])];
    for (const [item, price] of inputs) expected.set(key(item), (expected.get(key(item)) || 0) - price * count);
    for (const [type, delta] of expected) if ((before.get(type) || 0) < -delta) return fail('Not enough payment items at the received current price. No trade executed.');
    expected.set(key(trade.outputItem), (expected.get(key(trade.outputItem)) || 0) + trade.outputItem.count * count);
    const observed = observeMerchantInventory(bot, window);
    if (!observed) return fail('Server inventory confirmation unavailable. No trade executed.');
    try {
        try { await bot.trade(window, index - 1, count); }
        catch (error) { return fail(`Trade not confirmed: ${error.message}. Inspect !window and !inventory before retrying; no automatic retry.`); }
        const deadline = Date.now() + 1200;
        do {
            if (bot.currentWindow !== window) return fail('Merchant changed after submission; transaction outcome unknown. Inspect inventory before retrying.');
            const after = observed.counts();
            if (after && [...expected].some(([, delta]) => delta !== 0) && [...expected].every(([type, delta]) =>
                delta >= 0 ? (after.get(type) || 0) - (before.get(type) || 0) >= delta : (after.get(type) || 0) - (before.get(type) || 0) <= delta)) {
                return { success: true, message: `Confirmed server inventory payment/output for trade ${index} x${count}: ${JSON.stringify(offerItem(trade.outputItem, trade.outputItem.count * count))}.` };
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        } while (Date.now() < deadline && !bot.interrupt_code);
        return fail('Trade submitted but server inventory payment/output was not confirmed. Inspect !inventory; do not blindly repeat the purchase.');
    } finally { observed.close(); }
}
