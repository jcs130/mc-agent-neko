// Explicit opt-in. The response is validated offline and is NEVER executed.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { safeBaseUrl, consumeSse, validateResponse, resultMetadata, summarize, createWorkload } from './lib/inference-benchmark.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[i+1]]); return pairs;
}, []));
if (!args.label || !args.out) {
    console.error('Usage: node scripts/bench-local-inference.mjs --label NAME --out FILE --expect-slots N [--rounds 4] [--url http://127.0.0.1:18030]');
    process.exit(2);
}
const base = safeBaseUrl(args.url || 'http://127.0.0.1:18030');
const rounds = Number(args.rounds || 4), expectedSlots = Number(args['expect-slots'] || 1);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 30 || ![1,2,3,4].includes(expectedSlots)) throw Error('Invalid rounds or expected slots');
const json = async route => {
    const reply = await fetch(base + route, { signal:AbortSignal.timeout(5000) });
    if (!reply.ok) throw Error('metadata_http_' + reply.status);
    return reply.json();
};
const snapshot = async () => {
    const metrics = await json('/metrics'), status = await json('/v1/status');
    if (!status.loaded || status.concurrency.serving !== expectedSlots) throw Error('Model not ready or actual slot count differs');
    return { started:status.started, model:status.model, engine:status.engine, concurrency:status.concurrency,
        activity:status.activity, totalRequests:metrics.totals.requests,
        idle:metrics.live.state === 'idle' && !(metrics.live.queued || metrics.live.running),
        cache:metrics.conversation_cache,
        memory:{ram_used:metrics.hardware.ram_used,ram_total:metrics.hardware.ram_total,
            gpu_mem_used:metrics.hardware.gpu_mem_used,gpu_mem_total:metrics.hardware.gpu_mem_total},
        expert_slots:metrics.engine.expert_slots,expert_cache_mib:metrics.engine.expert_cache_mib };
};
const waitIdle = async () => {
    const until = Date.now() + 90000;
    while (Date.now() < until) { const state = await snapshot(); if(state.idle) return state; await delay(250); }
    throw Error('No idle boundary; benchmark refused to add work');
};
const workload = await createWorkload(), rows = [], groups = [];
const baseline = await waitIdle();
const destination = path.resolve(args.out);
const save = async () => {
    await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,JSON.stringify({schema:1,label:args.label,checkedAt:new Date().toISOString(),
        rounds,lead_ms:400,settings:{temperature:0,top_p:1,seed:1234,reasoning_effort:'none',explicit_prefix:false},
        baseline,groups,records:rows,summary:summarize(rows)},null,2)+'\n');
};
async function request(fixture, scenario, round, phase, generation) {
    const assemblyStart = performance.now();
    const body = JSON.stringify({model:baseline.model,temperature:0,top_p:1,seed:1234,stream:true,...fixture.body});
    const assembledMs = performance.now() - assemblyStart;
    const id = randomUUID(), dispatchAt = performance.now(), dispatchIso = new Date().toISOString();
    let response, error = null, quality;
    try {
        response = await consumeSse(await fetch(base+'/v1/chat/completions',{ method:'POST',
            headers:{'Content-Type':'application/json','X-Request-ID':id},body,signal:AbortSignal.timeout(120000) }));
    } catch (caught) { error = /^(http_\d+|provider_error|incomplete_stream)$/.test(caught.message) ? caught.message : 'request_failed'; }
    const returnedAt=performance.now(), returnedIso=new Date().toISOString();
    quality = response ? validateResponse(fixture,response,workload.parse) : {ok:false,reason:'request_failed'};
    return resultMetadata({id,type:fixture.type,fixture:fixture.name,scenario,round,phase,generation,
        assembledMs,dispatchAt,dispatchIso,returnedAt,returnedIso,validatedAt:performance.now(),response,error,quality});
}
async function runGroup(scenario, round, phase) {
    const before = await waitIdle();
    const peaks = { ram_used:before.memory.ram_used, gpu_mem_used:before.memory.gpu_mem_used, samples:0, errors:0 };
    let polling = false;
    let lastPoll = Promise.resolve();
    const sampler = setInterval(() => {
        if (polling) return;
        polling = true;
        lastPoll = json('/metrics').then(metrics => {
            peaks.samples++;
            for (const key of ['ram_used','gpu_mem_used']) {
                const value = metrics.hardware?.[key];
                if (Number.isFinite(value)) peaks[key] = Math.max(peaks[key] || 0,value);
            }
        }).catch(() => peaks.errors++).finally(() => { polling = false; });
    },500);
    const game = workload.game(round), bg = workload.background(round), chat = workload.dialogue(round);
    let results;
    try {
        if(scenario==='solo') results=[await request(game,scenario,round,phase,before.started)];
        else if(scenario==='alternating') results=[await request(bg,scenario,round,phase,before.started),await request(game,scenario,round,phase,before.started)];
        else {
            const first = scenario==='game_first' ? game : bg;
            const second = scenario==='game_first' ? bg : game;
            const pending=[request(first,scenario,round,phase,before.started)];
            await delay(400);
            pending.push(request(second,scenario,round,phase,before.started));
            if(scenario==='three_clients') { await delay(400); pending.push(request(chat,scenario,round,phase,before.started)); }
            results=await Promise.all(pending);
        }
    } finally { clearInterval(sampler); await lastPoll; }
    // Persist completed requests even if the engine disappears before the final boundary.
    for (const row of results) { row.contaminated=true; rows.push(row); }
    let after;
    try { after=await waitIdle(); }
    catch {
        groups.push({scenario,round,phase,before,after:null,peaks,contaminated:true,error:'idle_boundary_lost'});
        await save();
        throw Error('Final idle boundary lost; completed request metadata retained');
    }
    const contaminated=after.started!==before.started || after.totalRequests-before.totalRequests!==results.length;
    for(const row of results) row.contaminated=contaminated;
    groups.push({scenario,round,phase,before,after,peaks,contaminated});
    await save();
    console.log(JSON.stringify({label:args.label,scenario,round,phase,contaminated,
        results:results.map(row=>({type:row.call_type,ms:row.client_roundtrip_ms,quality:row.quality_ok,new:row.new_input_tokens,output:row.output_tokens}))}));
}
let exitCode=0;
try {
    await runGroup('alternating',0,'warmup');
    await runGroup('three_clients',0,'warmup');
    for(let round=0;round<rounds;round++) for(const scenario of ['solo','alternating','background_first','game_first','three_clients']) {
        await runGroup(scenario,round,'measured');
    }
    if(rows.some(row=>!row.quality_ok)) exitCode=1;
} catch(error) { console.error('Benchmark stopped:',error.message); exitCode=1; }
await save();
// The imported command catalog has maintenance timers. All requests and writes are complete.
process.exit(exitCode);
