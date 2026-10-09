import { vitalNow } from './arbiter.js';

/** Whether soft regional entrapment currently reserves navigation for a march.
 * An external task's fresh intent freezes non-vital MAROONED marches in
 * modes.execute. That same frozen march cannot reserve all task navigation.
 * Actual mobility ownership and standalone/vital recovery retain the old gate.
 * This only admits normal navigation; its route and digging safety still apply.
 */
export function maroonedNavigationSuppressed(bot) {
    if (bot?._mobility?.state !== 'MAROONED') return false;
    if (bot._bodyOwner?.name === 'mode:mobility') return true;
    try {
        if (bot._extIntentUntil && Date.now() < bot._extIntentUntil && !vitalNow(bot)) return false;
    } catch {}
    return true;
}
