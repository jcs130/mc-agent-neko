import { refreshEvidence, selectTicket, validateIssue } from './core.mjs';

const TASKS = {
    observer: '巡检。issues只列实际异常，待办或单次材料不足不是bug。scope=current只引用新鲜观测；scope=execution可引用30分钟内真实失败，明确过去发生的错误/重复失败，不得称角色现在卡死。正常挖矿/等待/长任务不能仅凭不移动判卡死。允许issues为空。',
    diagnoser: '优先解释选中工单和真实执行失败。区分事实与根因假设，给下一项可验证检查。历史失败不能证明当前仍卡死，没有源码证据不能断言某行有错。无问题就说明无需诊断，禁止造问题。repair记录是外部维护者提交的事实，不代表游戏验证已成功。',
    reviewer: '独立核对原始事实。只确认issues中充分支持的key。current必须有新鲜证据；execution仅确认原始时间内实际发生的异常，正常缺材料/任务未完成不是bug。不能按前一个Agent的说法认定异常。acceptedKeys填候选key，evidenceIds填支持证据id。证据不足拒绝，禁止依据repair记录自行宣布修复或关单。',
};

// runRole invokes prepare only AFTER admission to the local model. Keeping this
// orchestration independent of DSH permits deterministic slow-model/session tests.
export async function runAuditStages({ capture, runRole, tickets, ledger, now = Date.now }) {
    const selected = selectTicket(tickets, ledger);
    let sessionId, retained = [];
    const stages = [];
    const prepare = (role, extra = {}) => () => {
        const current = capture(selected);
        if (!current.fresh) throw new Error('No fresh game evidence after model admission');
        if (sessionId !== undefined && current.sessionId !== sessionId) throw new Error('Game session changed during audit');
        sessionId = current.sessionId;
        const evidence = refreshEvidence(current, retained, now());
        const active = selected ? [{ id: selected.id, title: selected.title, status: selected.status,
            createdAt: selected.createdAt, updatedAt: selected.updatedAt, claimedBy: selected.claimedBy,
            evidenceId: evidence.facts.find(f => f.kind === 'record' && f.value?.id === selected.id)?.id,
            detail: String(selected.detail ?? '').slice(0, 500) }] : [];
        stages.push({ role, capturedAt: evidence.capturedAt, observedAt: evidence.observedAt, sessionId });
        return { task: TASKS[role], evidence, tickets: active, ...extra };
    };
    const observer = await runRole('observer', prepare('observer'));
    const issues = (Array.isArray(observer.report.issues) ? observer.report.issues : [])
        .map(issue => validateIssue(issue, observer.evidence)).filter(Boolean).slice(0, 2);
    const retain = (evidence, ids) => {
        const wanted = new Set(ids);
        retained = [...new Map([...retained, ...evidence.facts.filter(f => wanted.has(f.id))].map(f => [f.id, f])).values()];
    };
    retain(observer.evidence, issues.flatMap(issue => issue.evidenceIds));
    const diagnoser = issues.length || selected || !ledger.baselineComplete
        ? await runRole('diagnoser', prepare('diagnoser', { issues })) : null;
    if (diagnoser) retain(diagnoser.evidence, diagnoser.report.evidenceIds ?? []);
    const reviewer = await runRole('reviewer', prepare('reviewer', { issues, diagnosis: diagnoser?.report ?? null }));
    return { selected, evidence: reviewer.evidence, observer, diagnoser, reviewer, issues, stages,
        executionRevision: observer.evidence.executionRevision };
}
