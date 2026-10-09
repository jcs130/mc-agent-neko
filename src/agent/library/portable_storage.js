import ItemFactory from 'prismarine-item';
import { plainText } from './books.js';
import { readItemIdentity } from './item_identity.js';

const opened = new WeakMap();
const label = value => plainText(value).replace(/§[0-9a-fk-or]/gi, '');
const backpackText = value => /背包|backpack|portable\s+(?:storage|container)/i.test(value);
const fail = message => ({ success: false, message });
const sameItem = (a, b) => a && b && a.type === b.type && a.metadata === b.metadata
    && JSON.stringify(a.components || []) === JSON.stringify(b.components || [])
    && JSON.stringify(a.nbt || null) === JSON.stringify(b.nbt || null);
const sum = (slots, start, end, item) => slots.slice(start, end)
    .reduce((n, value) => n + (sameItem(value, item) ? value.count : 0), 0);
const validStorage = window => window && /^(?:minecraft:)?generic_9x[1-6]$/.test(window.type || '')
    && Number.isInteger(window.inventoryStart) && window.inventoryStart >= 9 && window.inventoryStart <= 54
    && Number.isInteger(window.inventoryEnd) && window.inventoryEnd > window.inventoryStart
    && Array.isArray(window.slots) && window.inventoryEnd <= window.slots.length;

function hasQuestJournal(window) {
    const item = window?.slots?.[0];
    if (item?.name !== 'written_book') return false;
    const compound = raw => raw?.type === 'compound' ? raw.value : raw;
    const data = item.components?.find(c => String(c.type).replace(/^minecraft:/, '') === 'custom_data')?.data ?? item.nbt;
    const marker = compound(compound(data)?.PublicBukkitValues)?.['betonquest:journal'];
    // The exact server tag identifies BetonQuest's journal, not the translated
    // title or the cosmetic head. Its backpack accepts quest items, not blocks.
    return (marker?.value ?? marker) === 1;
}

export const backpackSource = window => window && opened.has(window) ? { ...opened.get(window) } : null;

export async function openBackpack(bot, slot, { timeoutMs = 2500 } = {}) {
    const item = Number.isInteger(slot) && slot >= 9 && slot <= 45 ? bot.inventory?.slots?.[slot] : null;
    if (!item) return fail('Inventory slot unavailable. Read !inventory before opening a backpack.');
    const identity = readItemIdentity(item);
    if (!backpackText(identity.customName + ' ' + identity.lore.join(' ')))
        return fail('This slot has no received backpack label/lore. A plain player head is not a backpack.');
    if (bot.currentWindow?.selectedItem || bot.inventory?.selectedItem)
        return fail('Cursor holds an item. Inspect it before opening another window.');
    if (bot.interrupt_code) return fail('Interrupted before backpack interaction.');
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    await bot.equip(item, 'hand');
    if (!sameItem(bot.heldItem, item) || bot.interrupt_code) return fail('Held item changed; backpack was not activated.');
    let finish, timer;
    const pending = new Promise(resolve => { finish = resolve; });
    const onWindow = window => finish(window);
    const onEnd = () => finish(null);
    bot.on('windowOpen', onWindow); bot.on('end', onEnd);
    timer = setTimeout(onEnd, timeoutMs);
    try {
        // Right click in air, never place a head on a block. Listen first so a
        // late/synchronous server window cannot disappear between commands.
        bot.activateItem();
        const window = await pending;
        if (bot.currentWindow !== window || !validStorage(window) || !backpackText(label(window.title)))
            return fail('Backpack storage window not confirmed. Inspect !window; do not transfer or blindly repeat.');
        const quest = hasQuestJournal(window);
        opened.set(window, { slot, id: identity.name, name: identity.customName,
            ...(quest ? { kind: 'quest', generalStorage: false } : {}) });
        if (quest) return { success: true, message: `Opened quest backpack ${JSON.stringify(identity.customName)}; window=${window.id}. Server tag betonquest:journal: ordinary items cannot use this as general storage. Read !window for quest journal/menu buttons; use !clickWindow with observed slots.` };
        return { success: true, message: `Opened received backpack ${JSON.stringify(identity.customName)} from inventory slot ${slot}; window=${window.id}, title=${JSON.stringify(label(window.title))}. Read !window for the complete slot table BEFORE moving items; do not guess from inventory slot numbers.` };
    } catch (error) {
        return fail(`Backpack interaction failed: ${error.message}. Inspect !window before retrying.`);
    } finally {
        clearTimeout(timer); bot.off('windowOpen', onWindow); bot.off('end', onEnd);
    }
}

export function describeBackpackWindow(bot) {
    const window = bot.currentWindow, source = backpackSource(window);
    if (!source || !validStorage(window)) return 'No verified backpack window is open.';
    const lines = [`BACKPACK window=${window.id} name=${JSON.stringify(source.name)} base=${source.id}`,
        `${source.kind === 'quest' ? 'Quest menu' : 'Storage'} slots [0,${window.inventoryStart}); player inventory slots [${window.inventoryStart},${window.inventoryEnd}).`,
        source.kind === 'quest'
            ? 'BetonQuest quest backpack: ordinary items cannot be stored here. Use !clickWindow(window_id, observed_menu_slot) for the quest journal/buttons; do not use !moveBackpackItem as a chest transfer.'
            : 'Use !moveBackpackItem(window_id, observed_slot, count). Source in player inventory deposits; source in storage withdraws. Verify received changes.'];
    if (!window.slots.slice(0, window.inventoryStart).some(Boolean)) lines.push('Backpack storage is empty.');
    for (let slot = 0; slot < window.inventoryEnd; slot++) {
        const item = window.slots[slot];
        if (!item) continue;
        const identity = readItemIdentity(item);
        const line = `[slot ${slot}] ${item.name} x${item.count}${identity.customName ? ' | ' + identity.customName : ''}`;
        if (lines.join('\n').length + line.length > 7000) { lines.push('Additional slots omitted; inspect fresh structured window state.'); break; }
        lines.push(line);
    }
    return lines.join('\n');
}

export async function moveBackpackItem(bot, windowId, slot, count, { timeoutMs = 1200 } = {}) {
    const window = bot.currentWindow;
    if (!validStorage(window) || !opened.has(window) || window.id !== windowId)
        return fail('Backpack changed or unverified. Open the observed backpack and query !window again.');
    if (backpackSource(window).kind === 'quest')
        return fail('This is a BetonQuest quest backpack, not general storage. Ordinary material transfers are refused. Read !window for quest journal/buttons and use !clickWindow; no transfer submitted.');
    if (window.selectedItem || bot.inventory?.selectedItem) return fail('Cursor holds an item; transfer refused.');
    if (bot.interrupt_code) return fail('Interrupted before transfer.');
    const item = Number.isInteger(slot) && slot >= 0 && slot < window.inventoryEnd ? window.slots[slot] : null;
    if (!item || !Number.isInteger(count) || count <= 0 || count > item.count) return fail('Invalid observed source slot or count.');
    const identity = readItemIdentity(item);
    if (backpackText(identity.customName + ' ' + identity.lore.join(' '))) return fail('Nested backpack transfer refused.');
    const depositing = slot >= window.inventoryStart;
    const destStart = depositing ? 0 : window.inventoryStart;
    const destEnd = depositing ? window.inventoryStart : window.inventoryEnd;
    const capacity = window.slots.slice(destStart, destEnd).reduce((n, value) => n + (!value ? item.stackSize
        : sameItem(value, item) ? Math.max(0, item.stackSize - value.count) : 0), 0);
    if (!Number.isFinite(capacity) || capacity < count) return fail('Destination has insufficient space; no items moved.');
    if (!bot._client?.on || !bot._client?.off || !bot.registry) return fail('Server confirmation is unavailable; no transfer submitted.');
    const Item = ItemFactory(bot.registry);
    const slots = window.slots.map(value => value && { ...value });
    const sourceBefore = sum(slots, slot, slot + 1, item), destBefore = sum(slots, destStart, destEnd, item);
    let received = false, invalid = false;
    const update = packet => {
        if (packet.windowId !== window.id || !Number.isInteger(packet.slot) || packet.slot < 0 || packet.slot >= slots.length) return;
        try { slots[packet.slot] = Item.fromNotch(packet.item); received = true; } catch { invalid = true; }
    };
    const replace = packet => {
        if (packet.windowId !== window.id || !Array.isArray(packet.items) || packet.items.length < window.inventoryEnd) return;
        try { packet.items.slice(0, slots.length).forEach((raw, index) => { slots[index] = Item.fromNotch(raw); }); received = true; }
        catch { invalid = true; }
    };
    bot._client.on('set_slot', update); bot._client.on('window_items', replace);
    try {
        await bot.transfer({ window, itemType: item.type, metadata: item.metadata, nbt: item.nbt,
            count, sourceStart: slot, sourceEnd: slot + 1, destStart, destEnd });
        const deadline = Date.now() + timeoutMs;
        do {
            if (bot.currentWindow !== window) break;
            if (received && !invalid && !window.selectedItem
                && sourceBefore - sum(slots, slot, slot + 1, item) === count
                && sum(slots, destStart, destEnd, item) - destBefore === count)
                return { success: true, message: `Confirmed server inventory: ${depositing ? 'deposited' : 'withdrew'} ${item.name} x${count} in backpack window ${window.id}.` };
            await new Promise(resolve => setTimeout(resolve, 30));
        } while (Date.now() < deadline && !bot.interrupt_code);
        const current = bot.currentWindow;
        return fail(`Transfer of ${item.name} x${count} from slot ${slot} not confirmed by server inventory. Window before=${window.id}, now=${current?.id ?? 'closed'}${current ? ' title=' + JSON.stringify(label(current.title)) : ''}. Inspect !window and !inventory; no automatic retry.`);
    } catch (error) {
        return fail(`Transfer outcome unknown: ${error.message}. Inspect inventory/cursor before retrying.`);
    } finally {
        bot._client.off('set_slot', update); bot._client.off('window_items', replace);
    }
}
