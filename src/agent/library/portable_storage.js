import ItemFactory from 'prismarine-item';
import { plainText } from './books.js';
import { readItemIdentity } from './item_identity.js';
import { sameInventoryStack } from './inventory_stack.js';

const opened = new WeakMap();
const label = value => plainText(value).replace(/§[0-9a-fk-or]/gi, '');
const backpackText = value => /背包|backpack|portable\s+(?:storage|container)/i.test(value);
const fail = message => ({ success: false, message });
const sameItem = (a, b) => a && b && sameInventoryStack(a, b);
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

async function openReceivedStorage(bot, source, activate, { timeoutMs = 2500, reward = false, settleMs = 200 } = {}) {
    if (bot.currentWindow?.selectedItem || bot.inventory?.selectedItem)
        return fail('Cursor holds an item. Inspect it before opening another window.');
    if (bot.interrupt_code) return fail('Interrupted before backpack interaction.');
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    let finish, timer, settleTimer, serverFailure = '';
    const messages = [];
    const onMessage = (message, position, sender) => {
        if (sender || (position && position !== 'system')) return;
        const text = label(message).trim().slice(0, 2048);
        if (!text) return;
        const match = /^MC_[A-Z_]+\s+(\{.*\})$/.exec(text);
        if (match) {
            try {
                const receipt = JSON.parse(match[1]);
                if (receipt.success === false) serverFailure = [receipt.skill, receipt.errorMessage || receipt.reason,
                    receipt.nextCommands?.[0]].filter(Boolean).join('; ').slice(0, 280);
            } catch { /* keep the bounded human-readable server reply */ }
        } else { messages.push(text.slice(0, 180)); if (messages.length > 2) messages.shift(); }
    };
    const pending = new Promise(resolve => { finish = resolve; });
    // Minepacks can immediately reopen the same numeric ID with its final title.
    // Like Cortico's container ownership guard, bind to the received window
    // instance after opening settles, never the first ID or a previous menu.
    const onWindow = window => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => finish(window), settleMs);
    };
    const onEnd = () => finish(null);
    bot.on('windowOpen', onWindow); bot.on('end', onEnd);
    bot.on('message', onMessage);
    timer = setTimeout(onEnd, timeoutMs);
    try {
        // Right click in air, never place a head on a block. Listen first so a
        // late/synchronous server window cannot disappear between commands.
        await activate();
        const window = await pending;
        const title = label(window?.title);
        if (bot.currentWindow !== window || !validStorage(window) || !(reward ? /奖励|reward/i.test(title) : backpackText(title))) {
            const receipt = serverFailure || messages.join(' | ');
            return fail(`Storage window not confirmed.${receipt ? ' Observed server reply: ' + receipt + '.' : ''} Inspect !window; do not transfer or blindly repeat.`);
        }
        if (hasQuestJournal(window))
            return fail('A separate BetonQuest journal menu opened; the requested ordinary backpack is NOT confirmed. The /backpack alias may conflict: use the server-declared Minepacks command. Inspect !window; no transfer submitted.');
        if (/选择|菜单|selection|\bmenu\b/i.test(title))
            return fail('A selection menu opened, not item storage. Inspect !window for its buttons; no transfer submitted.');
        opened.set(window, { ...source, name: source.name || title });
        return { success: true, message: `Opened storage ${JSON.stringify(source.name || title)}; window=${window.id}, title=${JSON.stringify(title)}. Read !window for the complete slot table BEFORE moving items; do not guess from inventory slot numbers.` };
    } catch (error) {
        return fail(`Backpack interaction failed: ${error.message}. Inspect !window before retrying.`);
    } finally {
        clearTimeout(timer); clearTimeout(settleTimer); bot.off('windowOpen', onWindow); bot.off('end', onEnd);
        bot.off('message', onMessage);
    }
}

// Cortico's storage guide documents Minepacks and separate personal rewards.
// Namespacing avoids BetonQuest owning the bare /backpack alias on this server.
export async function openBackpack(bot, slot, { command = null, ...options } = {}) {
    const item = Number.isInteger(slot) && slot >= 9 && slot <= 45 ? bot.inventory?.slots?.[slot] : null;
    if (!item) return fail('Inventory slot unavailable. Read !inventory before opening a backpack.');
    const identity = readItemIdentity(item);
    if (!backpackText(identity.customName + ' ' + identity.lore.join(' ')))
        return fail('This slot has no received backpack label/lore. A plain player head is not a backpack.');
    if (command && command !== '/minepacks:backpack open') return fail('Unsupported configured backpack command; no interaction submitted.');
    return openReceivedStorage(bot, { slot, id: identity.name, name: identity.customName,
        ...(command ? { command, provider: 'minepacks' } : {}) }, async () => {
        if (command) { bot.chat(command); return; }
        await bot.equip(item, 'hand');
        if (!sameItem(bot.heldItem, item) || bot.interrupt_code) throw new Error('Held item changed; backpack was not activated');
        bot.activateItem();
    }, options);
}

export async function openServerStorage(bot, command, options = {}) {
    if (!['/minepacks:backpack open', '/mycli arena rewards'].includes(command))
        return fail('Use the documented /minepacks:backpack open or /mycli arena rewards route; no command submitted.');
    const reward = command === '/mycli arena rewards';
    return openReceivedStorage(bot, { id: 'server_storage', command, kind: reward ? 'rewards' : 'backpack',
        provider: reward ? 'mycli' : 'minepacks' }, () => bot.chat(command), { ...options, reward });
}

export function describeBackpackWindow(bot) {
    const window = bot.currentWindow, source = backpackSource(window);
    if (!source || !validStorage(window)) return 'No verified backpack window is open.';
    const lines = [`BACKPACK window=${window.id} name=${JSON.stringify(source.name)} base=${source.id}`,
        `Storage slots [0,${window.inventoryStart}); player inventory slots [${window.inventoryStart},${window.inventoryEnd}).`,
        'Use !moveBackpackItem(window_id, observed_slot, count). Source in player inventory deposits; source in storage withdraws. Verify received changes.'];
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
    let received = false, invalid = false, cursor = null, cursorReceived = false;
    const update = packet => {
        if ((packet.windowId === -1 || packet.windowId === 255) && packet.slot === -1) {
            try { cursor = Item.fromNotch(packet.item); cursorReceived = true; } catch { invalid = true; }
            return;
        }
        if (packet.windowId !== window.id || !Number.isInteger(packet.slot) || packet.slot < 0 || packet.slot >= slots.length) return;
        try { slots[packet.slot] = Item.fromNotch(packet.item); received = true; } catch { invalid = true; }
    };
    const replace = packet => {
        if (packet.windowId !== window.id || !Array.isArray(packet.items) || packet.items.length < window.inventoryEnd) return;
        try {
            packet.items.slice(0, slots.length).forEach((raw, index) => { slots[index] = Item.fromNotch(raw); }); received = true;
            // Mineflayer 1.20.6 does not apply carriedItem from full snapshots.
            // Cortico explicitly tracks this server cursor as well as the slots.
            if (packet.carriedItem !== undefined) { cursor = Item.fromNotch(packet.carriedItem); cursorReceived = true; }
        }
        catch { invalid = true; }
    };
    bot._client.on('set_slot', update); bot._client.on('window_items', replace);
    try {
        await bot.transfer({ window, itemType: item.type, metadata: item.metadata, nbt: item.nbt,
            count, sourceStart: slot, sourceEnd: slot + 1, destStart, destEnd });
        const deadline = Date.now() + timeoutMs;
        do {
            if (bot.currentWindow !== window) break;
            if (received && !invalid && (cursorReceived ? !cursor : !window.selectedItem)
                && sourceBefore - sum(slots, slot, slot + 1, item) === count
                && sum(slots, destStart, destEnd, item) - destBefore === count) {
                if (cursorReceived) window.selectedItem = cursor;
                return { success: true, message: `Confirmed server inventory: ${depositing ? 'deposited' : 'withdrew'} ${item.name} x${count} in backpack window ${window.id}.` };
            }
            await new Promise(resolve => setTimeout(resolve, 30));
        } while (Date.now() < deadline && !bot.interrupt_code);
        const current = bot.currentWindow;
        return fail(`Transfer of ${item.name} x${count} from slot ${slot} not confirmed by server inventory. Window before=${window.id}, now=${current?.id ?? 'closed'}; sameWindow=${current === window}. Inspect !window and !inventory; no automatic retry.`);
    } catch (error) {
        return fail(`Transfer outcome unknown: ${error.message}. Inspect inventory/cursor before retrying.`);
    } finally {
        bot._client.off('set_slot', update); bot._client.off('window_items', replace);
    }
}
