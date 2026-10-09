import { activeServerCommand, sendServerCommand } from '../websocket/server_commands.js';

const installed = new WeakMap();
const worldName = bot => {
    const dimension = bot.game?.dimension;
    return typeof dimension === 'string' && dimension ? (dimension.includes(':') ? dimension : `minecraft:${dimension}`) : null;
};
const coordinates = p => p && ['x', 'y', 'z'].every(k => Number.isSafeInteger(p[k]))
    ? { x: p.x, y: p.y, z: p.z } : null;
const targetKey = (action, world, p) => `${world}:${action}:${p.x},${p.y},${p.z}`;
const deniedText = /(?:不能|无法|不允许|禁止|没有权限|拒绝).*(?:破坏|挖掘|建造)|(?:cannot|can't|not allowed|not permitted|denied).*(?:break|dig|build|destroy)|(?:protected|protection).*(?:cannot|denied)/i;

// A server-specific adapter, activated explicitly or by a real server advertisement.
// Looking at a block/biome does not establish permission. Denials never cover an
// entire village: cache only the exact action, dimension and coordinates queried.
export function installServerProtection(bot, {
    enabled = false, send = sendServerCommand, now = Date.now,
    denyTtlMs = 300000, allowTtlMs = 3000, unknownTtlMs = 1500, queryTimeoutMs = 1800,
} = {}) {
    if (installed.has(bot)) return installed.get(bot);
    const cache = new Map(), pending = new Map(), notified = new Map();
    let generation = 0, digEpoch = 0, connected = true, installedDig = false;
    let lastCheck = null, lastBlocked = null, activeDig = null, queue = Promise.resolve();
    const cached = key => {
        const entry = cache.get(key);
        if (entry && entry.expiresAt > now()) return entry.value;
        cache.delete(key); return null;
    };
    const remember = value => {
        const key = targetKey(value.action, value.world, value);
        const ttl = value.status === 'deny' ? denyTtlMs : value.allowed === true ? allowTtlMs : unknownTtlMs;
        cache.delete(key); cache.set(key, { value, expiresAt: now() + ttl });
        while (cache.size > 256) cache.delete(cache.keys().next().value);
        lastCheck = value;
        return value;
    };
    const blocked = value => {
        lastBlocked = value;
        const key = `${targetKey(value.action, value.world, value)}:${value.status}:${value.reason}`;
        if (now() - (notified.get(key) ?? -Infinity) < 15000) return;
        notified.set(key, now());
        while (notified.size > 64) notified.delete(notified.keys().next().value);
        const text = `Server protection ${value.status}: ${value.action} ${value.blockName || 'block'} at (${value.x},${value.y},${value.z}): ${value.reason}. Do not retry a denied target; choose another location or activity. Unknown permission needs a fresh nearby check.`;
        if (typeof bot.output === 'string') bot.output += text + '\n';
        bot.emit('serverProtection', { ...value, text });
    };
    const check = async (action, position) => {
        const p = coordinates(position), world = worldName(bot), epoch = generation;
        if (!p || !world || !/^(break|place|container|use)$/.test(action))
            return { status: 'unknown', allowed: null, reason: 'invalid_target', action, world, ...(p || {}), observedAt: now() };
        const key = targetKey(action, world, p);
        if (cached(key)) return cached(key);
        if (pending.has(key)) return pending.get(key);
        const deadline = Date.now() + queryTimeoutMs;
        const work = async () => {
            let reason = 'protection_reply_missing', response;
            while (connected && epoch === generation && world === worldName(bot) && Date.now() < deadline) {
                try {
                    response = await send(bot, { command: `/mycli protect ${action} ${p.x} ${p.y} ${p.z}`, readOnly: true },
                        { timeoutMs: Math.max(1, deadline - Date.now()), quietMs: 60 });
                } catch (error) { reason = `transport_error: ${String(error?.message || error).slice(0, 160)}`; break; }
                if (response.reason !== 'busy') break;
                reason = 'command_bridge_busy';
                await new Promise(resolve => setTimeout(resolve, 40));
            }
            const base = { action, world, ...p, observedAt: now(), source: 'server_preflight' };
            if (!connected || epoch !== generation || world !== worldName(bot))
                return { ...base, status: 'unknown', allowed: null, reason: 'preflight_canceled' };
            const records = response?.status === 'received' && Array.isArray(response.records) ? response.records : [];
            const record = records.find(record => record?.kind === 'MC_PROTECTION' &&
                record.value?.schemaVersion === 1 && record.value.action === action && record.value.world === world &&
                ['x', 'y', 'z'].every(k => record.value[k] === p[k]));
            const value = record?.value;
            const valid = value && ((value.status === 'deny' && value.allowed === false) ||
                (['allow', 'allow_likely'].includes(value.status) && value.allowed === true) ||
                (value.status === 'unknown' && value.allowed == null));
            return remember({ ...base, status: valid ? value.status : 'unknown', allowed: valid ? value.allowed : null,
                reason: String(valid ? value.reason || value.status : reason).slice(0, 240) });
        };
        const promise = queue.then(work);
        queue = promise.catch(() => {});
        pending.set(key, promise);
        try { return await promise; }
        finally { if (pending.get(key) === promise) pending.delete(key); }
    };
    const api = {
        check,
        isDenied(action, position) {
            const p = coordinates(position), world = worldName(bot);
            return Boolean(p && world && cached(targetKey(action, world, p))?.status === 'deny');
        },
        isDeniedWoodColumn(position) {
            const p = coordinates(position), world = worldName(bot);
            if (!p || !world) return false;
            return [...cache.keys()].some(key => {
                const v = cached(key);
                return v?.status === 'deny' && v.action === 'break' && v.world === world && v.x === p.x && v.z === p.z &&
                    /_(log|wood|stem|hyphae)$/.test(v.blockName || '');
            });
        },
        snapshot() {
            const denied = [...cache.keys()].map(cached).filter(v => v?.status === 'deny');
            return { enabled, installed: installedDig, source: '/mycli protect',
                lastCheck, lastBlocked: lastBlocked && now() - lastBlocked.observedAt < denyTtlMs ? lastBlocked : null,
                denied: denied.slice(-8), deniedOmitted: Math.max(0, denied.length - 8) };
        },
    };
    installed.set(bot, api); bot.serverProtection = api;
    const reset = () => { generation++; digEpoch++; cache.clear(); pending.clear(); notified.clear(); lastCheck = lastBlocked = activeDig = null; };
    bot.on('end', () => { connected = false; reset(); });
    bot.on('respawn', reset);
    bot.on('login', () => { connected = true; reset(); installDig(); });
    bot.on('spawn', installDig);
    bot.on('messagestr', (line, position, _json, sender) => {
        if (position !== 'system' || sender) return;
        const text = String(line).replace(/§[0-9a-fk-or]/gi, '').trim();
        if (/^MC_PROTECTION\s+\{/.test(text) || /\/mycli protect (?:break|break\|place)/.test(text)) enabled = true;
        if (!activeDig || activeServerCommand(bot)) return;
        let reason;
        const match = /^MC_PROTECTION\s+(\{.*\})$/.exec(text);
        if (match) {
            try {
                const v = JSON.parse(match[1]);
                if (v.schemaVersion === 1 && v.status === 'deny' && v.allowed === false &&
                    ['action', 'world', 'x', 'y', 'z'].every(k => v[k] === activeDig[k])) reason = v.reason || 'server_denied';
            } catch { /* malformed text cannot establish a protected target */ }
        } else if (deniedText.test(text)) reason = text;
        if (!reason) return;
        const value = remember({ ...activeDig, status: 'deny', allowed: false, reason: String(reason).slice(0, 240),
            source: 'server_dig_rejection', observedAt: now() });
        blocked(value); bot.stopDigging();
    });
    function installDig() {
        if (installedDig || typeof bot.dig !== 'function') return;
        const originalDig = bot.dig.bind(bot), originalStop = bot.stopDigging?.bind(bot), canDig = bot.canDigBlock?.bind(bot);
        if (originalStop) bot.stopDigging = (...args) => { digEpoch++; return originalStop(...args); };
        if (canDig) bot.canDigBlock = block => !api.isDenied('break', block?.position) && canDig(block);
        bot.dig = async (block, ...args) => {
            if (!enabled) return originalDig(block, ...args);
            const epoch = digEpoch, dimension = worldName(bot);
            const result = await check('break', block?.position);
            if (!connected || digEpoch !== epoch || dimension !== worldName(bot) || result.reason === 'preflight_canceled')
                throw new Error('Server protection preflight canceled: stopped, disconnected or dimension changed.');
            if (result.allowed !== true) {
                const failure = remember({ ...result, blockName: block?.name });
                blocked(failure);
                throw new Error(`Server protection ${failure.status}: ${failure.reason} at (${failure.x},${failure.y},${failure.z})`);
            }
            const fresh = bot.blockAt?.(block.position);
            if (typeof bot.blockAt === 'function' && (!fresh || fresh.name !== block.name || fresh.stateId !== block.stateId))
                throw new Error('Server protection preflight canceled: target block changed.');
            const attempt = { ...result, blockName: block.name };
            activeDig = attempt;
            try {
                const result = await originalDig(block, ...args);
                const rejection = cached(targetKey('break', dimension, block.position));
                if (rejection?.status === 'deny') throw new Error(`Server protection deny: ${rejection.reason}`);
                return result;
            }
            finally { if (activeDig === attempt) activeDig = null; }
        };
        installedDig = true;
    }
    installDig();
    return api;
}
