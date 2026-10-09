import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';
import pf from 'mineflayer-pathfinder';

const source = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');

function sourceFunction(name, nextName) {
    const start = source.indexOf(`export async function ${name}(`);
    const end = source.indexOf(`export async function ${nextName}(`, start);
    assert.ok(start >= 0 && end > start, `Unable to load real ${name} source`);
    return source.slice(start, end).replace('export ', '');
}

function fixture({ reachable = false, interrupted = false, dead = false, throws = false, pillarReaches = false } = {}) {
    const bot = {
        output: '',
        interrupt_code: false,
        health: dead ? 0 : 20,
        entity: { position: new Vec3(-543, 57, -438) },
        modes: { isOn: () => false },
        blockAt(position) {
            return position.y === 69 ? { name: 'stone', position } : null;
        },
    };
    const calls = { navigation: 0, pillar: 0, timers: 0, clearedTimers: 0 };
    // Run the actual surface skill and its actual navigation result check.
    // Only the lower-level path execution is simulated; no world actions or
    // real timers run, including when the route stops 13 blocks short.
    const context = vm.createContext({
        Vec3, pf,
        maroonedNavigationSuppressed: () => false,
        log: (target, message) => { target.output += message + '\n'; },
        setInterval: () => { calls.timers++; return 1; },
        clearInterval: () => { calls.clearedTimers++; },
        goToGoal: async (target, goal) => {
            calls.navigation++;
            if (reachable) target.entity.position = new Vec3(goal.x, goal.y, goal.z);
            target.interrupt_code = interrupted;
            if (throws) throw new Error('no path');
        },
        pillarUp: async (target, targetY) => {
            calls.pillar++;
            if (pillarReaches) target.entity.position.y = targetY;
            return pillarReaches;
        },
    });
    vm.runInContext(sourceFunction('goToPosition', 'goToNearestBlock')
        + sourceFunction('goToSurface', 'pillarUp')
        + '\nglobalThis.runSurface = goToSurface;', context);
    return { bot, calls, run: () => context.runSurface(bot) };
}

test('goToSurface tries the existing pillar fallback after a partial route, retaining honest failure', async () => {
    const f = fixture();
    assert.equal(await f.run(), false);
    assert.match(f.bot.output, /Unable to reach .*13 blocks away/);
    assert.match(f.bot.output, /Surface not reached: currentY=57, targetY=70/);
    assert.doesNotMatch(f.bot.output, /Going to the surface/);
    assert.equal(f.bot.entity.position.y, 57);
    assert.deepEqual(f.calls, { navigation: 1, pillar: 1, timers: 1, clearedTimers: 1 });
});

test('goToSurface can climb out when navigation returns false instead of throwing', async () => {
    const f = fixture({ pillarReaches: true });
    assert.equal(await f.run(), true);
    assert.equal(f.bot.entity.position.y, 70);
    assert.equal(f.calls.pillar, 1);
});

test('goToSurface retains the pillar fallback when navigation throws', async () => {
    const f = fixture({ throws: true, pillarReaches: true });
    assert.equal(await f.run(), true);
    assert.equal(f.bot.entity.position.y, 70);
    assert.equal(f.calls.pillar, 1);
});

test('goToSurface never starts a climb after death or interrupted exceptional navigation', async () => {
    for (const options of [{ dead: true }, { throws: true, interrupted: true }]) {
        const f = fixture(options);
        assert.equal(await f.run(), false);
        assert.equal(f.calls.pillar, 0);
    }
});

test('goToSurface retains success when actual navigation reaches the surface', async () => {
    const f = fixture({ reachable: true });
    assert.equal(await f.run(), true);
    assert.equal(f.bot.entity.position.y, 70);
    assert.match(f.bot.output, /You have reached at -543, 70, -438/);
    assert.match(f.bot.output, /Going to the surface at y=70/);
    assert.doesNotMatch(f.bot.output, /Surface not reached|Unable to reach/);
    assert.equal(f.calls.pillar, 0);
});

test('goToSurface does not start a pillar fallback when interrupted navigation returns false', async () => {
    const f = fixture({ interrupted: true });
    assert.equal(await f.run(), false);
    assert.equal(f.bot.interrupt_code, true);
    assert.equal(f.bot.entity.position.y, 57);
    assert.equal(f.calls.pillar, 0);
    assert.match(f.bot.output, /Surface not reached: currentY=57, targetY=70/);
});
