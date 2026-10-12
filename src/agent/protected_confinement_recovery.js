// A native confinement reflex needs its own evidence; floor retreat evidence
// cannot establish why an adjacent wall excavation failed.
const watches = new WeakMap();
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const point = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));

export function rememberConfinementDigRefusal(bot, block, now = Date.now()) {
    if (!point(block?.position) || !Number.isFinite(now)
        || bot?.serverProtection?.isDenied?.('break', block.position) !== true) return false;
    bot._confinementDigRefusal = { observedAt: now, world: bot.game?.dimension,
        blockName: block.name, target: { x: block.position.x, y: block.position.y, z: block.position.z } };
    return true;
}

export function protectedConfinementHandoff(bot, {
    externalOwner = false, emergency = false, executingOther = false, now = Date.now(),
} = {}) {
    const clear = () => {
        if (bot) { watches.delete(bot); bot._confinementRecovery = null; }
        return false;
    };
    const p = bot?.entity?.position, world = bot?.game?.dimension;
    if (!externalOwner || emergency || executingOther || !point(p) || !Number.isFinite(now)
        || typeof world !== 'string' || !world || !['ENTOMBED', 'SEALED'].includes(bot._mobility?.state)
        || !Number.isFinite(bot.health) || bot.health < 16 || bot.interrupt_code
        || bot._currentSkill || bot.targetDigBlock || bot.currentWindow || bot.isSleeping
        || bot.usingHeldItem || bot.isUsingHeldItem || now < (bot._bodyDigLockUntil || 0)
        || bot.entity.isInLava || bot.entity.isOnFire
        || Number.isFinite(bot.oxygenLevel) && bot.oxygenLevel <= 14
        || now - (bot.lastDamageTime || 0) < 4000) return clear();
    const feet = p.floored(), floor = bot.blockAt(feet.offset(0, -1, 0));
    if (floor?.boundingBox !== 'block' || /water|lava|fire|magma|cactus/.test(floor.name || '')
        || [0, 1].some(dy => {
            const b = bot.blockAt(feet.offset(0, dy, 0));
            return !b || !['block', 'empty'].includes(b.boundingBox) || /water|lava|fire/.test(b.name || '');
        }) || Object.values(bot.entities || {}).some(e => /creeper/i.test(e?.name || '')
            && point(e.position) && distance(e.position, p) < 8)) return clear();
    const refusal = bot._confinementDigRefusal;
    if (!refusal || refusal.world !== world || !point(refusal.target)
        || !Number.isFinite(refusal.observedAt) || refusal.observedAt > now || now - refusal.observedAt > 120000
        || distance(p, refusal.target) > 5
        || bot.serverProtection?.isDenied?.('break', refusal.target) !== true) return clear();
    const block = bot.blockAt(feet.offset(refusal.target.x - feet.x,
        refusal.target.y - feet.y, refusal.target.z - feet.z));
    if (block?.boundingBox !== 'block' || block.name !== refusal.blockName) return clear();
    let watch = watches.get(bot);
    if (watch && bot.health < watch.health) return clear();
    if (!watch || watch.world !== world || now < watch.checkedAt || now - watch.checkedAt > 10000
        || distance(p, watch.anchor) >= 2) {
        watch = { world, anchor: { x: p.x, y: p.y, z: p.z }, firstAt: now, checkedAt: now,
            health: bot.health, samples: 0, failedAttempts: 0, lastRefusal: null };
        watches.set(bot, watch); bot._confinementRecovery = null;
    }
    watch.checkedAt = now; watch.health = bot.health; watch.samples++;
    if (watch.lastRefusal !== refusal.observedAt) { watch.lastRefusal = refusal.observedAt; watch.failedAttempts++; }
    if (watch.yieldUntil && now < watch.yieldUntil) return true;
    if (watch.yieldUntil) {
        watch.yieldUntil = 0; watch.firstAt = now; watch.samples = 1; watch.failedAttempts = 0;
        bot._confinementRecovery = null;
    }
    if (now - watch.firstAt < 15000 || watch.samples < 3 || watch.failedAttempts < 2) return false;
    watch.yieldUntil = now + 60000;
    const recovery = { type: 'protected-confinement-stall', constraint: 'server_protection',
        observedAt: now, expiresAt: watch.yieldUntil,
        noProgressSeconds: Math.floor((now - watch.firstAt) / 1000), blockedTarget: { ...refusal.target },
        reason: 'Actual nearby wall excavations were denied and the confinement reflex made no measured progress.',
        next: 'Choose a legal passage, interaction or received escape ability; do not repeat denied excavation. Verify escape by actual movement.' };
    bot._confinementRecovery = recovery;
    bot.emit?.('autonomyRecovery', recovery);
    return true;
}
