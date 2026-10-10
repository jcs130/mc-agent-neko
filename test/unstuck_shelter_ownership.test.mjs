import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';
import { observeStallContext, recoveryMovedEnough } from '../src/agent/stall_recovery.js';

// Exercise the actual mode update. A legacy shelter commitment remains in the
// world model while Neko owns a different task; it must not stop that path.
function fixture({ external = true, skill = null, tod = 18000, moving = true } = {}) {
    const calls = { goals: 0, stops: 0, controls: 0 };
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const context = vm.createContext({
        Date, Vec3, observeStallContext, recoveryMovedEnough,
        fs: { appendFileSync() {} }, settings: { narrate_behavior: false },
        console: { log() {}, warn() {}, error() {} },
    });
    vm.runInContext(source.slice(source.indexOf('const FAMINE_FOOD_RE =')).replace(/^export /gm, '')
        + '\nglobalThis.unstuck = modes_list.find(mode => mode.name === "unstuck");', context);
    const bot = {
        food: 20, health: 20, entities: {}, time: { timeOfDay: tod },
        _commitment: { kind: 'NIGHT_DIG_ONE', skill: 'nightShelter' },
        _currentSkill: skill, _mobility: { state: 'FREE', enclosed: false },
        entity: { position: new Vec3(-524.5, 63.5, -379.3), onGround: true },
        pathfinder: { isMoving: () => moving, setGoal() { calls.goals++; }, stop() { calls.stops++; } },
        getControlState: () => false, clearControlStates() { calls.controls++; },
        blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    };
    const agent = { bot, hasExternalAutonomyOwner: () => external,
        actions: { executing: moving, currentActionLabel: moving ? 'action:goToPosition' : '' } };
    const mode = context.unstuck;
    return { calls, mode, update: () => mode.update(agent) };
}

test('an advisory shelter commitment cannot clear a different Neko task path each tick', async () => {
    const f = fixture();
    await f.update();
    await f.update();
    assert.deepEqual(f.calls, { goals: 0, stops: 0, controls: 0 });
});

test('Neko idle planning is not a legacy night-shelter body owner', async () => {
    const f = fixture({ moving: false });
    await f.update();
    assert.deepEqual(f.calls, { goals: 0, stops: 0, controls: 0 });
});

test('an actual Neko-dispatched nightShelter retains its deliberate hold', async () => {
    const f = fixture({ skill: 'nightShelter' });
    await f.update();
    assert.deepEqual(f.calls, { goals: 1, stops: 1, controls: 1 });
    assert.equal(f.mode.stuck_time, 0);
});

test('standalone native night shelter retains its existing protection from unstuck', async () => {
    const f = fixture({ external: false });
    await f.update();
    assert.deepEqual(f.calls, { goals: 1, stops: 1, controls: 1 });
});

test('a stale night commitment cannot cancel movement in daylight', async () => {
    const f = fixture({ external: false, tod: 1000 });
    await f.update();
    assert.deepEqual(f.calls, { goals: 0, stops: 0, controls: 0 });
});
