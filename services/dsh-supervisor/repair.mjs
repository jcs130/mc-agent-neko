import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const phases = new Set(['prepared', 'deployed', 'verified', 'failed']);
const hash = content => createHash('sha256').update(content).digest('hex');

export function validateRepairReceipt(receipt) {
    if (receipt?.schemaVersion !== 1 || !/^[a-z0-9_-]{1,80}$/.test(receipt.id ?? '')
        || !/^T-\d+$/.test(receipt.ticketId ?? '')) throw new Error('Invalid repair/ticket id');
    if (!Number.isInteger(receipt.ticketOccurrences) || receipt.ticketOccurrences < 1
        || !phases.has(receipt.phase) || !/^[a-f0-9]{40}$/.test(receipt.commit ?? '')) throw new Error('Invalid repair state or commit');
    if (!Array.isArray(receipt.checks) || !receipt.checks.length || receipt.checks.some(check => !check.name
        || !Number.isInteger(check.exitCode) || !check.logPath || !/^[a-f0-9]{64}$/.test(check.sha256 ?? '')
        || receipt.phase !== 'failed' && check.exitCode !== 0)) throw new Error('Repair checks are missing or failed');
    if (['deployed', 'verified'].includes(receipt.phase) && (!Number.isFinite(receipt.deployment?.at)
        || !receipt.deployment.component || receipt.deployment.commit !== receipt.commit)) throw new Error('Missing or mismatched deployment');
    if (receipt.phase === 'verified' && (receipt.verification?.passed !== true
        || !Number.isFinite(receipt.verification.at) || receipt.verification.at < receipt.deployment.at
        || !receipt.verification.evidencePath || !/^[a-f0-9]{64}$/.test(receipt.verification.sha256 ?? ''))) {
        throw new Error('Missing successful runtime verification');
    }
    return receipt;
}

export function loadRepairReceipts(runtimeRoot) {
    const directory = path.join(runtimeRoot, 'repair-receipts');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(file => file.endsWith('.json')).flatMap(file => {
        try { return [validateRepairReceipt(JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')))]; }
        catch { return []; }
    });
}

export function buildRepairQueue(tickets, receipts, now = Date.now()) {
    const items = tickets.filter(ticket => !['closed', 'wontfix'].includes(ticket.status)).map(ticket => {
        const latest = receipts.filter(receipt => receipt.ticketId === ticket.id)
            .sort((a, b) => (b.recordedAt ?? 0) - (a.recordedAt ?? 0))[0] ?? null;
        const diagnosis = [...(ticket.history ?? [])].reverse().find(item => item.actor === 'dsh-diagnoser');
        let stage = diagnosis ? 'needs_repair_review' : 'needs_diagnosis';
        if (latest) {
            if (ticket.occurrences > latest.ticketOccurrences) stage = 'recurrence_after_repair';
            else if (latest.writeback?.state !== 'written') stage = 'handoff_pending';
            else stage = { prepared: 'awaiting_deployment', deployed: 'awaiting_runtime_verification',
                verified: 'verification_reported', failed: 'verification_failed' }[latest.phase];
        }
        return { ticketId: ticket.id, title: ticket.title, severity: ticket.severity, ticketStatus: ticket.status,
            occurrences: ticket.occurrences, ticketRevision: ticket.updatedAt, stage,
            lastDiagnosis: diagnosis ? { at: diagnosis.ts, hypothesis: String(diagnosis.note ?? '').slice(0, 500) } : null,
            repair: latest };
    });
    return { schemaVersion: 1, updatedAt: now, executor: 'existing-hourly-maintainer',
        automaticCodeExecution: false, automaticTicketClosure: false, items };
}

// This bridge records external maintenance facts. It never claims a ticket,
// changes its status or treats an LLM hypothesis as proof of a repair.
export async function recordRepair({ receipt, read, post, save }) {
    validateRepairReceipt(receipt);
    const result = { ...receipt, writeback: { state: 'pending' } };
    const proof = hash(JSON.stringify({ commit: receipt.commit, checks: receipt.checks,
        deployment: receipt.deployment, verification: receipt.verification })).slice(0, 12);
    const tag = `[repair:${receipt.id}:${receipt.phase}:${proof}]`;
    try {
        const ticket = await read(receipt.ticketId);
        if (ticket.id !== receipt.ticketId) throw new Error('Wrong ticket returned');
        if ((ticket.occurrences ?? 1) !== receipt.ticketOccurrences) throw new Error('Ticket recurrence baseline changed or is invalid; inspect again');
        const confirmed = value => value?.id === receipt.ticketId && typeof value.updatedAt === 'string'
            && value.history?.some(item => item.actor === 'hourly-maintainer' && item.note?.includes(tag));
        if (confirmed(ticket)) result.writeback = { state: 'written', updatedAt: ticket.updatedAt, duplicate: true };
        else {
            const phase = { prepared: '代码与检查已准备', deployed: '已部署，尚未证明游戏恢复',
                verified: '外部维护者已提交运行验证', failed: '修复/验证失败，仍需处理' }[receipt.phase];
            const response = await post(receipt.ticketId, { actor: 'hourly-maintainer', note:
                `${tag} ${phase}；commit=${receipt.commit.slice(0, 12)}；checks=${receipt.checks.map(check => `${check.name}:${check.exitCode}`).join(',')}；不自动关单。`.slice(0, 500) });
            if (!confirmed(response)) throw new Error('Repair writeback unconfirmed');
            result.writeback = { state: 'written', updatedAt: response.updatedAt };
        }
    } catch (error) { result.writeback.reason = error.message; }
    await save(result);
    return result;
}

async function cli() {
    const [inputPath, runtimePath, repoPath] = process.argv.slice(2);
    if (!inputPath || !runtimePath || !repoPath) throw new Error('Usage: node repair.mjs receipt.json runtime-root repository-root');
    const receipt = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const evidenceHash = file => {
        if (!path.isAbsolute(file ?? '')) throw new Error('Evidence file must use an absolute path');
        const content = fs.readFileSync(file); if (!content.length) throw new Error('Empty evidence file');
        return hash(content);
    };
    receipt.checks = (receipt.checks ?? []).map(check => ({ ...check, sha256: evidenceHash(check.logPath) }));
    if (receipt.verification?.evidencePath) receipt.verification.sha256 = evidenceHash(receipt.verification.evidencePath);
    receipt.recordedAt = Date.now(); validateRepairReceipt(receipt);
    const commit = spawnSync('git', ['-C', repoPath, 'cat-file', '-t', receipt.commit], { encoding: 'utf8', windowsHide: true });
    if (commit.status !== 0 || commit.stdout.trim() !== 'commit') throw new Error('Repair commit does not exist in the supplied repository');
    const directory = path.join(runtimePath, 'repair-receipts'); fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `${receipt.id}.json`);
    if (fs.existsSync(target)) {
        const old = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (old.ticketId !== receipt.ticketId || old.commit !== receipt.commit || old.ticketOccurrences !== receipt.ticketOccurrences) {
            throw new Error('Receipt id already belongs to another repair; use a new id');
        }
    }
    const api = async (route, body) => {
        const response = await fetch('http://127.0.0.1:48920/api/tickets/' + route, { redirect: 'error',
            signal: AbortSignal.timeout(5000), ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
        if (!response.ok) throw new Error(`Ticket API HTTP ${response.status}`);
        return response.json();
    };
    const result = await recordRepair({ receipt, read: id => api(id), post: (id, body) => api(id + '/comment', body),
        save: value => { const temporary = `${target}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, target); } });
    console.log(JSON.stringify({ ticketId: result.ticketId, receipt: target, writeback: result.writeback }));
    if (result.writeback.state !== 'written') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
