import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../services/dsh-supervisor/app.mjs';

test('a cloud audit completes while the local model is unreachable, with no fallback requests', { timeout: 5000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-dsh-cloud-'));
    const nativeRoot = path.join(root, 'native'), runtimeRoot = path.join(root, 'runtime');
    const supervisorDir = path.join(nativeRoot, 'bots/_supervisor');
    const wsRoot = path.join(nativeRoot, 'node_modules/ws');
    fs.mkdirSync(supervisorDir, { recursive: true });
    fs.mkdirSync(wsRoot, { recursive: true });
    fs.writeFileSync(path.join(nativeRoot, 'package.json'), '{}');
    fs.writeFileSync(path.join(supervisorDir, 'sentinel.json'), JSON.stringify({ ts: Date.now() }));
    fs.writeFileSync(path.join(wsRoot, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
    fs.writeFileSync(path.join(wsRoot, 'index.cjs'), `
        const { EventEmitter } = require('node:events');
        module.exports = class WebSocket extends EventEmitter {
            static OPEN = 1;
            constructor() { super(); this.readyState = 1; setImmediate(() => this.emit('open')); }
            send() { this.emit('message', JSON.stringify({ type: 'game_state', sessionId: 'test-game',
                observedAt: Date.now(), online: true, state: { self: { health: 20, food: 20 }, inventory: { counts: {} } } })); }
            close() { this.readyState = 3; this.emit('close'); }
        };
    `);
    const originalFetch = globalThis.fetch, originalOnce = process.env.NEKO_DSH_ONCE;
    const requests = [], roles = [];
    let finish, cleanup;
    const done = new Promise(resolve => { finish = resolve; });
    globalThis.fetch = async url => {
        requests.push(String(url));
        if (String(url).startsWith('http://127.0.0.1:18030')) throw new Error('Local model unreachable');
        if (String(url) === 'http://127.0.0.1:48920/health') return Response.json({ ok: true });
        if (String(url) === 'http://127.0.0.1:48920/api/tickets?status=open-ish') return Response.json([]);
        throw new Error('Unexpected request');
    };
    process.env.NEKO_DSH_ONCE = '1';
    const ctx = {
        agents: { create: async () => ({ agent: { id: 'test-parent', whenIdle: async () => {} }, dispose: async () => {} }) },
        subagents: { start: async (_kind, options) => {
            roles.push({ role: options.label, options: options.agentOptions });
            const structured = options.label === 'observer' ? { summary: '正常', issues: [] }
                : options.label === 'diagnoser' ? { summary: '无须修复', evidenceIds: [] }
                : { decision: 'reject', acceptedKeys: [], actionableKeys: [], evidenceIds: [], summary: '无新异常' };
            return { id: 'test-' + options.label, result: Promise.resolve({ stopReason: 'completed', structured }), dispose: async () => {} };
        } },
        on: (_event, handler) => { cleanup = handler; },
        get: name => name === 'appExit' ? finish : undefined,
    };
    try {
        apply(ctx, { runtimeRoot, nativeRoot });
        assert.equal(await done, 0);
        assert.deepEqual(roles.map(value => value.role), ['observer', 'diagnoser', 'reviewer']);
        assert.ok(roles.every(value => value.options.provider === 'neko-deepseek' && value.options.model === 'deepseek-flash'));
        assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:48920/')));
        const status = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'status.json'), 'utf8'));
        assert.equal(status.modelUrl, 'https://api.deepseek.com/v1');
        assert.equal(status.gameCommandsSent, 0);
        assert.equal(status.codeDeployments, 0);
    } finally {
        await cleanup?.();
        globalThis.fetch = originalFetch;
        if (originalOnce === undefined) delete process.env.NEKO_DSH_ONCE;
        else process.env.NEKO_DSH_ONCE = originalOnce;
        assert.ok(path.isAbsolute(root) && path.dirname(root) === path.resolve(os.tmpdir())
            && path.basename(root).startsWith('neko-dsh-cloud-'), 'recursive cleanup must stay in the exact temporary fixture');
        fs.rmSync(root, { recursive: true, force: true });
    }
});
