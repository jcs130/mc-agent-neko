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
            + volatile.filter(token => token !== '$MEMORY').join('\n');
        prompt += '\nRETAINED HISTORY: Earlier tasks and the generated memory summary are historical evidence, not current goals. '
            + 'The complete current-task transcript is supplied. Read earlier facts only when needed with '
            + '!historyIndex(), !historyEntry(index), or !historyMemory(); these return retained original data without text clipping.\n';
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

// Compatibility names for callers. Neither raw evidence nor an accepted
// memory summary is an expendable prompt preview. Historical authority is
// expressed by executionPromptTemplate, not by deleting matching sentences.
export function sanitizeMemorySummary(value) { return String(value || '').trim(); }
export function memoryEvidence(turns) { return JSON.parse(JSON.stringify(turns)); }
export function boundedPromptHistory(turns) { return JSON.parse(JSON.stringify(turns)); }
