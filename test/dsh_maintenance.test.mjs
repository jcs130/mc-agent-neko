import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildMaintenanceQueue, syncMaintenanceQueue, claimMaintenance, renewMaintenance, finishMaintenance, peekMaintenance, maintenanceGate } from '../services/dsh-supervisor/maintenance.mjs';

const NOW = 1791763928193;
const key = 'dsh:incident:known-refusal';
const ticket = { id: 'T-0083', title: 'Repeated observed refusal', status: 'open', severity: 'high', occurrences: 1,
    evidence: { incident: { key, component: 'execution', subject: 'ag_NEKO', occurrenceIds: ['receipt-1'],
        observedAt: NOW, reviewerApproved: true }, facts: [] } };
const input = (extra = {}) => ({ tickets: [ticket], ledger: {}, receipts: [], now: NOW, enabled: true, ...extra });
const root = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-maintenance-'));
    t.after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('neko-maintenance-')); fs.rmSync(dir, { recursive: true, force: true }); }); return dir; };

test('only reviewer-approved findings become durable maintenance requests', () => {
    const queue = buildMaintenanceQueue(input());
    assert.equal(queue.requests.length, 1);
    assert.equal(queue.requests[0].status, 'queued');
    assert.equal(queue.requests[0].baselines[ticket.id], 1);
    assert.equal(queue.automaticCodeExecution, false);
    const unknown = { ...ticket, evidence: { facts: [] } };
    assert.equal(buildMaintenanceQueue(input({ tickets: [unknown] })).requests.length, 0);
});

test('an already checked maintainer repair is dispatched for deployment and verification without a new model finding', () => {
    const manual = { id: 'T-0085', status: 'open', occurrences: 1, severity: 'high', type: 'supervisor-code', evidence: {} };
    const receipt = { id: 'checked-monitor-repair', ticketId: manual.id, ticketOccurrences: 1, recordedAt: NOW,
        phase: 'prepared', commit: 'a'.repeat(40), checks: [{ name: 'regression', exitCode: 0, sha256: 'b'.repeat(64) }], writeback: { state: 'written' } };
    const prepared = buildMaintenanceQueue(input({ tickets: [manual], receipts: [receipt] }));
    assert.equal(prepared.requests[0].status, 'prepared');
    assert.equal(prepared.requests[0].approvalKind, 'checked-repair-follow-up');
    const verified = { ...receipt, phase: 'verified', recordedAt: NOW + 2000,
        deployment: { at: NOW + 1000 }, verification: { passed: true, at: NOW + 1500 } };
    const next = buildMaintenanceQueue(input({ previous: prepared, tickets: [manual], receipts: [verified], now: NOW + 3000 }));
    assert.equal(next.requests[0].id, prepared.requests[0].id);
    assert.equal(next.requests[0].status, 'verified');
});

test('claim persists across monitor synchronization and prevents duplicate workers', t => {
    const dir = root(t);
    syncMaintenanceQueue(dir, input());
    const claimed = claimMaintenance(dir, 'worker-a', { now: NOW, enabled: true });
    assert.equal(claimed.state, 'claimed');
    syncMaintenanceQueue(dir, input({ now: NOW + 1000 }));
    assert.equal(claimMaintenance(dir, 'worker-b', { now: NOW + 2000, enabled: true }).state, 'idle');
    assert.equal(peekMaintenance(dir, NOW + 2000).claimed, 1);
    assert.equal(peekMaintenance(dir, NOW + 2000).due, 0);
});

test('expired leases are bounded and new workers cannot finish another lease', t => {
    const dir = root(t); syncMaintenanceQueue(dir, input());
    const first = claimMaintenance(dir, 'worker-a', { now: NOW, enabled: true, leaseMs: 1000 });
    const second = claimMaintenance(dir, 'worker-b', { now: NOW + 1001, enabled: true });
    assert.equal(second.state, 'claimed');
    assert.notEqual(first.lease.id, second.lease.id);
    assert.throws(() => renewMaintenance(dir, first.request.id, first.lease.id, 'worker-a', { now: NOW + 1002 }), /lease/i);
});

test('new evidence supersedes an old request without running two repairs for one incident', t => {
    const dir = root(t); syncMaintenanceQueue(dir, input());
    const claimed = claimMaintenance(dir, 'worker-a', { now: NOW, enabled: true });
    const recurrent = { ...ticket, occurrences: 2, evidence: { incident: { ...ticket.evidence.incident,
        occurrenceIds: ['receipt-1', 'receipt-2'], observedAt: NOW + 1000 } } };
    syncMaintenanceQueue(dir, input({ tickets: [recurrent], now: NOW + 1000 }));
    assert.equal(claimMaintenance(dir, 'worker-b', { now: NOW + 2000, enabled: true }).state, 'idle');
    const renewed = renewMaintenance(dir, claimed.request.id, claimed.lease.id, 'worker-a', { now: NOW + 2000 });
    assert.notEqual(renewed.request.id, claimed.request.id);
    assert.equal(renewed.request.baselines[ticket.id], 2);
    assert.equal(renewed.lease.id, claimed.lease.id);
});

test('a checked receipt cannot verify a later occurrence or erase pending API confirmation', () => {
    const queue = buildMaintenanceQueue(input());
    const receipt = { ticketId: ticket.id, ticketOccurrences: 1, recordedAt: NOW + 1000,
        phase: 'verified', verification: { passed: true, at: NOW + 1000 }, writeback: { state: 'written' } };
    assert.equal(buildMaintenanceQueue(input({ previous: queue, receipts: [receipt], now: NOW + 2000 })).requests[0].status, 'verified');
    const pending = { ...receipt, writeback: { state: 'pending' } };
    assert.equal(buildMaintenanceQueue(input({ previous: queue, receipts: [pending] })).requests[0].status, 'pending_api');
    const recurrent = { ...ticket, occurrences: 2 };
    const next = buildMaintenanceQueue(input({ previous: queue, tickets: [recurrent], receipts: [receipt], now: NOW + 2000 }));
    assert.equal(next.requests.find(r => r.status !== 'superseded').status, 'queued');
});

test('no-change disposition requires actual evidence and does not close a ticket', t => {
    const dir = root(t); syncMaintenanceQueue(dir, input());
    const claimed = claimMaintenance(dir, 'worker-a', { now: NOW, enabled: true });
    assert.throws(() => finishMaintenance(dir, claimed.request.id, claimed.lease.id, 'worker-a', 'observed_clear', null, { now: NOW + 1000 }), /evidence/i);
    const proof = path.join(dir, 'actual-observation.json'); fs.writeFileSync(proof, JSON.stringify({ at: NOW + 1000, checked: true }));
    const finished = finishMaintenance(dir, claimed.request.id, claimed.lease.id, 'worker-a', 'observed_clear', proof, { now: NOW + 1000 });
    assert.equal(finished.request.status, 'observed_clear');
    assert.equal(ticket.status, 'open');
    assert.equal(peekMaintenance(dir, NOW + 2000).due, 0);
});

test('disabled unattended mode never claims maintenance work', t => {
    const dir = root(t); syncMaintenanceQueue(dir, input());
    assert.equal(claimMaintenance(dir, 'worker-a', { now: NOW, enabled: false }).state, 'disabled');
    assert.equal(peekMaintenance(dir, NOW).due, 1);
});

test('an approved publication with no confirmed ticket is retained for API handoff', () => {
    const ledger = { incidents: { [key]: { key, component: 'execution', reviewerApproved: true,
        publication: 'pending', observedAt: NOW, pendingOccurrenceIds: ['actual-receipt'], reportAt: NOW } } };
    const queue = buildMaintenanceQueue(input({ tickets: [], ledger }));
    assert.equal(queue.requests[0].status, 'pending_api');
    assert.equal(queue.requests[0].requiresTicketConfirmation, true);
    assert.equal(queue.requests[0].source.reportAt, NOW);
});

test('an evidenced no-change outcome is not reopened by an older deployment receipt', t => {
    const dir = root(t), receipt = { ticketId: ticket.id, ticketOccurrences: 1, recordedAt: NOW,
        phase: 'deployed', writeback: { state: 'written' } };
    syncMaintenanceQueue(dir, input({ receipts: [receipt] }));
    const claimed = claimMaintenance(dir, 'worker-a', { now: NOW + 301000, enabled: true });
    const proof = path.join(dir, 'actual-observation.json'); fs.writeFileSync(proof, JSON.stringify({ at: NOW + 302000 }));
    finishMaintenance(dir, claimed.request.id, claimed.lease.id, 'worker-a', 'observed_clear', proof, { now: NOW + 302000 });
    syncMaintenanceQueue(dir, input({ receipts: [receipt], now: NOW + 303000 }));
    assert.equal(peekMaintenance(dir, NOW + 303000).due, 0);
});

test('separate CLI processes can claim one request only once', async t => {
    const dir = root(t), trial = path.join(dir, 'trial'), runtime = path.join(trial, 'runtime/dsh-supervisor');
    fs.mkdirSync(trial, { recursive: true }); fs.writeFileSync(path.join(trial, 'unattended-state.json'), JSON.stringify({ enabled: true }));
    syncMaintenanceQueue(runtime, input({ now: Date.now() }));
    const script = fileURLToPath(new URL('../services/dsh-supervisor/maintenance.mjs', import.meta.url));
    const results = await Promise.allSettled(['worker-a', 'worker-b'].map(worker => promisify(execFile)(process.execPath,
        [script, 'claim', runtime, worker], { windowsHide: true, timeout: 5000 })));
    const claimed = results.filter(r => r.status === 'fulfilled' && JSON.parse(r.value.stdout).state === 'claimed');
    assert.equal(claimed.length, 1);
    assert.equal(peekMaintenance(runtime).claimed, 1);
});

test('finishing a code repair requires stored matching receipts and unchanged checked evidence', t => {
    const dir = root(t); syncMaintenanceQueue(dir, input());
    const claimed = claimMaintenance(dir, 'worker-a', { now: NOW, enabled: true });
    const logs = path.join(dir, 'checks.log'), proof = path.join(dir, 'runtime.json');
    fs.writeFileSync(logs, 'actual checks passed'); fs.writeFileSync(proof, JSON.stringify({ at: NOW + 1000, passed: true }));
    const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const receipt = { schemaVersion: 1, id: 'actual-repair', ticketId: ticket.id, ticketOccurrences: 1,
        phase: 'verified', commit: 'a'.repeat(40), checks: [{ name: 'checks', exitCode: 0, logPath: logs, sha256: sha(logs) }],
        deployment: { at: NOW, component: 'native', commit: 'a'.repeat(40) },
        verification: { passed: true, at: NOW + 1000, evidencePath: proof, sha256: sha(proof) }, writeback: { state: 'written' } };
    fs.mkdirSync(path.join(dir, 'repair-receipts'));
    const receiptPath = path.join(dir, 'repair-receipts/actual-repair.json'); fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    fs.writeFileSync(logs, 'evidence changed after the receipt');
    assert.throws(() => finishMaintenance(dir, claimed.request.id, claimed.lease.id, 'worker-a', 'verified', receiptPath, { now: NOW + 2000 }), /evidence changed/i);
    fs.writeFileSync(logs, 'actual checks passed');
    assert.equal(finishMaintenance(dir, claimed.request.id, claimed.lease.id, 'worker-a', 'verified', receiptPath, { now: NOW + 2000 }).state, 'verified');
    assert.equal(ticket.status, 'open');
});

test('fast checks stay quiet while full health checks remain hourly and user stop wins', t => {
    const dir = root(t), trial = path.join(dir, 'trial'), runtime = path.join(trial, 'runtime/dsh-supervisor');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(trial, 'unattended-state.json'), JSON.stringify({ enabled: true }));
    fs.writeFileSync(path.join(trial, 'hourly-check-state.json'), JSON.stringify({ checked_at: new Date(NOW - 600000).toISOString() }));
    fs.writeFileSync(path.join(runtime, 'status.json'), JSON.stringify({ checkedAt: NOW, state: 'watching' }));
    fs.writeFileSync(path.join(runtime, 'maintenance-queue.json'), JSON.stringify({ updatedAt: NOW, enabled: true, requests: [] }));
    assert.equal(maintenanceGate(runtime, NOW).action, 'quiet');
    fs.writeFileSync(path.join(trial, 'hourly-check-state.json'), JSON.stringify({ checked_at: new Date(NOW - 3600001).toISOString() }));
    assert.equal(maintenanceGate(runtime, NOW).action, 'full_inspection');
    fs.writeFileSync(path.join(trial, 'unattended-state.json'), JSON.stringify({ enabled: false }));
    assert.equal(maintenanceGate(runtime, NOW).action, 'respect_stop');
});

test('fast gate detects monitor infrastructure loss without probing the game model', t => {
    const dir = root(t), trial = path.join(dir, 'trial'), runtime = path.join(trial, 'runtime/dsh-supervisor');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(trial, 'unattended-state.json'), JSON.stringify({ enabled: true }));
    fs.writeFileSync(path.join(trial, 'hourly-check-state.json'), JSON.stringify({ checked_at: new Date(NOW).toISOString() }));
    const gate = maintenanceGate(runtime, NOW);
    assert.equal(gate.action, 'inspect_monitor');
    assert.equal(gate.fullInspectionDue, false);
});
