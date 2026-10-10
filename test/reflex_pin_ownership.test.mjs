import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';

// Run the actual always-on mode, including its reset, kick and suffocation
// branches. A standalone kick is the control that proves the fixture reaches
// the pin breaker rather than silently escaping through its outer catch.
function fixture({ external = false, vital = false, admin = false, suffocating = false, ownerError = false } = {}) {
    const calls = { pathStops: 0, controls: 0, digs: 0 };
    const context = vm.createContext({
        Date, Vec3, console: { log() {}, warn() {}, error() {} },
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)), clearTimeout,
        settings: { narrate_behavior: false },
        fs: { appendFileSync() {}, statSync() { throw Error('No legacy progress file'); } },
        mc: { isHostile: () => false }, arbiterVitalNow: () => vital,
        appendTelemetry() {},
    });
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const bodyAt = source.indexOf('const FAMINE_FOOD_RE =');
    assert(bodyAt > 0);
    vm.runInContext(source.slice(bodyAt).replace(/^export /gm, '')
        + '\nglobalThis.watchdog = modes_list.find(mode => mode.name === "reflex_watchdog");', context);
    const now = Date.now(), position = new Vec3(0, 64, 0);
    const bot = {
        entity: { position, velocity: new Vec3(0, 0, 0), onGround: true },
        health: 20, food: 20, time: { timeOfDay: 1000 }, entities: {},
        _extIntentUntil: admin ? now + 60000 : 0,
        _mobility: { state: 'FREE', exits: [[1, 0]], enclosed: false },
        inventory: { items: () => [{ name: 'bread', count: 2 }] },
        blockAt: point => ({ name: suffocating && point.y === 65 ? 'stone' : 'air',
            boundingBox: suffocating && point.y === 65 ? 'block' : 'empty' }),
        pathfinder: { setGoal() { calls.pathStops++; } },
        clearControlStates() { calls.controls++; },
        tool: { async equipForBlock() {} }, dig() { calls.digs++; return Promise.resolve(); }, stopDigging() {},
        modes: { behavior_log: '' }, interrupt_code: false,
    };
    const agent = { bot, actions: { executing: false },
        hasExternalAutonomyOwner() { if (ownerError) throw Error('Owner unknown'); return external; } };
    const mode = context.watchdog;
    Object.assign(mode, { pinAnchor: position.clone(), pinAt: now - 16 * 60000,
        pinKick: 0, pinKickCount: 0, lastPos: position.clone(), lastMove: now,
        lastHp: suffocating ? 21 : 20, hurtAt: suffocating ? now : 0 });
    return { agent, bot, mode, calls, now, update: () => mode.update(agent) };
}

test('Neko planning between native missions resets the old pin window without cancelling the body', async () => {
    const f = fixture({ external: true });
    await f.update();
    assert.equal(f.mode.pinKickCount, 0);
    assert(f.mode.pinAt >= f.now);
    assert.equal(f.bot.interrupt_code, false);
    assert.equal(f.calls.pathStops, 0);
    assert.equal(f.calls.controls, 0);
});

test('a standalone stale stack still receives the legacy pin interrupt', async () => {
    const f = fixture();
    await f.update();
    assert.equal(f.mode.pinKickCount, 1);
    assert.equal(f.bot.interrupt_code, true);
    assert.equal(f.bot._chopGen, 1);
    assert.equal(f.calls.pathStops, 1);
});

test('a fresh admin task keeps its existing pin exemption', async () => {
    const f = fixture({ admin: true });
    await f.update();
    assert.equal(f.mode.pinKickCount, 0);
    assert.equal(f.bot.interrupt_code, false);
});

test('vital danger removes the Neko pin exemption', async () => {
    const f = fixture({ external: true, vital: true });
    await f.update();
    assert.equal(f.mode.pinKickCount, 1);
    assert.equal(f.bot.interrupt_code, true);
});

test('suffocation rescue still digs while Neko owns autonomy', async () => {
    const f = fixture({ external: true, suffocating: true });
    await f.update();
    assert.equal(f.calls.digs, 1);
    assert.equal(f.bot.interrupt_code, true);
});

test('an unavailable external-owner check does not disable the watchdog', async () => {
    const f = fixture({ ownerError: true });
    await f.update();
    assert.equal(f.mode.pinKickCount, 1);
    assert.equal(f.bot.interrupt_code, true);
});
