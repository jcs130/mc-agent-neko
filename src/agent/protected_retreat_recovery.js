const watches = new WeakMap();
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Yield a demonstrably futile construction reflex, not a real emergency. This
// never establishes permission, moves the player or classifies a mob as neutral.
export function protectedRetreatHandoff(bot, {
    externalOwner = false, emergency = false, now = Date.now(),
} = {}) {
    const clear = () => {
        if (bot) { watches.delete(bot); bot._protectedRetreatRecovery = null; }
        return false;
    };
    const p = bot?.entity?.position, world = bot?.game?.dimension;
    if (!externalOwner || emergency || !p || !['x', 'y', 'z'].every(k => Number.isFinite(p[k]))
        || typeof world !== 'string' || !world || !Number.isFinite(now)
        || !Number.isFinite(bot.health) || bot.health < 16 || bot.interrupt_code
        || bot.entity.isInLava || bot.entity.isOnFire
        || Number.isFinite(bot.oxygenLevel) && bot.oxygenLevel <= 14
        || now - (bot.lastDamageTime || 0) < 4000) return clear();
    const feet = p.floored(), floor = bot.blockAt(feet.offset(0, -1, 0));
    if (floor?.boundingBox !== 'block' || !floor.position
        || !bot.serverProtection?.isDenied?.('break', floor.position)) return clear();
    if ([0, 1].some(dy => {
        const block = bot.blockAt(feet.offset(0, dy, 0));
        return !block || typeof block.name !== 'string' || /water|lava|fire/.test(block.name);
    })
        || Object.values(bot.entities || {}).some(e => /creeper/i.test(e?.name || '')
            && e.position && distance(e.position, p) < 8)) return clear();
    let watch = watches.get(bot);
    const target = { x: floor.position.x, y: floor.position.y, z: floor.position.z };
    if (!watch || watch.world !== world || now < watch.checkedAt || now - watch.checkedAt > 10000
        || distance(p, watch.anchor) >= 2 || distance(target, watch.target) !== 0) {
        watch = { world, anchor: { x: p.x, y: p.y, z: p.z }, target,
            firstAt: now, checkedAt: now, samples: 0 };
        watches.set(bot, watch); bot._protectedRetreatRecovery = null;
    }
    watch.checkedAt = now; watch.samples++;
    if (watch.yieldUntil && now < watch.yieldUntil) return true;
    if (watch.yieldUntil) {
        watch.yieldUntil = 0; watch.firstAt = now; watch.samples = 1;
        bot._protectedRetreatRecovery = null;
    }
    if (now - watch.firstAt < 15000 || watch.samples < 3) return false;
    watch.yieldUntil = now + 60000;
    const recovery = { type: 'protected-retreat-stall', observedAt: now, expiresAt: watch.yieldUntil,
        noProgressSeconds: Math.floor((now - watch.firstAt) / 1000), blockedTarget: target,
        reason: 'The exact floor excavation is denied and this retreat made no measured progress.',
        next: 'Choose an existing passage, interaction or an observed escape ability; do not repeat denied excavation or merely announce another inspection.' };
    bot._protectedRetreatRecovery = recovery;
    bot.emit?.('autonomyRecovery', recovery);
    return true;
}
