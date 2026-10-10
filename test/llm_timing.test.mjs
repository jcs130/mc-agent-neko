import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestTrace, createRequestTrace } from '../src/utils/llm_timing.js';

function fixture(agent = {}) {
    let time = 0;
    const records = [];
    const trace = new RequestTrace(agent, 'execution', {
        now: () => time, wall: () => 1700000000000,
        sink: record => records.push(record),
    });
    return { trace, records, at: ms => { time = ms; } };
}

test('client stages include preparation and validation without inventing first-content or queue timing', () => {
    const f = fixture();
    f.at(100); f.trace.mark('assembly_start');
    f.at(120); f.trace.mark('assembled');
    f.trace.dispatch();
    f.at(620); f.trace.returned({ prompt_tokens: 1000, completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 800 } }, 'stop');
    f.at(635); f.trace.mark('command_validated'); f.trace.finish('command_ready');
    const record = f.records.at(-1);
    assert.equal(record.prepare_wait_ms, 100);
    assert.equal(record.prompt_assembly_ms, 20);
    assert.equal(record.sdk_roundtrip_ms, 500);
    assert.equal(record.return_to_command_ms, 15);
    assert.equal(record.total_to_command_ms, 635);
    assert.equal(record.first_effective_content_at, null);
    assert.equal(record.server_queue_ms, null);
    assert.equal(record.unattributed_dispatch_ms, 500);
    assert.deepEqual([record.input_tokens, record.reused_tokens, record.new_input_tokens, record.output_tokens], [1000, 800, 200, 20]);
});

test('metadata schema ignores arbitrary text, response objects and invalid usage counts', () => {
    const f = fixture({ adminMission: { _epoch: 4, mission: { text: 'PRIVATE_TASK', taskId: 'PRIVATE_ID' } } });
    f.trace.mark('PRIVATE_STAGE'); f.trace.dispatch();
    f.trace.returned({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 100 },
        response: 'PRIVATE_RESPONSE', api_key: 'PRIVATE_KEY' }, 'PRIVATE_FINISH');
    f.trace.finish('PRIVATE_OUTCOME');
    const wire = JSON.stringify(f.records);
    assert(!wire.includes('PRIVATE'));
    assert.equal(f.records.at(-1).reused_tokens, null);
    assert.equal(f.records.at(-1).new_input_tokens, null);
    assert.equal(f.records.at(-1).output_tokens, null);
});

test('concurrent traces, retries and task generations stay distinct without task text', () => {
    const agent = { adminMission: { _epoch: 1, mission: { taskId: 'A' } } };
    const a = fixture(agent), b = fixture(agent);
    assert.notEqual(a.trace.requestId, b.trace.requestId);
    assert.equal(a.trace.taskVersion, b.trace.taskVersion);
    a.trace.dispatch(); a.trace.returned({}, 'length'); a.trace.dispatch(); a.trace.returned({}, 'stop');
    a.trace.finish('response_returned');
    assert.equal(a.records.at(-1).attempt, 2);
    const sends = a.records.filter(r => r.event === 'dispatch');
    assert.notEqual(sends[0].attempt_id, sends[1].attempt_id);
    agent.adminMission._epoch++;
    const c = fixture(agent);
    assert(c.trace.taskVersion > a.trace.taskVersion);
    assert.equal(c.records[0]?.task_id, undefined);
});

test('logger failure is isolated and terminal events are emitted only once', () => {
    const broken = new RequestTrace({}, 'execution', { sink: () => { throw new Error('disk unavailable'); } });
    assert.doesNotThrow(() => { broken.dispatch(); broken.returned({}, 'stop'); broken.finish('command_ready'); });
    const f = fixture(); f.trace.finish('stale'); f.trace.finish('command_ready');
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0].outcome, 'stale');
});

test('production timing is opt-in independently of general telemetry', () => {
    const previous = process.env.MC_LLM_TIMING;
    try { delete process.env.MC_LLM_TIMING; assert.equal(createRequestTrace({}, 'execution'), null); }
    finally { if (previous === undefined) delete process.env.MC_LLM_TIMING; else process.env.MC_LLM_TIMING = previous; }
});
