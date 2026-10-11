const pendingOpens = new WeakSet();

function refusal(code, message) {
    return Object.assign(new Error(message), { code });
}

// Mineflayer emits windowOpen only after slot data and close/deposit/withdraw
// methods are installed. Waiting on that event directly avoids openContainer's
// hidden 20-second listener, which outlives our 15-second action-stop watchdog.
export function openChestWindow(bot, block, options = {}) {
    const { timeoutMs = 6000, pollMs = 100 } = options;
    const generation = Object.hasOwn(options, 'generation') ? options.generation : bot._actionGeneration;
    const cancelled = () => bot.interrupt_code || bot.health <= 0 || bot._actionGeneration !== generation;
    if (cancelled()) return Promise.reject(refusal('interrupted', 'Chest opening interrupted.'));
    if (bot.currentWindow || bot.inventory?.selectedItem || pendingOpens.has(bot)) {
        return Promise.reject(refusal('busy', 'An existing window, carried item or container opening must be resolved first.'));
    }
    if (!['chest', 'trapped_chest', 'barrel'].includes(block?.name)) {
        return Promise.reject(refusal('unsupported', 'Expected a chest or barrel block.'));
    }
    pendingOpens.add(bot);
    return new Promise((resolve, reject) => {
        let settled = false, timer, poll;
        const finish = (error, window) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearInterval(poll);
            bot.off('windowOpen', onWindow);
            bot.off('end', onEnd);
            pendingOpens.delete(bot);
            if (error) reject(error);
            else resolve(window);
        };
        const onWindow = window => {
            // An NPC/merchant window or a superseding window belongs to its
            // own flow. Never close it or interpret its slots as chest goods.
            if (bot.currentWindow !== window || !/^minecraft:(?:generic(?:_9x[1-6])?|chest|container|trapped_chest|barrel)$/.test(window?.type)
                || typeof window.containerItems !== 'function' || typeof window.close !== 'function') {
                finish(refusal('window_changed', 'A different or uninitialized window opened; inspect it before continuing.'));
            } else if (cancelled()) {
                closeOwnedChestWindow(bot, window, generation);
                finish(refusal('interrupted', 'Chest opening interrupted.'));
            } else finish(null, window);
        };
        const onEnd = () => finish(refusal('disconnected', 'Disconnected while opening the chest.'));
        bot.on('windowOpen', onWindow);
        bot.on('end', onEnd);
        timer = setTimeout(() => finish(refusal('timeout', 'Chest opening timeout: no initialized container window received; contents unknown.')), timeoutMs);
        poll = setInterval(() => {
            if (cancelled()) finish(refusal('interrupted', 'Chest opening interrupted.'));
        }, pollMs);
        try {
            // Also observe an activation rejection; Mineflayer's openBlock
            // launches this promise without awaiting it.
            Promise.resolve(bot.activateBlock(block)).catch(error => finish(error));
        } catch (error) { finish(error); }
    });
}

export function closeOwnedChestWindow(bot, window, generation) {
    // An explicitly captured undefined generation must not become the new
    // owner's generation through a default-parameter substitution.
    if (bot.currentWindow !== window || (arguments.length >= 3 && bot._actionGeneration !== generation)) return false;
    try { window.close(); return true; }
    catch { return false; }
}
