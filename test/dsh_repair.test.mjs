import test from 'node:test';
import assert from 'node:assert/strict';
import * as repair from '../services/dsh-supervisor/repair.mjs';

const NOW = 1791562000000;
const ticket = { id: 'T-0003', title: 'Repeated exception', status: 'open', occurrences: 2,
    updatedAt: new Date(NOW).toISOString(), history: [] };
const receipt = { schemaVersion: 1, id: 'recipe-20261010', ticketId: ticket.id, ticketOccurrences: 2,
    phase: 'deployed', commit: 'a'.repeat(40), checks: [{ name: 'regression', exitCode: 0, logPath: 'D:/logs/check.log', sha256: 'b'.repeat(64) }],
    deployment: { at: NOW, component: 'native', commit: 'a'.repeat(40) }, recordedAt: NOW };

test('repair states require successful checks and deployment before verified', () => {
    assert.doesNotThrow(() => repair.validateRepairReceipt(receipt));
    assert.throws(() => repair.validateRepairReceipt({ ...receipt, checks: [{ ...receipt.checks[0], exitCode: 1 }] }), /check/i);
    assert.throws(() => repair.validateRepairReceipt({ ...receipt, phase: 'verified' }), /verification/i);
    assert.throws(() => repair.validateRepairReceipt({ ...receipt, phase: 'deployed', deployment: null }), /deployment/i);
    assert.throws(() => repair.validateRepairReceipt({ ...receipt, id: '../other' }), /id/i);
});

test('queue never treats a diagnosis or cleared detector as a completed repair', () => {
    const cleared = { ...ticket, status: 'verifying', resolution: 'sentinel auto-cleared' };
    const queue = repair.buildRepairQueue([cleared], [], NOW);
    assert.equal(queue.items[0].stage, 'needs_diagnosis');
    assert.equal(queue.items[0].repair, null);
    assert.equal(repair.buildRepairQueue([ticket], [{ ...receipt, ticketId: 'T-9999' }], NOW).items[0].repair, null);
});

test('repair queue exposes unverified deployment and real recurrence', () => {
    const written = { ...receipt, writeback: { state: 'written' } };
    assert.equal(repair.buildRepairQueue([ticket], [written], NOW).items[0].stage, 'awaiting_runtime_verification');
    assert.equal(repair.buildRepairQueue([{ ...ticket, occurrences: 3 }], [written], NOW).items[0].stage, 'recurrence_after_repair');
    assert.equal(repair.buildRepairQueue([ticket], [{ ...receipt, writeback: { state: 'pending' } }], NOW).items[0].stage, 'handoff_pending');
});

test('repair comments are confirmed, retryable and idempotent without changing ticket status', async () => {
    const stored = []; let posts = 0;
    let current = structuredClone(ticket);
    const input = { receipt, read: async () => current, save: value => stored.push(value),
        post: async (_id, body) => {
            posts++; assert.match(body.note, /尚未证明游戏恢复/);
            assert.equal(body.status, undefined);
            current = { ...current, updatedAt: 'next', history: [{ actor: body.actor, note: body.note }] };
            return current;
        } };
    assert.equal((await repair.recordRepair(input)).writeback.state, 'written');
    assert.equal((await repair.recordRepair(input)).writeback.state, 'written');
    assert.equal(posts, 1);
    assert.equal(current.status, 'open');
    assert.equal(stored.at(-1).ticketId, ticket.id);
});

test('failed writes and post-repair recurrence remain pending for a maintainer', async () => {
    for (const current of [ticket, { ...ticket, occurrences: 3 }]) {
        let saved;
        const result = await repair.recordRepair({ receipt, read: async () => current, save: value => { saved = value; },
            post: async () => { if (current.occurrences > 2) assert.fail('must not acknowledge a new recurrence'); throw new Error('HTTP 500'); } });
        assert.equal(result.writeback.state, 'pending');
        assert.equal(saved.writeback.state, 'pending');
    }
});
