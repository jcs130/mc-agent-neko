const watches = new WeakMap();
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// A straight line to the nearest dry block may aim at the road ABOVE a covered
// canal. Search only loaded, passable water/air cells for an open column instead.
// No digging, placement, permissions query, pathfinder mutation, or model call.
export function protectedWaterExitRoute(bot, { radius = 20, maxNodes = 1200 } = {}) {
    const start = bot?.entity?.position?.floored?.();
    if (!start) return null;
    const cap = bot.blockAt(start.offset(0, 2, 0));
    if (cap?.boundingBox !== 'block' || !bot.serverProtection?.isDenied('break', cap.position)) return null;
    const pass = block => block && block.boundingBox !== 'block'
        && /^(air|cave_air|void_air|water|flowing_water)$/.test(block.name);
    const water = block => /^(water|flowing_water)$/.test(block?.name || '');
    const feet = bot.blockAt(start), head = bot.blockAt(start.offset(0, 1, 0));
    if (!pass(feet) || !pass(head) || !water(feet) && !water(head)) return null;
    const nodes = [{ point: start, parent: -1 }], seen = new Set(['0,0']);
    const limit = Math.min(2000, Math.max(1, maxNodes)), range = Math.min(24, Math.max(1, radius));
    for (let index = 0; index < nodes.length && index < limit; index++) {
        const p = nodes[index].point;
        if (index && [2, 3, 4].every(dy => pass(bot.blockAt(p.offset(0, dy, 0))))) {
            const path = []; let cursor = index;
            while (cursor > 0) { path.unshift(nodes[cursor].point); cursor = nodes[cursor].parent; }
            return { next: path[0], target: p, steps: path.length, checked: index + 1 };
        }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const q = p.offset(dx, 0, dz), key = `${q.x - start.x},${q.z - start.z}`;
            if (seen.has(key) || Math.abs(q.x - start.x) > range || Math.abs(q.z - start.z) > range) continue;
            seen.add(key);
            const foot = bot.blockAt(q), above = bot.blockAt(q.offset(0, 1, 0));
            if (!pass(foot) || !pass(above)) continue;
            if (!water(foot) && !water(above)) {
                const below = bot.blockAt(q.offset(0, -1, 0));
                if (!below || below.boundingBox !== 'block' && !water(below)) continue;
            }
            if (nodes.length < limit) nodes.push({ point: q, parent: index });
        }
    }
    return null;
}

// Only relinquish a failed, non-lethal surface reflex to the external planner.
// An actual nearby denial is required; water, a roof, or a village alone is not
// evidence that excavation is forbidden. This never issues a game command.
export function protectedSurfaceSwimHandoff(bot, {
    externalOwner = false, inWater = false, headWater = true, closeThreat = true, now = Date.now(),
} = {}) {
    const p = bot?.entity?.position;
    const safe = externalOwner && inWater && !headWater && p?.y >= 55 && bot.health >= 8
        && Number.isFinite(bot.oxygenLevel) && bot.oxygenLevel >= 18 && !closeThreat
        && !bot.entity.isInLava && !bot.entity.isOnFire && !bot._currentSkill && !bot.isSleeping;
    const clear = () => { if (bot) { watches.delete(bot); bot._surfaceSwimRecovery = null; } return false; };
    if (!safe) return clear();
    const dimension = bot.game?.dimension;
    const world = typeof dimension === 'string' ? (dimension.includes(':') ? dimension : `minecraft:${dimension}`) : null;
    const protection = bot.serverProtection?.snapshot();
    const denial = [protection?.lastBlocked, ...(protection?.denied || [])].find(value =>
        value?.status === 'deny' && value.allowed === false && value.action === 'break' && value.world === world
        && ['x', 'y', 'z'].every(k => Number.isFinite(value[k])) && distance(p, value) <= 5
        && Number.isFinite(value.observedAt) && value.observedAt <= now && now - value.observedAt <= 300000);
    const known = denial?.status === 'deny' && denial.allowed === false && denial.action === 'break'
        && world && denial.world === world && ['x', 'y', 'z'].every(k => Number.isFinite(denial[k]))
        && Number.isFinite(denial.observedAt) && denial.observedAt <= now && now - denial.observedAt <= 300000
        && distance(p, denial) <= 5;
    if (!known) return clear();
    let watch = watches.get(bot);
    if (!watch || watch.world !== world || now < watch.checkedAt || now - watch.checkedAt > 15000
        || distance(p, watch.anchor) >= 4) {
        watch = { world, anchor: { x: p.x, y: p.y, z: p.z }, firstAt: now, checkedAt: now, samples: 0 };
        watches.set(bot, watch); bot._surfaceSwimRecovery = null;
    }
    watch.checkedAt = now; watch.samples++;
    if (watch.yieldUntil && now < watch.yieldUntil) return true;
    if (watch.yieldUntil) {
        watch.yieldUntil = 0; watch.firstAt = now; watch.samples = 1;
        bot._surfaceSwimRecovery = null;
    }
    if (now - watch.firstAt < 45000 || watch.samples < 3) return false;
    watch.yieldUntil = now + 90000;
    const recovery = { type: 'protected-surface-swim-stall', observedAt: now, expiresAt: watch.yieldUntil,
        noProgressSeconds: Math.floor((now - watch.firstAt) / 1000),
        reason: 'Nearby excavation was explicitly denied; surface escape remained within four blocks.',
        next: 'Use an existing passage or an actually available escape ability; do not repeat denied digging or claim escape without measured movement.' };
    bot._surfaceSwimRecovery = recovery;
    bot.emit?.('autonomyRecovery', recovery);
    return true;
}
