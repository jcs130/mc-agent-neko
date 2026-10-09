// One real, read-only DSH audit. Capture only wire metadata, never credentials or prompt contents.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MODEL, writeProfile } from './core.mjs';

const nativeRoot = path.resolve(process.argv[2] ?? '../mc-agent-neko');
const runtimeRoot = path.resolve(process.argv[3] ?? '../runtime/dsh-verification');
const home = path.join(runtimeRoot, 'dsh-home');
const dshBin = process.env.NEKO_DSH_BIN ?? path.join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/lib/bin.js');
writeProfile(home, nativeRoot, runtimeRoot);
const wire = [];
const proxy = http.createServer(async (req, res) => {
    try {
        if (!['/v1/chat/completions', '/v1/models'].includes(req.url)) { res.writeHead(404); res.end(); return; }
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1000000) throw new Error('Oversized request'); }
        if (req.method === 'POST') {
            const value = JSON.parse(body);
            wire.push({ at: Date.now(), model: value.model, maxTokens: value.max_tokens,
                enableThinking: value.chat_template_kwargs?.enable_thinking, messageCount: value.messages?.length,
                upstream: 'http://127.0.0.1:18030/v1/chat/completions', reasoningDeltas: 0 });
        }
        const row = wire.at(-1);
        const response = await fetch('http://127.0.0.1:18030' + req.url, { method: req.method,
            headers: { 'Content-Type': 'application/json' }, ...(body ? { body } : {}), signal: AbortSignal.timeout(120000) });
        if (row) row.status = response.status;
        res.writeHead(response.status, { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' });
        // Consume complete SSE records so a delta split across network chunks is still counted.
        let pending = '';
        const stream = Readable.fromWeb(response.body);
        stream.on('data', chunk => {
            pending += chunk.toString();
            const lines = pending.split('\n'); pending = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                try { const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta;
                    if (row && delta?.reasoning_content) row.reasoningDeltas++; } catch { /* non-JSON SSE */ }
            }
        });
        stream.pipe(res);
    } catch (error) { if (!res.headersSent) res.writeHead(502); res.end(error.message); }
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const configPath = path.join(home, 'profiles/neko-supervisor/cordis.patch.yml');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.find(row => row.insert).insert.find(row => row.id === 'llm-pi-ai').config.providers['neko-local'].baseURL =
    `http://127.0.0.1:${proxy.address().port}/v1`;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const log = fs.createWriteStream(path.join(runtimeRoot, 'verification.log'));
const child = spawn(process.execPath, [dshBin, '--profile', 'neko-supervisor'], { cwd: nativeRoot,
    windowsHide: true, env: { ...process.env, DSH_HOME: home, NEKO_DSH_ONCE: '1', NEKO_DSH_LOCAL_KEY: 'local-no-auth' },
    stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
const timeout = setTimeout(() => child.kill(), 180000);
const exitCode = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
clearTimeout(timeout); log.end(); await new Promise(resolve => proxy.close(resolve));
const status = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'status.json'), 'utf8'));
const appPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app.mjs');
const passed = exitCode === 0 && wire.length >= 2 && wire.every(row => row.enableThinking === false
    && row.model === MODEL && row.maxTokens <= 512 && row.status === 200 && row.reasoningDeltas === 0)
    && status.roleRuns.observer >= 1 && status.roleRuns.reviewer >= 1 && status.gameCommandsSent === 0;
const proof = { passed, exitCode, at: Date.now(), appSha256: createHash('sha256').update(fs.readFileSync(appPath)).digest('hex'), wire, status };
fs.writeFileSync(path.join(runtimeRoot, 'e2e-proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ passed, exitCode, calls: wire.length, roleRuns: status.roleRuns,
    noThinking: wire.every(row => row.enableThinking === false && row.reasoningDeltas === 0), proof: path.join(runtimeRoot, 'e2e-proof.json') }));
process.exitCode = passed ? 0 : 1;
