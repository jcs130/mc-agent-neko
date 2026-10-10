// Opt-in diagnostics only. No engine settings, game execution or raw-content logging.
export function safeBaseUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash || !['/', '/v1', '/v1/'].includes(url.pathname)) {
        throw new Error('Benchmark requires an undecorated HTTP loopback endpoint');
    }
    return url.origin;
}

export function memoryFloorDecision(memory, minFreeMib = 0) {
    if (!Number.isSafeInteger(minFreeMib) || minFreeMib < 0) throw Error('Invalid memory floor');
    const valid = Number.isSafeInteger(memory?.ram_total) && memory.ram_total > 0
        && Number.isSafeInteger(memory?.ram_used) && memory.ram_used >= 0 && memory.ram_used <= memory.ram_total;
    const availableMib = valid ? (memory.ram_total - memory.ram_used) / 1048576 : null;
    const reason = minFreeMib === 0 ? 'disabled' : !valid ? 'memory_unknown'
        : availableMib < minFreeMib ? 'below_floor' : 'ok';
    return { stop:['memory_unknown','below_floor'].includes(reason), reason, available_mib:availableMib, min_free_mib:minFreeMib };
}

export async function consumeSse(response, now = () => performance.now()) {
    if (!response.ok) throw new Error('http_' + response.status);
    const decoder = new TextDecoder();
    let buffer = '', content = '', done = false, firstContentAt = null, firstReasoningAt = null;
    let usage = {}, finishReason = null, timings = null;
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            if (data === '[DONE]') { done = true; continue; }
            const item = JSON.parse(data);
            if (item.error) throw new Error('provider_error');
            const choice = item.choices?.[0];
            const delta = choice?.delta || {};
            if (delta.reasoning_content && firstReasoningAt === null) firstReasoningAt = now();
            if (delta.content) { if (firstContentAt === null) firstContentAt = now(); content += delta.content; }
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (item.usage) usage = item.usage;
            if (item.timings) timings = item.timings;
        }
    }
    if (!done || !finishReason) throw new Error('incomplete_stream');
    return { content, usage, finishReason, firstContentAt, firstReasoningAt, timings };
}

export function validateResponse(fixture, response, parse) {
    if (response.finishReason !== 'stop') return { ok: false, reason: 'not_complete' };
    try {
        if (fixture.type === 'execution') {
            const command = parse(response.content);
            const selected = command?.commandName;
            const rightName = selected === fixture.expected;
            const rightArgs = fixture.args === null ? command?.args?.some(value => typeof value === 'string' && value.length > 2)
                : JSON.stringify(command?.args) === JSON.stringify(fixture.args);
            return { ok: rightName && rightArgs, reason: rightName && rightArgs ? 'accepted' : 'wrong_command_or_args' };
        }
        if (fixture.type === 'memory_summary') {
            const clean = response.content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
            const parsed = JSON.parse(clean);
            const ids = new Set(parsed.facts?.map(fact => fact.id));
            return { ok: fixture.requiredIds.every(id => ids.has(id)), reason: 'required_evidence_ids' };
        }
        const ok = /\p{Script=Han}/u.test(response.content) && response.content.length >= 15
            && !/![A-Za-z]\w*/.test(response.content);
        return { ok, reason: 'chinese_dialogue_without_actions' };
    } catch { return { ok: false, reason: 'parse_failed' }; }
}

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
const difference = (a, b) => a == null || b == null ? null : Math.round(Math.max(0, a - b) * 100) / 100;
export function resultMetadata(input) {
    const r = input.response || {}, u = r.usage || {}, t = r.timings || {};
    const prompt = count(u.prompt_tokens), cached = count(u.prompt_tokens_details?.cached_tokens);
    const reused = prompt !== null && cached !== null && cached <= prompt ? cached : null;
    return { schema: 1, request_id: input.id, call_type: input.type, scenario: input.scenario,
        round: input.round, phase: input.phase, fixture: input.fixture, generation: input.generation,
        request_serialization_ms: finite(input.assembledMs),
        dispatch_at: input.dispatchIso, returned_at: input.returnedIso,
        first_content_ms: difference(r.firstContentAt, input.dispatchAt),
        first_reasoning_ms: difference(r.firstReasoningAt, input.dispatchAt),
        client_roundtrip_ms: difference(input.returnedAt, input.dispatchAt),
        total_to_validated_ms: input.quality?.ok ? difference(input.validatedAt, input.dispatchAt - (input.assembledMs || 0)) : null,
        return_to_validated_ms: difference(input.validatedAt, input.returnedAt),
        server_queue_ms: null, unattributed_wait_ms: null,
        server_prompt_ms: finite(t.prompt_ms), server_decode_ms: finite(t.predicted_ms),
        input_tokens: prompt, reused_tokens: reused, new_input_tokens: reused === null ? null : prompt - reused,
        output_tokens: count(u.completion_tokens), finish_reason: r.finishReason || null,
        quality_ok: input.quality?.ok === true, quality_reason: input.quality?.reason || 'request_failed',
        error: input.error ? (/^(http_\d+|provider_error|incomplete_stream|request_failed)$/.test(input.error)
            ? input.error : 'request_failed') : null, contaminated: input.contaminated === true };
}

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const n = sorted.length, mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function summarize(records) {
    const groups = new Map();
    for (const row of records.filter(row => row.phase === 'measured')) {
        const key = row.scenario + '/' + row.call_type;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    return [...groups].map(([group, rows]) => {
        const valid = rows.filter(row => row.quality_ok);
        const good = rows.filter(row => row.quality_ok && !row.contaminated);
        const times = good.map(row => row.total_to_validated_ms).filter(Number.isFinite).sort((a,b) => a-b);
        return { group, samples: rows.length, successful: good.length,
            failed: rows.filter(row => !row.quality_ok).length, contaminated: rows.filter(row => row.contaminated).length,
            median_validated_ms: median(times), min_validated_ms: times[0] ?? null, max_validated_ms: times.at(-1) ?? null,
            p95_validated_ms: times.length >= 20 ? times[Math.ceil(times.length * .95) - 1] : null,
            median_including_traffic_ms: median(valid.map(row => row.total_to_validated_ms)),
            median_first_content_ms: median(good.map(row => row.first_content_ms)),
            median_new_input_tokens: median(good.map(row => row.new_input_tokens)),
            median_output_tokens: median(good.map(row => row.output_tokens)) };
    });
}

export async function createWorkload() {
    const { setSettings } = await import('../../src/agent/settings.js');
    setSettings({ minecraft_version: '1.20.6', blocked_actions: ['!newAction'], allow_insecure_coding: false });
    const { getCommandDocs, parseCommandMessage } = await import('../../src/agent/commands/index.js');
    const agent = { blocked_actions: ['!newAction'] };
    const system = 'You are an offline Minecraft execution benchmark. Use only the current synthetic observations. '
        + 'Produce exactly one appropriate executable command with complete positional arguments, without narration. '
        + 'Do not claim completion before observing results. Respect protection and report an impossible task. '
        + 'If asked to stop, stop immediately. No command is executed in this benchmark.\n' + getCommandDocs(agent);
    const tasks = [
        { name: 'inventory', expected: '!inventory', args: [], text: '生命20，饥饿20，安全；当前背包尚未读取。任务：先查询准确背包，不要移动或推测物品。' },
        { name: 'stop', expected: '!stop', args: [], text: '任务：立即停止当前活动。不要改成新目标，不要声称任务已完成。' },
        { name: 'move', expected: '!goToCoordinates', args: [12,64,8,1], text: '生命20，饥饿20，安全；已观察到平地道路，无保护障碍，无需破坏。任务：用原生坐标导航命令前往x=12,y=64,z=8，接近半径1格。不要查询或换成其他动作。' },
        { name: 'failure', expected: '!cannotComplete', args: null, text: '服务器刚明确拒绝采矿：此区域禁止破坏。任务只允许在此区挖铁，不准移动、求助或替换目标，当前无铁。报告无法完成及保护原因，不要再次挖掘。' },
    ];
    const facts = Array.from({length:12}, (_,i) => ({ id: 's' + (i+1), fact:
        `第${i+1}段只确认观察与工具结果，保护拒绝仍未解除；背包内容尚待重新读取，不能声称完成采矿，下一轮需要核对窗口和权限。` }));
    return { parse: parseCommandMessage, fixtureCount:tasks.length,
        game: round => { const task = tasks[round % tasks.length]; return { type:'execution', ...task,
            body: { messages:[{role:'system',content:system},{role:'user',content: task.text + '\n观测版本：' + round}],
                max_tokens:256, reasoning_effort:'none' } }; },
        background: round => ({ type:'memory_summary', name:'evidence-summary', requiredIds:facts.map(f=>f.id),
            body: { messages:[{role:'system',content:'Summarize only observed facts. Return a JSON object with a facts array; retain every supplied id and its unresolved prerequisite. Do not send chat or game actions.'},
                {role:'user',content:JSON.stringify({revision:round,facts})+'\n每个ID保留一条具体中文事实，至少30字，不能省略未解决条件。只输出JSON。'}],
                max_tokens:1024, reasoning_effort:'none', strata_checkpoint:false } }),
        dialogue: round => ({ type:'conversation', name:'chinese-dialogue', body:{
            messages:[{role:'system',content:'You are a synthetic Chinese game companion. Explain observations briefly; do not invent game results or emit executable commands.'},
                {role:'user',content:`观测版本${round}：还没读取背包，不知道能不能合成。用两句中文向观众解释为何要先确认物资；不要假装已经合成或执行任何指令。`}],
            max_tokens:160, reasoning_effort:'none', strata_checkpoint:false } }),
    };
}
