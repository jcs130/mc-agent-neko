import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
const millis = value => Number.isFinite(value) ? (value < 1e11 ? value * 1000 : value) : null;
const recent = (at, now, maxAge) => Number.isFinite(at) && at <= now + 5000 && now - at <= maxAge;
const identity = value => typeof value === 'string' ? value.slice(0, 128) : null;

export function projectPluginStatus(status, now = Date.now()) {
    const info = status?.game_information, autonomy = status?.autonomy;
    return { observedAt: now, gameObservedAt: millis(info?.observedAt), sessionId: identity(info?.sessionId),
        connected: status?.connected === true, enabled: status?.unattended?.enabled === true,
        state: identity(status?.unattended?.state), pending: Boolean(status?.pending_task),
        taskFinished: status?.task_finished === true, bodyBusy: autonomy?.body_busy !== false,
        decisionAt: millis(autonomy?.last_idle_decision_at),
        lastTaskId: identity(status?.recent_task_outcomes?.[0]?.taskId),
        serverQueriesSinceTask: Number.isSafeInteger(status?.server_calls_since_task) ? status.server_calls_since_task : null };
}

export async function probePluginStatus({ fetchFn = fetch, now = Date.now } = {}) {
    // One bounded status entry; no model, task, chat, or native command is sent.
    const origin = 'http://127.0.0.1:48916', signal = AbortSignal.timeout(8000);
    const request = async (pathname, body, token) => {
        const response = await fetchFn(origin + pathname, { redirect: 'error', signal, headers: { Origin: origin },
            ...(body ? { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': token },
                body: JSON.stringify(body) } : {}) });
        if (!response.ok) throw new Error('Plugin status probe HTTP error');
        return response.json();
    };
    const security = await request('/security/csrf-token');
    const run = await request('/runs', { plugin_id: 'game_agent_minecraft', entry_id: 'game_agent_status', args: {} }, security.csrf_token);
    if (!/^[\w-]+$/.test(run.run_id ?? '')) throw new Error('Plugin status probe returned invalid run');
    for (let attempt = 0; attempt < 8; attempt++) {
        const state = await request(`/runs/${run.run_id}`);
        if (state.status === 'succeeded') {
            const output = await request(`/runs/${run.run_id}/export`);
            const item = output.items?.find(item => item.type === 'json');
            if (!item?.json?.data || item.json.success === false) throw new Error('Plugin status export failed');
            return projectPluginStatus(item.json.data, now());
        }
        if (['failed', 'canceled', 'timeout'].includes(state.status)) throw new Error('Plugin status entry failed');
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Plugin status entry still pending');
}

function progressSignature(state) {
    const inventory = Object.entries(state.inventory.counts).sort(([a], [b]) => a.localeCompare(b));
    const market = state.server?.channels?.['mcagent:market'];
    const value = market?.value;
    const quest = value && (market.kind === 'MC_MARKET_CHECK' || value.currentStep !== undefined)
        ? Object.fromEntries(['id', 'currentStep', 'progress', 'completed', 'ready'].map(key => [key, value[key]])) : null;
    return hash({ inventory, quest });
}

export function advanceProgressWatch(previous, frame, plugin, now = Date.now()) {
    const state = frame?.state, activity = state?.activity, position = state?.self?.position;
    const usable = frame?.online === true && recent(frame.observedAt, now, 45000)
        && recent(plugin?.observedAt, now, 90000) && recent(plugin?.gameObservedAt, now, 45000)
        && frame.sessionId && plugin.sessionId === frame.sessionId && plugin.enabled && plugin.connected
        && !['stopped', 'disabled'].includes(plugin.state) && plugin.taskFinished && !plugin.pending && !plugin.bodyBusy
        && activity && ['action', 'skill', 'digging'].every(key => Object.hasOwn(activity, key))
        && !activity.action && !activity.skill && !activity.digging && !activity.usingHeldItem
        && !state.self.sleeping && !state.self.isSleeping && state.inventory?.counts
        && position && ['x', 'y', 'z'].every(key => Number.isFinite(position[key]));
    if (!usable) return { schemaVersion: 1, checkedAt: now, candidate: null, reason: 'not_confirmed_idle' };
    const signature = progressSignature(state);
    const moved = previous?.position && Math.hypot(...['x', 'y', 'z'].map(key => position[key] - previous.position[key])) >= 1.5;
    const reset = !previous?.sessionId || previous.sessionId !== frame.sessionId
        || !recent(previous.checkedAt, now, 90000) || moved || previous.signature !== signature
        || previous.lastTaskId !== plugin.lastTaskId;
    const watch = reset ? { schemaVersion: 1, sessionId: frame.sessionId, firstAt: now,
        position: { ...position }, signature, lastTaskId: plugin.lastTaskId, decisions: [], samples: 0 } : { ...previous };
    watch.checkedAt = now; watch.samples++;
    const decisions = new Set(watch.decisions);
    if (recent(plugin.decisionAt, now, 10 * 60000) && plugin.decisionAt >= watch.firstAt) decisions.add(plugin.decisionAt);
    watch.decisions = [...decisions].sort((a, b) => a - b).slice(-16);
    watch.candidate = now - watch.firstAt >= 180000 && watch.decisions.length >= 3 ? {
        type: 'autonomy-idle-decision-loop', activationId: hash([watch.sessionId, watch.firstAt, watch.lastTaskId]),
        sessionId: watch.sessionId, firstAt: watch.firstAt, observedAt: now, elapsedMs: now - watch.firstAt,
        decisionCount: watch.decisions.length, samples: watch.samples, noAcceptedTask: true,
        displacementBelow: 1.5, inventoryAndQuestUnchanged: true,
        meaning: 'Repeated idle decisions without accepted task or measured progress; candidate requiring source/receipt review, not proof of a server failure or permanent freeze.',
    } : null;
    return watch;
}

export async function publishProgressCandidate(watch, publish, now = Date.now()) {
    const candidate = watch?.candidate;
    if (!candidate || watch.publication?.activationId === candidate.activationId &&
        (watch.publication.state === 'written' || now < watch.publication.retryAt)) return watch;
    const result = { ...watch };
    try {
        const response = await publish({ source: 'auto', actor: 'progress-watch', type: candidate.type, severity: 'med',
            dedupKey: 'autonomy-idle-decision-loop', title: '自主决策持续无动作，需核查',
            detail: `同会话 ${Math.round(candidate.elapsedMs / 1000)} 秒内观察到 ${candidate.decisionCount} 次不同空闲决策；未派发任务，位置、库存及可见任务进度未变化。仅为待核查候选，请检查工具轮次与真实回执；不要直接重启、移动或宣布服务器故障。`,
            evidence: candidate });
        if (!/^T-\d+$/.test(response?.ticket?.id ?? '')) throw new Error('Ticket publication unconfirmed');
        result.publication = { state: 'written', activationId: candidate.activationId, at: now, ticketId: response.ticket.id };
    } catch {
        result.publication = { state: 'pending', activationId: candidate.activationId, at: now, retryAt: now + 300000 };
    }
    return result;
}
