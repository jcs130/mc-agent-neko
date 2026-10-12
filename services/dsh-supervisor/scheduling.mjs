import { createHash } from 'node:crypto';
import { groupIncidents } from './incidents.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
export const ticketRevision = ticket => hash({ status: ticket.status, occurrences: ticket.occurrences ?? 1,
    evidence: ticket.evidence ?? null, detail: ticket.detail ?? null });
const observedAt = ticket => {
    const facts = ticket.evidence?.facts ?? [];
    const failures = facts.filter(fact => fact.kind === 'execution' && (fact.sourceId ?? fact.id)?.startsWith('native.execution.'));
    if (ticket.evidence?.scope === 'execution' && failures.length)
        return Math.max(0, ...failures.map(fact => fact.observedAt ?? 0));
    return Math.max(0, ticket.evidence?.observedAt ?? 0,
        ...facts.filter(fact => fact.kind !== 'record').map(fact => fact.observedAt ?? 0));
};

export function chooseTicket(tickets, ledger, now = Date.now(), options = {}) {
    const active = tickets.filter(t => !['closed', 'wontfix'].includes(t.status));
    const groups = groupIncidents(active, options);
    const candidates = [];
    for (const group of groups) {
        const members = active.filter(t => group.ticketIds.includes(t.id));
        const revision = hash(members.map(t => [t.id, ticketRevision(t)]));
        if (ledger.reviewedGroups?.[group.key] === revision) continue;
        const verified = (options.receipts ?? []).filter(r => group.ticketIds.includes(r.ticketId)
            && r.phase === 'verified' && r.verification?.passed && r.writeback?.state === 'written'
            && members.find(t => t.id === r.ticketId)?.occurrences === r.ticketOccurrences)
            .sort((a, b) => b.recordedAt - a.recordedAt)[0];
        if (verified && members.every(t => observedAt(t) <= verified.verification.at)) continue;
        const unreviewed = members.filter(t => ledger.reviewedEvidence?.[t.id] !== ticketRevision(t)
            && !(ledger.reviewedEvidence?.[t.id] === undefined && ledger.reviewed?.[t.id] === t.updatedAt));
        const pending = unreviewed.length ? unreviewed : options.legacyRotation ? members : [];
        if (!pending.length) continue;
        pending.sort((a, b) => observedAt(b) - observedAt(a) || a.id.localeCompare(b.id));
        const selected = pending[0];
        const fresh = now - observedAt(selected) <= (selected.evidence?.scope === 'execution' ? 1800000 : 90000);
        const priorRepair = (options.receipts ?? []).find(r => r.ticketId === selected.id);
        const recurrent = priorRepair && (selected.occurrences ?? 1) > priorRepair.ticketOccurrences;
        const severity = { critical: 4, high: 3, med: 2, low: 1 }[selected.severity] ?? 0;
        candidates.push({ ticket: { ...selected, _incidentGroup: { key: group.key, ticketIds: group.ticketIds, revision } },
            rank: [fresh ? 1 : 0, recurrent ? 1 : 0, severity],
            attemptedAt: ledger.attemptedAt?.[selected.id] ?? ledger.reviewedAt?.[selected.id] ?? 0 });
    }
    candidates.sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || b.rank[2] - a.rank[2]
        || a.attemptedAt - b.attemptedAt || a.ticket.id.localeCompare(b.ticket.id));
    return candidates[0]?.ticket ?? null;
}

export function recordReviewed(ledger, selected, updatedAt, now = Date.now()) {
    ledger.reviewed ??= {}; ledger.reviewedAt ??= {}; ledger.reviewedEvidence ??= {}; ledger.reviewedGroups ??= {};
    ledger.reviewed[selected.id] = updatedAt;
    ledger.reviewedAt[selected.id] = now;
    ledger.reviewedEvidence[selected.id] = ticketRevision(selected);
    if (selected._incidentGroup) ledger.reviewedGroups[selected._incidentGroup.key] = selected._incidentGroup.revision;
}
