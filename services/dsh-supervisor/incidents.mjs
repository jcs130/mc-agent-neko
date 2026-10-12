import { createHash } from 'node:crypto';
import { projectExecution } from './execution_evidence.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const source = fact => fact.sourceId ?? fact.id?.split('@')[0];
const terminal = ticket => ['closed', 'wontfix'].includes(ticket.status);
const byId = (a, b) => a.id.localeCompare(b.id);
const withoutClocks = value => Array.isArray(value) ? value.map(withoutClocks)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['at', 'observedAt', 'capturedAt', 'ageMs', 'sessionId'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, withoutClocks(item)])) : value;

function hydrate(fact, nativeEvents) {
    if (!source(fact)?.startsWith('native.execution.') || fact.value?.failures) return fact;
    const found = nativeEvents.find(event => event.at === (fact.value?.at ?? fact.observedAt)
        && event.value.type === fact.value?.type && (event.value.task_id ?? null) === (fact.value.taskId ?? null));
    return found ? { ...fact, value: projectExecution(found.value, fact.id) } : fact;
}

export function incidentIdentity(issue, evidence, subject = 'unknown-subject', nativeEvents = []) {
    const ids = new Set(issue.evidenceIds ?? []);
    const facts = evidence.facts.filter(f => ids.has(f.id) && f.kind !== 'record').map(f => hydrate(f, nativeEvents));
    let component = 'observation', causes, stateSignal = false;
    let relevant = facts;
    const appearance = facts.find(f => source(f) === 'game.appearance' && f.value?.subject && f.value?.available === false && f.value.reason);
    const execution = facts.filter(f => f.value?.failures?.length);
    const autonomy = facts.find(f => source(f) === 'autonomy.idle_decision_window' && f.value?.activationId);
    const mobility = issue.scope === 'current' && facts.find(f => source(f) === 'game.activity'
        && ['ENTOMBED', 'SEALED'].includes(f.value?.mobility?.state));
    if (appearance) {
        component = 'appearance'; subject = appearance.value.subject; stateSignal = true;
        causes = [appearance.value.reason]; relevant = [appearance];
    } else if (execution.length) {
        component = 'execution'; relevant = execution;
        causes = [...new Set(execution.flatMap(f => f.value.failures.map(failure =>
            JSON.stringify([failure.command, failure.causeId]))))].sort();
    } else if (autonomy) {
        component = 'autonomy'; causes = ['idle-decision-loop']; relevant = [autonomy];
    } else if (mobility) {
        component = 'mobility'; stateSignal = true; causes = [mobility.value.mobility.state]; relevant = [mobility];
    } else {
        causes = facts.map(f => [source(f), withoutClocks(f.value)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    // A model-authored label is never the identity of a known command failure.
    const key = 'dsh:incident:' + digest([component, subject, causes]);
    return { key, component, subject, stateSignal, causeIds: causes?.map(cause => digest(cause)) ?? [],
        occurrenceIds: autonomy && component === 'autonomy' ? ['autonomy:' + autonomy.value.activationId]
            : [...new Set(relevant.map(f => f.id))].sort(),
        observedAt: Math.max(0, ...relevant.map(f => Number.isFinite(f.observedAt) ? f.observedAt : 0)),
        playerName: appearance?.value.playerName ?? null };
}

function legacyAppearance(fact) {
    const text = fact.value?.excerpt;
    if (!source(fact)?.startsWith('game.events') || typeof text !== 'string') return null;
    const offset = text.indexOf('"channel":"mcagent:appearance"');
    if (offset < 0) return null;
    const packet = text.slice(offset);
    const scalar = key => {
        const match = new RegExp('"' + key + '":("(?:[^"\\\\]|\\\\.)*"|false|true|null)').exec(packet);
        try { return match ? JSON.parse(match[1]) : null; } catch { return null; }
    };
    const subject = scalar('playerUuid') || scalar('playerName'), reason = scalar('reason');
    return subject && reason && scalar('available') === false ? { ...fact, id: fact.id,
        sourceId: 'game.appearance', value: { subject, playerName: scalar('playerName'), available: false, reason } } : null;
}

export function ticketIdentity(ticket, { subject = 'unknown-subject', nativeEvents = [] } = {}) {
    if (ticket.evidence?.incident?.key) return ticket.evidence.incident;
    if (ticket.type === 'autonomy-idle-decision-loop' && ticket.evidence?.activationId) {
        const fact = { id: 'autonomy:' + ticket.evidence.activationId, sourceId: 'autonomy.idle_decision_window',
            value: ticket.evidence, observedAt: ticket.evidence.observedAt };
        return incidentIdentity({ evidenceIds: [fact.id] }, { facts: [fact] }, subject);
    }
    const facts = (ticket.evidence?.facts ?? []).map(fact => legacyAppearance(fact) ?? fact);
    return incidentIdentity({ scope: ticket.evidence?.scope, evidenceIds: facts.map(f => f.id) }, { facts }, subject, nativeEvents);
}

export function groupIncidents(tickets, options = {}) {
    const groups = new Map();
    for (const ticket of [...tickets].filter(t => !terminal(t)).sort(byId)) {
        const identity = ticketIdentity(ticket, options);
        // Legacy rule/manual records without cited facts remain distinct.
        const key = ticket.evidence?.facts?.length || ticket.evidence?.incident || ticket.evidence?.activationId ? identity.key : 'ticket:' + ticket.id;
        const group = groups.get(key) ?? { ...identity, key, ticketIds: [], primaryTicketId: ticket.id };
        group.ticketIds.push(ticket.id); groups.set(key, group);
    }
    return [...groups.values()];
}

export function reconcileStateIncidents(ledger, frame, now = Date.now()) {
    if (!frame?.online || !Number.isFinite(frame.observedAt) || now - frame.observedAt > 45000) return;
    const packet = frame.state?.server?.channels?.['mcagent:appearance'];
    for (const incident of Object.values(ledger.incidents ?? {})) {
        const healthyAppearance = incident.component === 'appearance' && packet?.value?.available === true
            && (packet.value.playerUuid || packet.value.playerName) === incident.subject
            && Number.isFinite(packet.observedAt) && now - packet.observedAt < 90000;
        const freeBody = incident.component === 'mobility' && incident.subject === frame.state?.self?.username
            && frame.state?.activity?.mobility?.state === 'FREE';
        if (healthyAppearance || freeBody) { incident.active = false; incident.clearedObservationAt = now; }
    }
}

export async function publishIncident({ issue, evidence, tickets, ledger, nativeEvents = [], subject, repairs = [], create, now = Date.now() }) {
    const identity = incidentIdentity(issue, evidence, subject, nativeEvents);
    if (!identity.occurrenceIds.length) return { state: 'unsupported', incidentKey: identity.key };
    if (identity.component === 'appearance' && identity.playerName !== subject)
        return { state: 'other_subject', incidentKey: identity.key };
    const aliases = tickets.filter(ticket => ticketIdentity(ticket, { subject, nativeEvents }).key === identity.key).sort(byId);
    const activeAliases = aliases.filter(ticket => !terminal(ticket));
    const existing = activeAliases[0] ?? aliases[0];
    const latestRepair = repairs.filter(r => aliases.some(t => t.id === r.ticketId))
        .sort((a, b) => b.recordedAt - a.recordedAt)[0];
    const verified = latestRepair?.phase === 'verified' && latestRepair.verification?.passed
        && latestRepair.writeback?.state === 'written';
    ledger.incidents ??= {};
    const previous = ledger.incidents[identity.key];
    const knownIds = [...new Set([...(previous?.occurrenceIds ?? []), ...aliases.flatMap(t =>
        ticketIdentity(t, { subject, nativeEvents }).occurrenceIds ?? [])])];
    const activationId = identity.stateSignal ? previous?.publication === 'pending' ? previous.activationId
        : previous?.active === false ? digest([identity.key, previous.clearedObservationAt ?? identity.observedAt])
            : previous?.activationId ?? existing?.evidence?.incident?.activationId ?? digest([identity.key, identity.observedAt]) : null;
    const remember = result => {
        ledger.incidents[identity.key] = { ...previous, ...identity, activationId,
            reviewerApproved: true, approvedAt: now,
            occurrenceIds: result.state === 'pending' ? knownIds : [...new Set([...knownIds, ...identity.occurrenceIds])],
            pendingOccurrenceIds: result.state === 'pending' ? identity.occurrenceIds : null,
            ticketId: result.ticketId ?? previous?.ticketId,
            active: result.state === 'pending' ? previous?.active ?? false : result.state !== 'verified_history',
            publication: result.state, lastObservedAt: identity.observedAt, lastAttemptAt: now,
            retryAt: result.state === 'pending' ? now + 300000 : null };
        return { ...result, incidentKey: identity.key, relatedTicketIds: aliases.map(t => t.id) };
    };
    if (verified && identity.observedAt <= latestRepair.verification.at)
        return remember({ state: 'verified_history', ticketId: latestRepair.ticketId });
    if (existing?.status === 'wontfix') return remember({ state: 'suppressed_wontfix', ticketId: existing.id });
    const known = identity.occurrenceIds.every(id => knownIds.includes(id));
    const confirmedActivation = identity.stateSignal && activationId && existing?.evidence?.incident?.activationId === activationId;
    const continuous = identity.stateSignal && previous?.publication !== 'pending' && previous?.active !== false && existing && !verified;
    if (known && !identity.stateSignal || continuous || confirmedActivation)
        return remember({ state: 'duplicate', ticketId: existing?.id ?? previous?.ticketId });
    if (previous?.publication === 'pending' && now < previous.retryAt)
        return { state: 'pending', incidentKey: identity.key, retryAt: previous.retryAt };
    const occurrenceIds = [...new Set([...knownIds, ...identity.occurrenceIds])];
    try {
        const response = await create({ source: 'auto', actor: 'dsh-observer', type: 'dsh-observation',
            title: issue.title, severity: issue.severity, detail: issue.detail,
            dedupKey: activeAliases[0]?.dedupKey || identity.key,
            evidence: { ids: issue.evidenceIds, snapshotAt: evidence.observedAt, scope: issue.scope,
                sessionId: evidence.sessionId, incident: { ...identity, occurrenceIds, activationId, active: true,
                    relatedTicketIds: aliases.map(t => t.id), reviewerApproved: true },
                facts: evidence.facts.filter(fact => issue.evidenceIds.includes(fact.id)) } });
        if (!/^T-\d+$/.test(response?.ticket?.id ?? '')) throw new Error('Ticket publication unconfirmed');
        const index = tickets.findIndex(t => t.id === response.ticket.id);
        if (index < 0) tickets.push(response.ticket); else tickets[index] = response.ticket;
        return remember({ state: 'written', ticketId: response.ticket.id });
    } catch {
        return remember({ state: 'pending', ticketId: existing?.id, retryAt: now + 300000 });
    }
}
