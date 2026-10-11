import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function statusWithKernel(enabled, moving = false, externalOwner = false, liveSkill = null, mission = null) {
    const source = readFileSync(new URL('../src/websocket/ws_server.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '')
        .replace('export { wsServer };', 'globalThis.testServer = wsServer;');
    const context = vm.createContext({
        console,
        process: { env: { MC_FRAMEWORK_V2: enabled ? '1' : '0' } },
    });
    new vm.Script(source).runInContext(context);
    context.testServer.agent = {
        hasExternalAutonomyOwner: () => externalOwner,
        adminMission: { isActive: () => Boolean(mission), mission: { text: mission } },
    };
    return context.testServer._statusNL({
        health: 20,
        time: { timeOfDay: 6000 },
        game: { dimension: 'overworld' },
        entities: {},
        _commitment: { kind: 'REPLENISH_KIT', skill: 'replenishKit' },
        _currentSkill: liveSkill,
        pathfinder: { isMoving: () => moving },
    });
}

test('disabled kernel proposals are not reported as performed actions', () => {
    const status = statusWithKernel(false);
    assert.equal(status.kind, null);
    assert.equal(status.skill, null);
    assert.equal(status.idle, true);
    assert.match(status.text, /空闲/);
    assert.doesNotMatch(status.text, /木料|镐/);
});

test('actual movement remains visible with the kernel disabled', () => {
    const status = statusWithKernel(false, true);
    assert.equal(status.idle, false);
    assert.match(status.text, /赶路/);
});

test('enabled kernel retains its committed goal', () => {
    const status = statusWithKernel(true);
    assert.equal(status.kind, 'REPLENISH_KIT');
    assert.match(status.text, /木料/);
});

test('externally owned idle body does not report the paused kernel proposal as a skill', () => {
    const status = statusWithKernel(true, false, true);
    assert.equal(status.kind, null);
    assert.equal(status.skill, null);
    assert.equal(status.idle, true);
    assert.match(status.text, /空闲/);
    assert.doesNotMatch(status.text, /木料|镐/);
});

test('external ownership retains actual movement and live reflex skills', () => {
    const moving = statusWithKernel(true, true, true);
    assert.equal(moving.kind, null);
    assert.equal(moving.skill, null);
    assert.equal(moving.idle, false);
    assert.match(moving.text, /赶路/);
    const reflex = statusWithKernel(true, false, true, 'selfDefense');
    assert.equal(reflex.skill, 'selfDefense');
});

test('external mission remains visible without inheriting its paused proposal skill', () => {
    const status = statusWithKernel(true, false, true, null, '离开当前村民，寻找其他村民');
    assert.equal(status.kind, null);
    assert.equal(status.skill, null);
    assert.equal(status.idle, false);
    assert.equal(status.mission, '离开当前村民，寻找其他村民');
    assert.match(status.text, /离开当前村民/);
});
