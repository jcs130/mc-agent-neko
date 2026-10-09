// Mineflayer receives player slots in the open container/merchant window but
// copies them back to bot.inventory only when the client closes that window.
// Project the current 36 storage slots onto player indices without changing
// either cache, item.slot, the cursor, or the physical game window.
export function playerInventorySlots(bot) {
    const base = bot?.inventory?.slots ?? [];
    const window = bot?.currentWindow;
    if (!Array.isArray(base) || !window || window === bot.inventory || !Array.isArray(window.slots)) return base;
    // In Mineflayer 4.37.1 extendWindow installs close only after initial slot
    // data arrives, immediately before windowOpen. An allocated blank window
    // must not erase the last known inventory while waiting for that packet.
    if (typeof window.close !== 'function') return base;
    const start = window.inventoryStart, end = window.inventoryEnd;
    const playerStart = bot.inventory.inventoryStart ?? 9;
    const playerEnd = bot.inventory.inventoryEnd ?? 45;
    if (![start, end, playerStart, playerEnd].every(Number.isInteger) ||
        start < 0 || end - start !== 36 || end > window.slots.length ||
        playerStart < 0 || playerEnd - playerStart !== 36 || playerEnd > base.length) return base;
    const slots = base.slice();
    for (let index = 0; index < 36; index++) slots[playerStart + index] = window.slots[start + index] ?? null;
    return slots;
}

export function playerHeldItem(bot, slots = playerInventorySlots(bot)) {
    if (slots !== bot?.inventory?.slots && Number.isInteger(bot?.quickBarSlot) &&
        bot.quickBarSlot >= 0 && bot.quickBarSlot < 9) return slots[36 + bot.quickBarSlot] ?? null;
    return bot?.heldItem ?? null;
}

// Counts alone hide whether throwing ten items actually clears a storage slot.
// Keep routine inventory reads brief; include stack locations only near capacity.
export function inventorySpaceFeedback(bot) {
    const slots = playerInventorySlots(bot);
    const storage = Array.isArray(slots) && slots.length >= 45 ? slots.slice(9, 45) : null;
    let empty = storage ? storage.filter(item => !item).length : null;
    if (!storage) {
        try {
            const value = bot?.inventory?.emptySlotCount?.();
            if (Number.isInteger(value) && value >= 0 && value <= 36) empty = value;
        } catch (_) { /* Unknown inventory is not an empty backpack. */ }
    }
    let text = `BACKPACK: ${empty ?? 'unknown'} free storage slots (36 total).`;
    const cursor = (typeof bot?.currentWindow?.close === 'function' ? bot.currentWindow : bot?.inventory)?.selectedItem;
    text += cursor ? `\nCURSOR: ${cursor.name} x${cursor.count}; carried here, not stored. Resolve it before crafting or opening another container.`
        : `\nCURSOR: ${cursor === undefined ? 'unknown' : 'empty'}.`;
    if (empty != null && empty <= 1) {
        if (storage) text += '\nSTORAGE STACKS: ' + storage.flatMap((item, index) =>
            item ? [`[slot ${index + 9}] ${item.name} x${item.count}`] : []).join('; ');
        text += '\nRemoving part of a stack may free no slot. Store a whole chosen ordinary stack in a verified container/backpack, or explicitly discard it, then check capacity. Keep named/server items safe.';
    }
    return text;
}
