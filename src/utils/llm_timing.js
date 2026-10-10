/* global process */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { appendTelemetry } from './telemetry.js';

const versions = new WeakMap();
const types = new Set(['execution', 'conversation', 'code_execution', 'memory_summary', 'conversation_gate', 'goal_selection', 'task_dedup', 'body_arbitration']);
const outcomes = new Set(['command_ready', 'command_rejected', 'invalid_command', 'conversation', 'response_returned', 'empty', 'stale', 'superseded', 'provider_error', 'error']);
const finishes = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'function_call']);
const stages = new Set(['assembly_start', 'assembled', 'command_validated']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function versionOf(agent) {
    if (!agent || typeof agent !== 'object') return { version: null, epoch: null };
    const epoch = count(agent.adminMission?._epoch);
    // Used only in memory to detect changes. Never written to diagnostics.
    const key = JSON.stringify([epoch, agent.adminMission?.mission?.taskId,
        agent.adminMission?.isActive?.(), agent.self_prompter?.prompt]);
    const previous = versions.get(agent);
    const version = previous ? previous.version + Number(previous.key !== key) : 1;
    versions.set(agent, { key, version });
    return { version, epoch };
}

export class RequestTrace {
    constructor(agent, type, { now = () => performance.now(), wall = () => Date.now(),
        sink = record => appendTelemetry('llm_timing.jsonl', record) } = {}) {
        this.now = now; this.sink = sink;
        this.start = now(); this.wall = wall(); this.points = {};
        this.requestId = randomUUID(); this.attempt = 0;
        const task = versionOf(agent);
        this.taskVersion = task.version; this.taskEpoch = task.epoch;
        this.type = types.has(type) ? type : 'other';
        this.mode = agent?.adminMission?.isActive?.() && (agent.adminMission.mission?.origin === 'ws' || agent.hasExternalAutonomyOwner?.())
            ? 'external_task' : agent?.self_prompter?.isActive?.() ? 'native_autonomy' : 'dialogue';
        this.closed = false; this.usage = {};
    }

    mark(stage) {
        if (!this.closed && stages.has(stage) && this.points[stage] === undefined) this.points[stage] = this.now();
    }

    dispatch() {
        if (this.closed) return;
        this.attempt++; this.attemptId = randomUUID();
        this.points.dispatch = this.now(); delete this.points.returned;
        this.usage = {}; this.finishReason = null;
        this.emit('dispatch');
    }

    returned(usage = {}, finishReason) {
        if (this.closed) return;
        this.points.returned = this.now();
        const input = count(usage?.prompt_tokens ?? usage?.input_tokens);
        const cached = count(usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens);
        const reused = input !== null && cached !== null && cached <= input ? cached : null;
        this.usage = { input_tokens: input, reused_tokens: reused,
            new_input_tokens: reused === null ? null : input - reused,
            output_tokens: count(usage?.completion_tokens ?? usage?.output_tokens) };
        this.finishReason = finishes.has(finishReason) ? finishReason : null;
        this.emit('returned');
    }

    failed(error) {
        this.httpStatus = count(error?.status);
        this.finish('provider_error');
    }

    finish(outcome) {
        if (this.closed) return;
        this.closed = true;
        this.emit('finished', outcomes.has(outcome) ? outcome : 'error');
    }

    emit(event, outcome = null) {
        const diff = (a, b) => a === undefined || b === undefined ? null : Math.round(Math.max(0, a - b) * 100) / 100;
        const iso = point => point === undefined ? null : new Date(this.wall + point - this.start).toISOString();
        const p = this.points;
        const roundtrip = diff(p.returned, p.dispatch);
        // Explicit schema: never spread caller metadata, provider objects or errors.
        const record = {
            schema: 1, event, outcome, request_id: this.requestId, attempt_id: this.attemptId || null,
            attempt: this.attempt, task_version: this.taskVersion, task_epoch: this.taskEpoch,
            call_type: this.type, execution_mode: this.mode, response_mode: 'non_stream', send_boundary: 'sdk_call', sdk_retry_visibility: 'unknown',
            started_at: iso(this.start), sdk_dispatch_at: iso(p.dispatch), completed_at: iso(p.returned),
            command_validated_at: iso(p.command_validated), first_effective_content_at: null,
            client_elapsed_ms: diff(this.now(), this.start), prepare_wait_ms: diff(p.assembly_start, this.start),
            prompt_assembly_ms: diff(p.assembled, p.assembly_start), sdk_format_ms: this.attempt > 1 ? null : diff(p.dispatch, p.assembled),
            sdk_roundtrip_ms: roundtrip, return_to_command_ms: diff(p.command_validated, p.returned),
            total_to_command_ms: diff(p.command_validated, this.start),
            server_queue_ms: null, server_input_ms: null, server_output_ms: null,
            // Includes provider processing, transport, SDK retries and FIFO wait;
            // no per-request server breakdown is supplied by this API.
            unattributed_dispatch_ms: roundtrip, finish_reason: this.finishReason || null,
            http_status: this.httpStatus || null,
            input_tokens: this.usage.input_tokens ?? null, reused_tokens: this.usage.reused_tokens ?? null,
            new_input_tokens: this.usage.new_input_tokens ?? null, output_tokens: this.usage.output_tokens ?? null,
        };
        try { this.sink(record); } catch { /* Diagnostics cannot fail inference. */ }
    }
}

export function createRequestTrace(agent, type) {
    try { return process.env.MC_LLM_TIMING === '1' ? new RequestTrace(agent, type) : null; }
    catch { return null; }
}
