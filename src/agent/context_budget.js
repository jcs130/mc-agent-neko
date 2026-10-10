/* global process */
// Prompt projection only. Original observations remain in History and its archive.
export function externalMission(agent) {
    if (!agent?.adminMission?.isActive?.()) return null;
    const mission = agent.adminMission.mission;
    return mission && (mission.origin === 'ws' || agent.hasExternalAutonomyOwner?.()) ? mission : null;
}

export function executionPromptTemplate(template, agent, fixedContract = '') {
    let prompt = String(template);
    const mission = externalMission(agent);
    if (!mission && !fixedContract && process.env.MC_SELF_PROMPT_TAIL === '1') prompt = ordinaryGoalAfterDocs(prompt);
    const status = ['$STATS', '$INVENTORY'].filter(token => prompt.includes(token));
    for (const token of status) prompt = prompt.replaceAll(token, '');
    prompt = prompt.replace(/## Current Status\s*(?=##|$)/g, '');
    if (mission) {
        prompt = prompt.replaceAll('$EXAMPLES', '').replaceAll('$SELF_PROMPT', '');
        const volatile = ['$MEMORY', '$CODE_DOCS', '$ACTION', '$CONVO', '$LAST_GOALS', '$BLUEPRINTS']
            .filter(token => prompt.includes(token));
        for (const token of volatile) prompt = prompt.replaceAll(token, '');
        prompt += fixedContract + '\n\nDYNAMIC EXECUTION CONTEXT — historical evidence is not current authority:\n'
            + volatile.join('\n');
        prompt += '\n\nCURRENT TASK — native controller authority:\n'
            + `taskId: ${mission.taskId || '(unassigned)'}\ngoal: ${mission.text}\n`
            + 'Only this task is active. Goals, actions, positions and vitals in historical memory or earlier turns are not current instructions or current state.\n';
        prompt += agent.adminMission.progressEvidence?.(mission) || '';
    }
    if (status.length) prompt += '\nFRESH OBSERVED STATE — prefer these live query results over historical memory; missing data is unknown:\n'
        + status.join('\n');
    if (!mission) prompt += fixedContract;
    return prompt;
}

function ordinaryGoalAfterDocs(prompt) {
    const goals = prompt.match(/\$SELF_PROMPT/g) || [];
    const docs = prompt.lastIndexOf('$COMMAND_DOCS');
    if (!goals.length || docs < 0) return prompt;
    const tokens = ['$MEMORY', '$CODE_DOCS', '$ACTION', '$CONVO', '$LAST_GOALS', '$BLUEPRINTS', '$EXAMPLES'];
    const positions = tokens.map(token => prompt.indexOf(token)).filter(index => index >= 0);
    const firstDynamic = positions.length ? Math.min(...positions) : prompt.length;
    // Moving only the goal cannot repair a template that puts dynamic memory
    // before its docs. Leave such templates unchanged for a separate experiment.
    if (firstDynamic < docs) return prompt;
    let at = firstDynamic;
    const heading = prompt.slice(0, at).match(/(?:^|\n)(?:#{1,6} [^\n]*|Memory Summary)[ \t]*\r?\n$/);
    if (heading) at = heading.index + Number(heading[0].startsWith('\n'));
    const left = prompt.slice(0, at).replaceAll('$SELF_PROMPT', '');
    const right = prompt.slice(at).replaceAll('$SELF_PROMPT', '');
    return left + '$SELF_PROMPT'.repeat(goals.length) + right;
}

export function executionPromptHistory(turns, agent) {
    if (!externalMission(agent)) return turns;
    const nativeLoopTurn = turn => turn?.role === 'system'
        && turn.content.startsWith('You are self-prompting with the goal:');
    // Older reminders duplicate the authoritative task pinned above. The newest
    // trigger still starts a NEW execution turn: dropping it after a prose reply
    // leaves the request ending in that assistant plan, encouraging repetition.
    const projected = turns.filter(turn => !nativeLoopTurn(turn));
    if (nativeLoopTurn(turns.at(-1))) projected.push({ role: 'system', content:
        'EXECUTION TURN: Continue only the CURRENT TASK above. Reply with the next documented !commandName(parameters), '
        + 'or !endGoal only after verified success, or !cannotComplete("reason") with actual blocking evidence. '
        + 'A prose plan is not an executed action. Do not repeat prior narration.' });
    return projected;
}

export function sanitizeMemorySummary(value) {
    return String(value || '').split(/(?<=[.!?。！？])\s+|\n+/).map(part => part.trim()).filter(part => part
        && !/^(?:(?:current\s+)?(?:status|goal|task|action|position|location)\s*:|(?:HP|health|food|hunger)\s*[:=]?\s*\d|At\s*\(\s*-?\d|(?:当前)?(?:状态|目标|任务|行动|位置|坐标|生命值|饱食度|饥饿值)\s*[:：])/i.test(part))
        .join(' ').slice(0, 500);
}

export function memoryEvidence(turns) {
    const evidence = turns.filter(turn => !(turn.role === 'system' && (
        turn.content.startsWith('You are self-prompting with the goal:')
        || /^(?:\s*STATS\b|\s*INVENTORY\b|\s*\*COMMAND DOCS\b)/.test(turn.content)
    )));
    // Normal batches are already bounded by History. An oversized individual
    // observation gets an explicit head/tail projection; its full raw text
    // remains archived even after this partial summary commits.
    if (evidence.length === 1 && evidence[0].content.length > 8000) {
        const notice = { role: 'system', content: 'MEMORY INPUT LIMIT: oversized observation partly omitted. Full original remains archived. Missing text is unknown, not evidence of absence.' };
        return [notice, projectTurn(evidence[0], 8000 - notice.content.length)];
    }
    return evidence;
}

export function boundedPromptHistory(turns, maxChars = 12000, maxTurns = 32) {
    const notice = { role: 'system', content: 'CONTEXT LIMIT: older or oversized raw turns omitted; this projection is incomplete. Full evidence remains in pending memory and the archive. Prefer the current task and fresh state.' };
    const limit = Math.max(0, maxChars - notice.content.length);
    const selected = [];
    let chars = 0, index = turns.length - 1, clipped = false;
    while (index >= 0 && selected.length < maxTurns - 1) {
        const end = index;
        // Keep an action invocation with its following result when it fits.
        if (turns[index].role === 'system' && index > 0 && turns[index - 1].role === 'assistant') index--;
        const group = turns.slice(index, end + 1);
        const size = group.reduce((sum, turn) => sum + turn.content.length, 0);
        if (chars + size > limit || selected.length + group.length > maxTurns - 1) {
            if (selected.length) break;
            // A long assistant monologue must not consume the newest action
            // result. Give its invocation at most 1000 characters, then devote
            // the remaining budget to the measured result (including its tail).
            const invocationBudget = group.length === 2 ? Math.min(1000, limit) : limit;
            const invocation = projectTurn(group[0], invocationBudget);
            selected.push(invocation);
            if (group.length === 2) selected.push(projectTurn(group[1], limit - invocation.content.length));
            clipped = true; index--; break;
        }
        selected.unshift(...group); chars += size; index--;
    }
    const result = index >= 0 || clipped ? [notice, ...selected] : selected;
    return JSON.parse(JSON.stringify(result));
}

function projectTurn(turn, budget) {
    if (turn.content.length <= budget) return { ...turn };
    const marker = ' [PROMPT PROJECTION OMITTED MIDDLE] ';
    if (budget <= marker.length) return { ...turn, content: turn.content.slice(0, Math.max(0, budget)) };
    const head = Math.ceil((budget - marker.length) / 2), tail = budget - marker.length - head;
    return { ...turn, content: turn.content.slice(0, head) + marker + (tail ? turn.content.slice(-tail) : '') };
}
