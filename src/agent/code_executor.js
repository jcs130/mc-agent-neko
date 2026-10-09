import { Worker } from 'node:worker_threads';
import { Vec3 } from 'vec3';

const REPLY_BYTES = 256 * 1024;

function plain(value, depth = 0, seen = new Set()) {
    if (value == null || ['number', 'boolean', 'string'].includes(typeof value)) return value;
    if (typeof value !== 'object' || depth > 6 || seen.has(value)) return undefined;
    seen.add(value);
    const out = Array.isArray(value) ? [] : {};
    const entries = Object.entries(value);
    if (entries.length > 256) throw new Error('Generated-code result is too large; use a smaller query.');
    for (const [key, item] of entries) {
        if (key.startsWith('_') || ['constructor', '__proto__', 'prototype'].includes(key)) continue;
        const next = plain(item, depth + 1, seen);
        if (next !== undefined) out[key] = next;
    }
    seen.delete(value);
    return out;
}

function snapshot(bot) {
    const entity = bot.entity || {};
    return plain({ username: bot.username, health: bot.health, food: bot.food,
        entity: { id: entity.id, position: entity.position, yaw: entity.yaw, pitch: entity.pitch },
        game: bot.game, time: bot.time, heldItem: bot.heldItem });
}

function hydrate(value, bot) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(v => hydrate(v, bot));
    if (value.id != null && value.position && bot.entities?.[value.id]) return bot.entities[value.id];
    if (Object.keys(value).length === 3 && ['x', 'y', 'z'].every(k => Number.isFinite(value[k])))
        return new Vec3(value.x, value.y, value.z);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hydrate(v, bot)]));
}

// Only generated JavaScript runs in the worker. Approved native skill calls stay
// on their original Mineflayer body and retain its protection/interrupt checks.
export function executeGeneratedCode(agent, source, api, { allowed = [], timeoutMs = 120000, maxCalls = 64 } = {}) {
    if (typeof source !== 'string' || source.length > 24000) return Promise.reject(new Error('Generated script exceeds 24000 characters.'));
    const bot = agent.bot;
    const methods = new Set([...allowed, 'skills.log']);
    const shared = new SharedArrayBuffer(REPLY_BYTES + 8);
    const status = new Int32Array(shared, 0, 2);
    const bytes = new Uint8Array(shared, 8);
    return new Promise((resolve, reject) => {
        let settled = false;
        let calls = 0;
        let skillCalls = 0;
        let privateLogs = 0;
        const queryTrace = [];
        const worker = new Worker(new URL('./code_worker.mjs', import.meta.url), {
            workerData: { source, snapshot: snapshot(bot), methods: [...methods], shared, timeoutMs },
            resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        });
        const finish = (error, cancel = false) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline); clearInterval(poll);
            if (cancel) bot.interrupt_code = true;
            void worker.terminate();
            error ? reject(error) : resolve({ calls, skillCalls, privateLogs });
        };
        const checkBody = () => {
            if (agent.bot !== bot) throw new Error('Generated code cancelled: game body changed.');
            if (bot.interrupt_code) throw new Error('Generated code interrupted.');
        };
        const reply = data => {
            if (settled) return;
            let encoded = Buffer.from(JSON.stringify(data));
            if (encoded.length > REPLY_BYTES) encoded = Buffer.from(JSON.stringify({ error: 'Generated-code result exceeds reply limit.' }));
            bytes.set(encoded); Atomics.store(status, 1, encoded.length);
            Atomics.store(status, 0, 1); Atomics.notify(status, 0);
        };
        const deadline = setTimeout(() => finish(new Error(`Generated code timed out after ${timeoutMs} ms.`), true), timeoutMs);
        const poll = setInterval(() => { try { checkBody(); } catch (e) { finish(e, true); } }, 50);
        worker.on('message', async message => {
            if (settled) return;
            if (message.type === 'done') {
                finish(skillCalls || privateLogs ? undefined : new Error('Generated script called no game skill and reported no result. '
                    + 'Check exact base item IDs and skipped conditions. Actual query results: ' + queryTrace.join('; ')));
                return;
            }
            if (message.type === 'error') { finish(new Error(message.error)); return; }
            if (message.type !== 'call') { finish(new Error('Invalid generated-code message.')); return; }
            try {
                checkBody();
                if (++calls > maxCalls) throw new Error('Generated code exceeded its call budget.');
                if (JSON.stringify(message.args).length > 16000) throw new Error('Generated-code arguments exceed limit.');
                let result;
                if (message.method === 'bot.inventoryItems') result = bot.inventory.items();
                else {
                    if (!methods.has(message.method)) throw new Error(`Generated-code API not allowed: ${message.method}`);
                    const [module, name] = message.method.split('.');
                    const fn = api[module]?.[name];
                    if (typeof fn !== 'function') throw new Error(`Unknown generated-code function: ${message.method}`);
                    if (message.method === 'skills.customSkill' && !agent.prompter.skill_libary.getRunnableSkillNames().has(message.args[0]))
                        throw new Error(`Custom skill is not runnable: ${message.args[0]}`);
                    result = await fn(bot, ...message.args.map(arg => hydrate(arg, bot)));
                    if (result === false) throw new Error(`${message.method} returned false; stop dependent steps and replan.`);
                    if (message.method === 'skills.log') privateLogs++;
                    else if (module === 'skills') skillCalls++;
                }
                checkBody();
                if (message.method.startsWith('world.') || message.method === 'bot.inventoryItems') {
                    queryTrace.push(`${message.method}: ${JSON.stringify(plain(result))?.slice(0, 1500)}`);
                    if (queryTrace.length > 4) queryTrace.shift();
                }
                reply({ result: plain(result), snapshot: snapshot(bot) });
            } catch (e) { reply({ error: e.message || String(e) }); }
        });
        worker.on('error', error => finish(error, true));
        worker.on('exit', code => { if (!settled) finish(new Error(`Generated-code worker exited unexpectedly (${code}).`), true); });
    });
}
