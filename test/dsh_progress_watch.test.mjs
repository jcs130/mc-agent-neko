import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceProgressWatch, projectPluginStatus, probePluginStatus, publishProgressCandidate } from '../services/dsh-supervisor/progress_watch.mjs';

const NOW = 1791648000000;
function sample(at, overrides = {}) {
    return { frame: { online: true, sessionId: 'game', observedAt: at, state: {
        self: { position: { x: 1, y: 64, z: 2 } }, inventory: { counts: { dirt: 4 } },
        activity: { action: null, skill: null, digging: null, usingHeldItem: false },
    } }, plugin: { observedAt: at, gameObservedAt: at, sessionId: 'game', connected: true,
        enabled: true, state: 'existing_session', pending: false, taskFinished: true, bodyBusy: false,
        lastTaskId: 'old', decisionAt: at, serverQueriesSinceTask: 3, ...overrides } };
}
function advance(watch, at, overrides) {
    const data = sample(at, overrides);
    return advanceProgressWatch(watch, data.frame, data.plugin, at);
}
function idleWindow() {
    let watch;
    for (const seconds of [0, 60, 120, 180]) watch = advance(watch, NOW + seconds * 1000);
    return watch;
}

test('requires a sustained same-session idle decision window; polling is not a decision', () => {
    let watch = advance(null, NOW);
    assert.equal(watch.candidate, null);
    watch = advance(watch, NOW + 60000, { decisionAt: NOW });
    watch = advance(watch, NOW + 120000, { decisionAt: NOW });
    watch = advance(watch, NOW + 180000, { decisionAt: NOW });
    assert.equal(watch.candidate, null);
    const active = idleWindow();
    assert.equal(active.candidate.type, 'autonomy-idle-decision-loop');
    assert.equal(active.candidate.decisionCount, 4);
    assert.equal(active.candidate.elapsedMs, 180000);
});

test('busy actions, pending dispatch, sleeping, stopped and stale inputs cannot prove an idle loop', () => {
    for (const overrides of [{ bodyBusy: true }, { pending: true }, { taskFinished: false },
        { enabled: false }, { state: 'stopped' }, { connected: false },
        { gameObservedAt: NOW - 60000 }, { sessionId: 'other' }]) {
        assert.equal(advance(idleWindow(), NOW + 240000, overrides).candidate, null);
    }
    for (const changes of [{ skill: 'mine' }, { digging: true }, { usingHeldItem: true }, { action: 'wait' }]) {
        const data = sample(NOW + 240000);
        Object.assign(data.frame.state.activity, changes);
        assert.equal(advanceProgressWatch(idleWindow(), data.frame, data.plugin, NOW + 240000).candidate, null);
    }
    const data = sample(NOW + 240000);
    data.frame.state.self.sleeping = true;
    assert.equal(advanceProgressWatch(idleWindow(), data.frame, data.plugin, NOW + 240000).candidate, null);
});

test('movement, actual inventory/quest progress, accepted-task identity and session changes reset the baseline', () => {
    for (const change of ['move', 'inventory', 'quest', 'task', 'session', 'gap']) {
        const data = sample(NOW + (change === 'gap' ? 400000 : 240000));
        if (change === 'move') data.frame.state.self.position.x += 2;
        if (change === 'inventory') data.frame.state.inventory.counts.dirt++;
        if (change === 'quest') data.frame.state.server = { channels: { 'mcagent:market': {
            kind: 'MC_MARKET_CHECK', value: { id: 'wheat', currentStep: 2, progress: 4 },
        } } };
        if (change === 'task') data.plugin.lastTaskId = 'new';
        if (change === 'session') data.frame.sessionId = data.plugin.sessionId = 'next';
        assert.equal(advanceProgressWatch(idleWindow(), data.frame, data.plugin, data.plugin.observedAt).candidate, null, change);
    }
});

test('catalogue browsing and decision revisions do not count as actual game progress', () => {
    const data = sample(NOW + 240000);
    data.frame.state.server = { channels: { 'mcagent:market': {
        kind: 'MC_MARKET_DETAIL', value: { id: 'another-catalogue', steps: [{ text: 'future' }] },
    } } };
    data.plugin.decisionRevision = 900;
    const watch = advanceProgressWatch(idleWindow(), data.frame, data.plugin, NOW + 240000);
    assert.ok(watch.candidate);
    assert.equal(watch.candidate.firstAt, NOW);
});

test('plugin projection keeps only bounded metadata, never tasks, chat, model text or credentials', () => {
    const projected = projectPluginStatus({ connected: true, unattended: { enabled: true, state: 'existing_session', api_key: 'secret' },
        game_information: { observedAt: NOW / 1000, sessionId: 'game' }, task_finished: true,
        pending_task: 'private task', recent_task_outcomes: [{ taskId: 'task', text: 'private result' }],
        autonomy: { last_idle_decision_at: NOW / 1000, body_busy: false },
        server_calls_since_task: 2, prompt: 'private prompt' }, NOW);
    assert.equal(projected.pending, true);
    assert.equal(projected.gameObservedAt, NOW);
    assert.equal(projected.lastTaskId, 'task');
    assert.doesNotMatch(JSON.stringify(projected), /secret|private/);
});

test('read-only probe uses only the official status entry and exports metadata', async () => {
    const calls = [];
    const fetchFn = async (url, options) => {
        calls.push([url, options]);
        const pathname = new URL(url).pathname;
        const value = pathname.endsWith('csrf-token') ? { csrf_token: 'secret' }
            : pathname === '/runs' ? { run_id: 'run' }
                : pathname.endsWith('/export') ? { items: [{ type: 'json', json: { data: { connected: true } } }] }
                    : { status: 'succeeded' };
        return { ok: true, json: async () => value };
    };
    const result = await probePluginStatus({ fetchFn, now: () => NOW });
    assert.equal(result.connected, true);
    assert.deepEqual(JSON.parse(calls[1][1].body), { plugin_id: 'game_agent_minecraft', entry_id: 'game_agent_status', args: {} });
    assert.ok(calls.every(([url]) => new URL(url).origin === 'http://127.0.0.1:48916'));
    assert.ok(calls.every(([, options]) => options.headers.Origin === 'http://127.0.0.1:48916'));
    assert.doesNotMatch(JSON.stringify(result), /secret|prompt/);
});

test('publishes once per activation, retries failed writes with backoff, never closes or verifies a ticket', async () => {
    let watch = idleWindow();
    let posts = 0;
    const publish = async body => { posts++; assert.equal(body.type, 'autonomy-idle-decision-loop'); return { ticket: { id: 'T-0099' } }; };
    watch = await publishProgressCandidate(watch, publish, NOW + 180000);
    watch = await publishProgressCandidate(watch, publish, NOW + 240000);
    assert.equal(posts, 1);
    assert.equal(watch.publication.ticketId, 'T-0099');
    assert.equal(watch.publication.state, 'written');
    const failed = await publishProgressCandidate(idleWindow(), async () => { throw new Error('offline'); }, NOW + 180000);
    assert.equal(failed.publication.state, 'pending');
    await publishProgressCandidate(failed, publish, NOW + 240000);
    assert.equal(posts, 1, 'no retry on every poll');
    await publishProgressCandidate(failed, publish, NOW + 480000);
    assert.equal(posts, 2);
});
