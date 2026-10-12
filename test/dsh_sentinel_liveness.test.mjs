import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceServerLiveness, frozenAliveConfirmed } from '../bots/_supervisor/server-liveness.mjs';

const NOW = 1791771000000;
const state = { v: { x: -543, y: 67, z: -439 },
    _frozen: { frozenMs: 180000, eventsAgeS: 180 } };
const frame = (at, age = 23436000, sessionId = 'own-session') => ({ online: true, observedAt: at, sessionId,
    state: { self: { position: { x: -543.5, y: 67, z: -439.5 } }, world: { age, timeOfDay: 1000 } } });

test('quiet commands and an unmoving healthy player are not a frozen loop when server packets advance', () => {
    let live = advanceServerLiveness(null, frame(NOW), state, NOW);
    assert.equal(live.confirmedLive, false);
    live = advanceServerLiveness(live, frame(NOW + 15000, 23436300), state, NOW + 15000);
    assert.equal(live.confirmedLive, true);
    assert.equal(frozenAliveConfirmed({ ...state, _serverLiveness: live }), false);
});

test('fresh file stamps and frame sequence alone cannot mask a genuinely frozen server state', () => {
    let live = advanceServerLiveness(null, frame(NOW), state, NOW);
    live = advanceServerLiveness(live, frame(NOW + 15000, 23436300), state, NOW + 15000);
    live = advanceServerLiveness(live, { ...frame(NOW + 75000, 23436300), seq: 999 }, state, NOW + 75000);
    assert.equal(live.confirmedLive, false);
    assert.equal(frozenAliveConfirmed({ ...state, _serverLiveness: live }), true);
});

test('fixed daylight still has advancing server age, while a new session cannot reuse old liveness', () => {
    let live = advanceServerLiveness(null, frame(NOW), state, NOW);
    live = advanceServerLiveness(live, frame(NOW + 15000, 23436300), state, NOW + 15000);
    assert.equal(live.confirmedLive, true);
    assert.equal(advanceServerLiveness(live, frame(NOW + 16000, 23436300, 'new-session'), state, NOW + 16000).confirmedLive, false);
});

test('missing, stale, future and another player position cannot prove current server liveness', () => {
    let live = advanceServerLiveness(null, frame(NOW), state, NOW);
    live = advanceServerLiveness(live, frame(NOW + 15000, 23436300), state, NOW + 15000);
    const wrong = frame(NOW + 16000, 23436320);
    wrong.state.self.position.x += 100;
    for (const invalid of [frame(NOW - 120000), frame(NOW + 120000), wrong,
        { ...frame(NOW + 16000), online: false }]) {
        assert.equal(advanceServerLiveness(live, invalid, state, NOW + 16000).confirmedLive, false);
    }
    assert.equal(frozenAliveConfirmed({ ...state, _frozen: { frozenMs: 10000, eventsAgeS: 180 } }), false);
    assert.equal(frozenAliveConfirmed({ ...state, _frozen: { frozenMs: 180000, eventsAgeS: 5 } }), false);
});

test('one partial file read retains recent matched packet proof but cannot renew its expiry', () => {
    assert.equal(advanceServerLiveness(null, null, state, NOW).confirmedLive, false);
    let live = advanceServerLiveness(null, frame(NOW), state, NOW);
    live = advanceServerLiveness(live, frame(NOW + 15000, 23436300), state, NOW + 15000);
    live = advanceServerLiveness(live, null, state, NOW + 30000);
    assert.equal(live.confirmedLive, true);
    assert.equal(advanceServerLiveness(live, null, state, NOW + 75000).confirmedLive, false);
    assert.equal(advanceServerLiveness(live, null, { ...state, v: { ...state.v, x: 0 } }, NOW + 31000).confirmedLive, false);
});
