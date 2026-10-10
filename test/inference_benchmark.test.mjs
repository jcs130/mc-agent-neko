import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { consumeSse, safeBaseUrl, summarize, resultMetadata, validateResponse, memoryFloorDecision } from '../scripts/lib/inference-benchmark.mjs';

test('opt-in memory floor stops new work at pressure or unknown readings, without changing the default', () => {
    const total = 64 * 2**30;
    assert.equal(memoryFloorDecision({ram_total:total,ram_used:total-100*2**20},0).stop,false);
    assert.equal(memoryFloorDecision({ram_total:total,ram_used:total-100*2**20},2560).stop,true);
    assert.equal(memoryFloorDecision({ram_total:total,ram_used:total-2560*2**20},2560).stop,false);
    assert.equal(memoryFloorDecision({ram_total:total,ram_used:total+1},2560).reason,'memory_unknown');
    assert.equal(memoryFloorDecision(null,2560).stop,true);
    assert.throws(()=>memoryFloorDecision(null,-1));
});

test('benchmark refuses non-loopback, credentials and URL decorations', () => {
    assert.equal(safeBaseUrl('http://127.0.0.1:18030/v1'), 'http://127.0.0.1:18030');
    for (const url of ['https://example.com', 'http://192.168.3.162:18030',
        'http://secret@localhost:18030', 'http://localhost:18030/?key=secret', 'http://localhost:18030/other']) {
        assert.throws(() => safeBaseUrl(url));
    }
});

test('SSE survives split UTF-8, empty and reasoning deltas without confusing first content', async () => {
    const events = ': keepalive\r\n\r\n' + [
        { choices: [{ delta: { content: '' } }] },
        { choices: [{ delta: { reasoning_content: '思考' } }] },
        { choices: [{ delta: { content: '中文' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10,
            prompt_tokens_details: { cached_tokens: 7 }, completion_tokens: 2 } },
    ].map(value => 'data: ' + JSON.stringify(value) + '\r\n\r\n').join('') + 'data: [DONE]\r\n\r\n';
    const bytes = new TextEncoder().encode(events);
    const response = new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
    } }));
    let clock = 0;
    const result = await consumeSse(response, () => ++clock);
    assert.equal(result.content, '中文');
    assert(result.firstReasoningAt < result.firstContentAt);
    assert.equal(result.usage.prompt_tokens, 10);
    assert.equal(result.finishReason, 'stop');
});

test('SSE rejects explicit errors and an interrupted stream', async () => {
    await assert.rejects(consumeSse(new Response('data: {"error":{"message":"private"}}\n\n')), /provider_error/);
    await assert.rejects(consumeSse(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')), /incomplete_stream/);
});

test('metadata is an allowlist and unknown cache counters stay unknown', () => {
    const record = resultMetadata({ id: 'r', type: 'execution', scenario: 'solo', round: 1,
        dispatchAt: 10, returnedAt: 20, validatedAt: 21, assembledMs: 2, quality: { ok: true },
        response: { content: 'private answer', reasoning: 'private thought',
            usage: { prompt_tokens: 20, completion_tokens: 2 }, finishReason: 'stop' },
        prompt: 'private prompt', apiKey: 'private key', error: 'private provider message' });
    assert.equal(record.new_input_tokens, null);
    assert.equal(record.reused_tokens, null);
    assert.equal(record.total_to_validated_ms, 13);
    assert.doesNotMatch(JSON.stringify(record), /private|apiKey|reasoning"|prompt"/);
    const bad = resultMetadata({ response: { usage: { prompt_tokens: 2,
        prompt_tokens_details: { cached_tokens: 5 } } } });
    assert.equal(bad.reused_tokens, null);
    assert.equal(record.error, 'request_failed');
});

test('quality rejects fast wrong/truncated commands and validates exact arguments', () => {
    const fixture = { type: 'execution', expected: '!craftRecipe', args: ['crafting_table', 1] };
    const parse = text => text === 'good' ? { commandName: '!craftRecipe', args: ['crafting_table', 1] }
        : text === 'stop' ? { commandName: '!stop', args: [] }
        : { commandName: '!craftRecipe', args: ['crafting_table', 99] };
    assert.equal(validateResponse(fixture, { content: 'good', finishReason: 'stop' }, parse).ok, true);
    for (const content of ['stop', 'wrong']) assert.equal(validateResponse(fixture, { content, finishReason: 'stop' }, parse).ok, false);
    assert.equal(validateResponse(fixture, { content: 'good', finishReason: 'length' }, parse).ok, false);
    assert.equal(validateResponse({ type: 'memory_summary', requiredIds: ['s1','s2'] },
        { content: '{"facts":[{"id":"s1"}]}', finishReason: 'stop' }).ok, false);
    assert.equal(validateResponse({ type: 'conversation' },
        { content: '现在先确认背包里的物资，再考虑下一步。!inventory', finishReason: 'stop' }).ok, false);
});

test('summaries retain failures and avoid p95 for fewer than twenty samples', () => {
    const rows = [100, 200, 300].map(ms => ({ phase: 'measured', scenario: 'solo', call_type: 'execution',
        quality_ok: true, total_to_validated_ms: ms, client_roundtrip_ms: ms, contaminated: false }));
    rows.push({ ...rows[0], quality_ok: false, client_roundtrip_ms: 1 });
    rows.push({ ...rows[0], contaminated:true,total_to_validated_ms:900 });
    const group = summarize(rows)[0];
    assert.equal(group.samples, 5);
    assert.equal(group.successful, 3);
    assert.equal(group.failed, 1);
    assert.equal(group.median_validated_ms, 200);
    assert.equal(group.median_including_traffic_ms, 250);
    assert.equal(group.contaminated, 1);
    assert.equal(group.p95_validated_ms, null);
});

test('synthetic commands validate against the native catalog without starting a bot', async () => {
    // The command module owns maintenance timers, so isolate its lifetime from node:test.
    const script = `
        import {createWorkload,validateResponse} from './scripts/lib/inference-benchmark.mjs';
        const w=await createWorkload();
        const replies=['!inventory','!stop','!goToCoordinates(12,64,8,1)',
            '!cannotComplete("保护区禁止破坏，当前任务无法执行")'];
        const good=replies.map((content,i)=>validateResponse(w.game(i),{content,finishReason:'stop'},w.parse).ok);
        const wrong=validateResponse(w.game(2),{content:'!goToCoordinates(12,64,8)',finishReason:'stop'},w.parse).ok;
        console.log(JSON.stringify({good,wrong,fixtureCount:w.fixtureCount}));
        process.exit(0);
    `;
    const { stdout } = await promisify(execFile)(process.execPath,['--input-type=module','-e',script],
        {cwd:fileURLToPath(new URL('../',import.meta.url)),timeout:15000});
    assert.deepEqual(JSON.parse(stdout),{good:[true,true,true,true],wrong:false,fixtureCount:4});
});
