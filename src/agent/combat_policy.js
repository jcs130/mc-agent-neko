// Shared by retreat selection and combat execution. Armor and pickaxes do not
// satisfy the melee weapon requirement used by self_defense.
export function hasMeleeWeapon(bot) {
    return bot.inventory.items().some(item => /_sword$|_axe$/.test(item.name || ''));
}

export function threatCanReachBot(bot, entity, now = Date.now()) {
    // Only fresh, explicit evidence suppresses a threat. Actual damage overrides
    // the path cache immediately; missing/expired observations stay actionable.
    if (now - (bot.lastDamageTime || 0) < 4000) return true;
    const reach = bot._threatReach?.[entity.id];
    return !(reach && now - reach.at < 4000 && reach.connected === false);
}
