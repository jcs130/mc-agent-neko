import { parentPort, workerData } from 'node:worker_threads';
import { Vec3 } from 'vec3';
import { lockdown, makeCompartment } from './library/lockdown.js';

// Hardening lives in this disposable worker, so it cannot freeze the parent
// Node/Mineflayer dependency graph. No network, filesystem or raw bot is endowed.
lockdown();
const status = new Int32Array(workerData.shared, 0, 2);
const bytes = new Uint8Array(workerData.shared, 8);
let state = workerData.snapshot;
function revive(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(revive);
    if (Object.keys(value).length === 3 && ['x', 'y', 'z'].every(k => Number.isFinite(value[k])))
        return new Vec3(value.x, value.y, value.z);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
}
state = revive(state);
function rpc(method, args) {
    Atomics.store(status, 0, 0);
    parentPort.postMessage({ type: 'call', method, args });
    if (Atomics.wait(status, 0, 0, workerData.timeoutMs) === 'timed-out') throw new Error('Generated-code RPC timed out.');
    const result = JSON.parse(Buffer.from(bytes.slice(0, Atomics.load(status, 1))).toString('utf8'));
    if (result.error) throw new Error(result.error);
    state = revive(result.snapshot);
    return revive(result.result);
}
const bot = {};
for (const name of ['username', 'health', 'food', 'entity', 'game', 'time', 'heldItem'])
    Object.defineProperty(bot, name, { get: () => state[name], enumerable: true });
Object.defineProperty(bot, 'interrupt_code', { get: () => false });
bot.inventory = { items: () => rpc('bot.inventoryItems', []) };
const modules = { skills: {}, world: {} };
for (const method of workerData.methods) {
    const [module, name] = method.split('.');
    if (!modules[module]) continue;
    modules[module][name] = (body, ...args) => {
        if (body !== bot) throw new Error('Pass the provided bot as the first argument.');
        return rpc(method, args);
    };
}
try {
    const compartment = makeCompartment({ bot, ...modules, Vec3, log: modules.skills.log });
    const main = compartment.evaluate(`(async () => {\n${workerData.source}\n})`);
    await main();
    parentPort.postMessage({ type: 'done' });
} catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message || String(error) });
}
