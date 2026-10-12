import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { groupIncidents, ticketIdentity } from './incidents.mjs';
import { validateRepairReceipt } from './repair.mjs';
import { readReceiptEvidence } from './execution_evidence.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const done = status => ['verified', 'observed_clear', 'no_repair_needed', 'superseded', 'withdrawn'].includes(status);
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const liveLease = (request, now) => request.lease && request.lease.expiresAt > now;
const eligible = (request, now) => !done(request.status) && request.dueAt <= now && !liveLease(request, now);

export function buildMaintenanceQueue({ tickets, ledger, receipts, previous = {}, now = Date.now(), enabled = true, ...options }) {
    const old = new Map((previous.requests ?? []).map(r => [r.id, r]));
    const current = [], keys = new Set();
    for (const group of groupIncidents(tickets, options)) {
        const members = tickets.filter(t => group.ticketIds.includes(t.id));
        const checkedRepair = receipts.filter(r => group.ticketIds.includes(r.ticketId) && /^[a-f0-9]{40}$/.test(r.commit ?? '')
            && r.checks?.length && r.checks.every(check => Number.isInteger(check.exitCode) && /^[a-f0-9]{64}$/.test(check.sha256 ?? '')))
            .sort((a, b) => b.recordedAt - a.recordedAt)[0];
        const followup = checkedRepair && (checkedRepair.phase !== 'verified' || checkedRepair.writeback?.state !== 'written'
            || previous.requests?.some(r => r.incidentKey === group.key));
        const progress = options.progress;
        const measured = options.gameOnline === true && progress?.type === 'autonomy-idle-decision-loop'
            && progress.sessionId === options.sessionId && Number.isFinite(progress.observedAt)
            && progress.observedAt <= now + 5000 && now - progress.observedAt <= 90000
            && progress.elapsedMs >= 180000 && progress.decisionCount >= 3
            && progress.noAcceptedTask === true && progress.inventoryAndQuestUnchanged === true
            && members.some(t => t.type === progress.type && t.evidence?.activationId === progress.activationId);
        const approved = ledger.incidents?.[group.key] ?? members.map(t => t.evidence?.incident).find(i => i?.reviewerApproved)
            ?? (measured ? { ...group, triageCandidate: true, approvalKind: 'measured-progress-triage',
                occurrenceIds: ['autonomy:' + progress.activationId], observedAt: progress.observedAt } : null)
            ?? (followup ? { ...group, reviewerApproved: true, ticketId: checkedRepair.ticketId,
                approvalKind: 'checked-repair-follow-up', occurrenceIds: ['repair:' + checkedRepair.ticketId + ':' + checkedRepair.ticketOccurrences],
                observedAt: group.observedAt || checkedRepair.deployment?.at || checkedRepair.recordedAt } : null);
        if ((!approved?.reviewerApproved && !approved?.triageCandidate) || !members.length) continue;
        const latestObservedAt = measured ? Math.max(approved.observedAt ?? 0, progress.observedAt) : approved.observedAt ?? group.observedAt;
        const baselines = Object.fromEntries(members.map(t => [t.id, t.occurrences ?? 1]));
        const occurrenceIds = (approved.stateSignal ? [approved.activationId || group.key]
            : approved.occurrenceIds ?? ticketIdentity(members[0], options).occurrenceIds).slice().sort();
        const id = 'mr-' + hash([group.key, baselines, occurrenceIds]).slice(0, 24);
        const prior = old.get(id);
        const latest = receipts.filter(r => group.ticketIds.includes(r.ticketId) && baselines[r.ticketId] === r.ticketOccurrences)
            .sort((a, b) => b.recordedAt - a.recordedAt)[0];
        let status = prior?.status && done(prior.status) ? prior.status : 'queued';
        const repairFactAt = latest?.verification?.at ?? latest?.deployment?.at ?? latest?.recordedAt;
        if (latest && !(prior?.result && done(prior.status) && prior.result.at >= repairFactAt)) {
            status = latest.writeback?.state !== 'written' ? 'pending_api'
                : latest.phase === 'verified' && latest.verification?.passed && latest.verification.at >= (latestObservedAt ?? 0)
                    ? 'verified' : latest.phase === 'verified' ? 'queued' : latest.phase;
        }
        const contradictedVerification = measured && latest?.phase === 'verified' && latest.verification?.at < latestObservedAt;
        if (contradictedVerification) status = 'queued';
        if (prior?.lease && liveLease(prior, now) && !done(status)) status = 'claimed';
        const dueAt = contradictedVerification ? now : ['prepared', 'deployed', 'pending_api'].includes(status) && latest
            ? Math.max(prior?.dueAt ?? 0, latest.recordedAt + 300000) : prior?.dueAt ?? now;
        const severity = members.reduce((level, t) => Math.max(level, { critical: 40, high: 30, med: 20, low: 10 }[t.severity] ?? 0), 0);
        const recurrent = receipts.some(r => group.ticketIds.includes(r.ticketId) && baselines[r.ticketId] > r.ticketOccurrences);
        const fresh = now - (latestObservedAt ?? 0) <= (group.component === 'execution' ? 1800000 : 90000);
        current.push({ ...prior, id, incidentKey: group.key, component: group.component, ticketId: approved.ticketId ?? group.primaryTicketId,
            approvalKind: approved.approvalKind ?? 'reviewer-approved-finding',
            requiresRuntimeRecheck: approved.triageCandidate === true,
            ticketIds: group.ticketIds, baselines, occurrenceIds, observedAt: latestObservedAt,
            createdAt: prior?.createdAt ?? now, updatedAt: now, dueAt, status, priority: severity + (fresh ? 1000 : 0) + (recurrent && fresh ? 100 : 0),
            lease: prior?.lease ?? null,
            source: { reportRoot: 'reports', reportAt: approved.reportAt ?? null, ticketPath: 'repair-queue.json', evidenceIds: occurrenceIds,
                ...(measured ? { measuredProgress: { firstAt: progress.firstAt, observedAt: progress.observedAt,
                    elapsedMs: progress.elapsedMs, decisionCount: progress.decisionCount, samples: progress.samples } } : {}) },
            repair: latest ? { id: latest.id, phase: latest.phase, commit: latest.commit,
                writeback: latest.writeback?.state, verificationAt: latest.verification?.at ?? null } : null });
        keys.add(group.key); old.delete(id);
    }
    for (const approved of Object.values(ledger.incidents ?? {})) {
        if (!approved.reviewerApproved || approved.publication !== 'pending' || keys.has(approved.key)) continue;
        const id = 'mr-' + hash([approved.key, approved.pendingOccurrenceIds, 'pending-api']).slice(0, 24);
        const prior = old.get(id);
        current.push({ ...prior, id, incidentKey: approved.key, component: approved.component, ticketId: approved.ticketId ?? null,
            ticketIds: [], baselines: {}, occurrenceIds: approved.pendingOccurrenceIds ?? [], observedAt: approved.observedAt,
            createdAt: prior?.createdAt ?? now, updatedAt: now, dueAt: prior?.dueAt ?? now,
            status: prior?.lease && liveLease(prior, now) ? 'claimed' : done(prior?.status) ? prior.status : 'pending_api',
            priority: 30, lease: prior?.lease ?? null, requiresTicketConfirmation: true,
            source: { reportRoot: 'reports', reportAt: approved.reportAt ?? null, evidenceIds: approved.pendingOccurrenceIds ?? [] } });
        keys.add(approved.key); old.delete(id);
    }
    for (const request of old.values()) current.push(done(request.status) ? request
        : { ...request, status: keys.has(request.incidentKey) ? 'superseded' : 'withdrawn', updatedAt: now });
    return { schemaVersion: 1, updatedAt: now, enabled, nativeRoot: options.nativeRoot ?? previous.nativeRoot,
        automaticCodeExecution: false, automaticTicketClosure: false,
        executor: 'existing-codex-maintainer', requests: current.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt) };
}

function transaction(runtimeRoot, change) {
    const root = path.resolve(runtimeRoot); fs.mkdirSync(root, { recursive: true });
    const lockPath = path.join(root, 'maintenance.lock'), queuePath = path.join(root, 'maintenance-queue.json');
    let lock;
    try { lock = fs.openSync(lockPath, 'wx'); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const prior = read(lockPath);
        let alive = true;
        if (Number.isSafeInteger(prior?.pid)) { try { process.kill(prior.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; } }
        if (alive || !prior || Date.now() - prior.at < 10000) throw Error('Maintenance queue transaction busy');
        fs.unlinkSync(lockPath); lock = fs.openSync(lockPath, 'wx');
    }
    try {
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
        const previous = read(queuePath) ?? { schemaVersion: 1, enabled: false, requests: [] };
        const { queue, result } = change(previous);
        if (queue) {
            const temporary = `${queuePath}.${process.pid}.${randomUUID()}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify(queue, null, 2)); fs.renameSync(temporary, queuePath);
        }
        return result;
    } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

export function syncMaintenanceQueue(runtimeRoot, input) {
    return transaction(runtimeRoot, previous => { const queue = buildMaintenanceQueue({ ...input, previous }); return { queue, result: queue }; });
}

export function peekMaintenance(runtimeRoot, now = Date.now()) {
    const queue = read(path.join(runtimeRoot, 'maintenance-queue.json')) ?? { requests: [], enabled: false };
    const blockedKeys = new Set(queue.requests.filter(r => liveLease(r, now)).map(r => r.incidentKey));
    const due = queue.requests.filter(r => eligible(r, now) && !blockedKeys.has(r.incidentKey));
    return { updatedAt: queue.updatedAt ?? null, enabled: queue.enabled, due: due.length,
        claimed: queue.requests.filter(r => liveLease(r, now)).length,
        next: due[0] ? { id: due[0].id, ticketId: due[0].ticketId, priority: due[0].priority, status: due[0].status } : null };
}

export function maintenanceGate(runtimeRoot, now = Date.now()) {
    const trial = path.resolve(runtimeRoot, '../..');
    const config = read(path.join(trial, 'unattended-state.json'));
    const baseline = read(path.join(trial, 'hourly-check-state.json'));
    const status = read(path.join(runtimeRoot, 'status.json'));
    const fullAt = Date.parse(baseline?.last_full_inspection_at ?? baseline?.checked_at ?? '');
    const queue = peekMaintenance(runtimeRoot, now);
    const enabled = config?.enabled === true;
    const fullInspectionDue = enabled && (!Number.isFinite(fullAt) || now - fullAt >= 3600000);
    const monitorInspectionDue = enabled && (!Number.isFinite(status?.checkedAt) || now - status.checkedAt > 120000
        || Boolean(status.maintenanceError) || ['error', 'stopped', 'deferred'].includes(status.state) || !queue.updatedAt);
    return { at: now, enabled, fullInspectionDue, monitorInspectionDue, dueRequests: enabled ? queue.due : 0,
        activeClaims: queue.claimed, lastFullInspectionAt: Number.isFinite(fullAt) ? fullAt : null,
        action: !enabled ? 'respect_stop' : monitorInspectionDue ? 'inspect_monitor'
            : queue.due ? 'claim_maintenance' : fullInspectionDue ? 'full_inspection' : 'quiet',
        gameCommandsSent: 0, modelCalls: 0 };
}

export function claimMaintenance(runtimeRoot, worker, { now = Date.now(), enabled = false, leaseMs = 1800000 } = {}) {
    if (!/^[a-z0-9_-]{1,80}$/.test(worker)) throw Error('Invalid maintenance worker');
    if (!enabled) return { state: 'disabled' };
    if (!Number.isFinite(leaseMs) || leaseMs <= 0 || leaseMs > 3600000) throw Error('Invalid lease duration');
    return transaction(runtimeRoot, queue => {
        if (!queue.enabled) return { result: { state: 'disabled' } };
        const busy = new Set(queue.requests.filter(r => liveLease(r, now)).map(r => r.incidentKey));
        const request = queue.requests.find(r => eligible(r, now) && !busy.has(r.incidentKey));
        if (!request) return { result: { state: 'idle' } };
        request.lease = { id: randomUUID(), worker, claimedAt: now, expiresAt: now + leaseMs };
        request.status = 'claimed'; request.updatedAt = now;
        return { queue, result: { state: 'claimed', request, lease: request.lease } };
    });
}

function owned(queue, id, leaseId, worker, now) {
    const request = queue.requests.find(r => r.id === id);
    if (!request || request.lease?.id !== leaseId || request.lease.worker !== worker || !liveLease(request, now)) throw Error('Maintenance lease mismatch or expired');
    return request;
}

export function renewMaintenance(runtimeRoot, id, leaseId, worker, { now = Date.now() } = {}) {
    return transaction(runtimeRoot, queue => {
        const previous = owned(queue, id, leaseId, worker, now);
        const request = queue.requests.find(r => r.incidentKey === previous.incidentKey && r.status !== 'superseded' && !done(r.status)) ?? previous;
        request.lease = { ...previous.lease, expiresAt: now + 1800000 };
        if (request !== previous) previous.lease = null;
        request.status = 'claimed'; request.updatedAt = now;
        return { queue, result: { state: 'claimed', request, lease: request.lease, baselineChanged: request !== previous } };
    });
}

export function finishMaintenance(runtimeRoot, id, leaseId, worker, disposition, evidencePath, { now = Date.now() } = {}) {
    if (!['prepared', 'deployed', 'verified', 'failed', 'needs_information', 'observed_clear', 'no_repair_needed'].includes(disposition)) throw Error('Invalid maintenance disposition');
    if (!path.isAbsolute(evidencePath ?? '')) throw Error('Maintenance requires an absolute evidence path');
    const contents = fs.readFileSync(evidencePath); if (!contents.length) throw Error('Maintenance evidence is empty');
    return transaction(runtimeRoot, queue => {
        const request = owned(queue, id, leaseId, worker, now);
        if (request.status === 'superseded' || request.status === 'withdrawn') throw Error('Maintenance baseline changed; renew and recheck first');
        if (['prepared', 'deployed', 'verified'].includes(disposition)) {
            if (path.dirname(path.resolve(evidencePath)) !== path.resolve(runtimeRoot, 'repair-receipts'))
                throw Error('Use the stored repair receipt after its checked API writeback');
            const receipt = JSON.parse(contents.toString('utf8')); validateRepairReceipt(receipt);
            if (receipt.phase !== disposition || request.baselines[receipt.ticketId] !== receipt.ticketOccurrences
                || receipt.writeback?.state !== 'written') throw Error('Maintenance receipt does not match confirmed request baseline');
            for (const check of receipt.checks) if (hash(fs.readFileSync(check.logPath)) !== check.sha256) throw Error('Maintenance check evidence changed');
            if (disposition === 'verified' && (receipt.verification.at < request.observedAt
                || hash(fs.readFileSync(receipt.verification.evidencePath)) !== receipt.verification.sha256)) throw Error('Runtime verification evidence is stale or changed');
        }
        request.status = disposition; request.lease = null; request.updatedAt = now;
        request.dueAt = now + (['prepared', 'deployed'].includes(disposition) ? 300000 : 3600000);
        request.result = { disposition, at: now, evidencePath, sha256: hash(contents), worker };
        return { queue, result: { state: disposition, request } };
    });
}

function cli() {
    const [command, runtimeRoot, ...args] = process.argv.slice(2);
    if (!runtimeRoot) throw Error('Usage: maintenance.mjs peek|claim|renew|finish runtime-root [arguments]');
    const config = read(path.resolve(runtimeRoot, '../..', 'unattended-state.json'));
    let result;
    if (command === 'peek') result = peekMaintenance(runtimeRoot);
    else if (command === 'gate') result = maintenanceGate(runtimeRoot);
    else if (command === 'evidence') {
        const queue = read(path.join(runtimeRoot, 'maintenance-queue.json'));
        result = readReceiptEvidence(queue?.nativeRoot || path.resolve(runtimeRoot, '../../mc-agent-neko'), args[0], args[1]);
    }
    else if (command === 'claim') result = claimMaintenance(runtimeRoot, args[0], { enabled: config?.enabled === true });
    else if (command === 'renew') result = config?.enabled === true ? renewMaintenance(runtimeRoot, ...args) : { state: 'disabled' };
    else if (command === 'finish') result = finishMaintenance(runtimeRoot, ...args);
    else throw Error('Unknown maintenance command');
    console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
