import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
    const clock = { now: 100000, vital: false };
    const calls = { actions: 0, stops: 0, rescues: 0 };
    const point = (x, y, z) => ({ x, y, z, floored() { return point(Math.floor(x), Math.floor(y), Math.floor(z)); },
        offset(dx, dy, dz) { return point(x + dx, y + dy, z + dz); } });
    const bot = {
        _extIntentUntil: 200000, _actionGeneration: 7, _currentSkill: 'chopWood',
        _mobility: { state: 'ENTOMBED', since: 99500 },
        entity: { position: point(0, 64, 0) },
        targetDigBlock: { name: 'spruce_log' },
        blockAt(p) { return p.x === 0 && p.z === 0 && p.y < 66
            ? { name: 'air', boundingBox: 'empty' } : { name: 'spruce_leaves', boundingBox: 'block' }; },
    };
    const agent = {
        bot, actions: { executing: true, currentActionLabel: 'action:getWood',
            async runAction(_label, fn) { calls.actions++; await fn(); return { interrupted: false, message: '' }; },
        },
        self_prompter: { isActive: () => true, stopLoop() { calls.stops++; } },
        handleMessage() { throw new Error('unexpected reprompt'); },
    };
    const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const helpers = source.slice(source.indexOf('function adminExclusiveActive('), source.indexOf('function hasLineOfSight('));
    const execute = source.slice(source.indexOf('async function execute('), source.indexOf('let _agent = null;'));
    const context = vm.createContext({
        Date: { now: () => clock.now }, console: { log() {} },
        arbiterVitalNow: () => clock.vital, arbiterCurrentOwner: () => null,
        setBodyOwner() {}, releaseBodyOwner() {},
    });
    vm.runInContext(helpers + execute + '\nglobalThis.executeMode = execute;', context);
    const run = async (name = 'mobility') => context.executeMode({ name }, agent, async () => { calls.rescues++; });
    return { agent, bot, clock, calls, context, run };
}

test('a real tree dig keeps ownership through a brief canopy entombment', async () => {
    const f = fixture(); await f.run();
    assert.equal(f.calls.actions, 0, 'rescue must not cancel an actively progressing tree dig');
    assert.equal(f.calls.stops, 0, 'harvest self prompting must stay alive');
    assert.equal(f.bot._actionGeneration, 7);
});

test('the just-finished tree dig retains ownership across its short pickup gap', async () => {
    const f = fixture();
    f.context.noteWoodHarvestTarget(f.agent);
    f.bot.targetDigBlock = null; f.clock.now += 2000;
    await f.run();
    assert.equal(f.calls.actions, 0);
});

test('canopy grace expires at eight seconds even while a tree target remains', async () => {
    const f = fixture(); f.clock.now = f.bot._mobility.since + 8000;
    await f.run(); assert.equal(f.calls.rescues, 1, 'persistent canopy traps still get bounded recovery');
});

test('a harvest observation older than three seconds cannot delay rescue', async () => {
    const f = fixture(); f.context.noteWoodHarvestTarget(f.agent);
    f.bot.targetDigBlock = null; f.clock.now += 3001;
    await f.run(); assert.equal(f.calls.rescues, 1);
});

test('a previous action generation cannot lend its harvest grace to another action', async () => {
    const f = fixture(); f.context.noteWoodHarvestTarget(f.agent);
    f.bot.targetDigBlock = null; f.bot._actionGeneration++;
    await f.run(); assert.equal(f.calls.rescues, 1);
});

test('a harvest label without an actual tree target does not delay rescue', async () => {
    const f = fixture(); f.bot.targetDigBlock = null;
    await f.run(); assert.equal(f.calls.rescues, 1);
});

test('an orphaned harvest label without an executing action does not delay rescue', async () => {
    const f = fixture(); f.agent.actions.executing = false;
    await f.run(); assert.equal(f.calls.rescues, 1);
});

for (const geometry of ['stone', 'unknown', 'unknown-shape', 'water']) test(`${geometry} geometry still permits immediate rescue`, async () => {
    const f = fixture(), original = f.bot.blockAt;
    f.bot.blockAt = p => p.x === 1 && p.y === 65 && p.z === 0
        ? geometry === 'unknown' ? null : geometry === 'unknown-shape' ? { name: 'air' }
            : { name: geometry, boundingBox: geometry === 'water' ? 'empty' : 'block' }
        : original(p);
    await f.run(); assert.equal(f.calls.rescues, 1);
});

test('vital danger overrides canopy harvesting ownership immediately', async () => {
    const f = fixture(); f.clock.vital = true;
    await f.run(); assert.equal(f.calls.rescues, 1);
});

test('a sealed room does not receive tree-canopy grace', async () => {
    const f = fixture(); f.bot._mobility.state = 'SEALED';
    await f.run(); assert.equal(f.calls.rescues, 1);
});

test('another action with no wood skill does not receive tree-canopy grace', async () => {
    const f = fixture(); f.agent.actions.currentActionLabel = 'action:mineOres'; f.bot._currentSkill = 'mineDown';
    await f.run(); assert.equal(f.calls.rescues, 1);
});

test('standalone native mobility retains its existing rescue behavior', async () => {
    const f = fixture(); f.bot._extIntentUntil = 0;
    await f.run(); assert.equal(f.calls.rescues, 1);
});

test('self-preservation still preempts a tree harvest', async () => {
    const f = fixture(); await f.run('self_preservation'); assert.equal(f.calls.rescues, 1);
});
