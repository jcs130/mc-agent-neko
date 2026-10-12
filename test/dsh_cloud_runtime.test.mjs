import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../services/dsh-supervisor/app.mjs';
import { peekMaintenance, claimMaintenance } from '../services/dsh-supervisor/maintenance.mjs';

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
        if (String(url) === 'http://127.0.0.1:48920/api/tickets') return Response.json([]);
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
        assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:48920/') ||
            url === 'http://127.0.0.1:48916/security/csrf-token'));
        assert.equal(requests.filter(url => url.startsWith('http://127.0.0.1:18030')).length, 0);
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

test('the production coordinator delivers a reviewed failure to a claimable durable queue', { timeout: 5000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-dsh-handoff-'));
    const nativeRoot = path.join(root, 'native'), runtimeRoot = path.join(root, 'runtime');
    const supervisorDir = path.join(nativeRoot, 'bots/_supervisor'), wsRoot = path.join(nativeRoot, 'node_modules/ws');
    fs.mkdirSync(supervisorDir, { recursive: true }); fs.mkdirSync(wsRoot, { recursive: true });
    fs.writeFileSync(path.join(root, 'unattended-state.json'), JSON.stringify({ enabled: true }));
    fs.writeFileSync(path.join(nativeRoot, 'package.json'), '{}');
    fs.writeFileSync(path.join(supervisorDir, 'sentinel.json'), JSON.stringify({ ts: Date.now() }));
    const event = { type: 'task_finished', status: 'failed', task_id: 'actual-task',
        message: '!moveBackpackItem:\nAction failed: !moveBackpackItem did not complete successfully.\nBackpack changed or unverified.' };
    fs.writeFileSync(path.join(supervisorDir, 'events.log'), `[${new Date().toISOString()}] ${JSON.stringify(event)}\n`);
    fs.writeFileSync(path.join(wsRoot, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
    fs.writeFileSync(path.join(wsRoot, 'index.cjs'), `
        const { EventEmitter } = require('node:events');
        module.exports = class WebSocket extends EventEmitter {
            static OPEN = 1;
            constructor() { super(); this.readyState = 1; setImmediate(() => this.emit('open')); }
            send() { this.emit('message', JSON.stringify({ type: 'game_state', sessionId: 'test-game',
                observedAt: Date.now(), online: true, state: { self: { username: 'ag_NEKO', health: 20 },
                    activity: { action: '', skill: null }, inventory: { counts: {} } } })); }
            close() { this.readyState = 3; this.emit('close'); }
        };
    `);
    const originalFetch = globalThis.fetch, originalOnce = process.env.NEKO_DSH_ONCE;
    const requests = [], tickets = [];
    let finish, cleanup;
    const done = new Promise(resolve => { finish = resolve; });
    globalThis.fetch = async (url, init) => {
        requests.push(String(url));
        if (String(url) === 'http://127.0.0.1:48920/health') return Response.json({ ok: true });
        if (String(url) === 'http://127.0.0.1:48920/api/tickets') {
            if (!init?.body) return Response.json(tickets);
            const body = JSON.parse(init.body), ticket = { ...body, id: 'T-0001', status: 'open', occurrences: 1 };
            tickets.push(ticket); return Response.json({ ticket });
        }
        throw Error('No external or game request is allowed in this fixture');
    };
    process.env.NEKO_DSH_ONCE = '1';
    const ctx = {
        agents: { create: async () => ({ agent: { id: 'parent', whenIdle: async () => {} }, dispose: async () => {} }) },
        subagents: { start: async (_kind, options) => {
            const input = JSON.parse(options.prompt[0].text);
            const fact = input.evidence.facts.find(f => f.kind === 'execution');
            const structured = options.label === 'observer' ? { summary: 'Actual refusal', issues: [{ key: 'any-model-key',
                title: 'Backpack refusal', scope: 'execution', severity: 'high', detail: 'Repeated failure needs source review.', evidenceIds: [fact.id] }] }
                : options.label === 'diagnoser' ? { summary: 'Inspect the actual window identity.', evidenceIds: [fact.id] }
                    : { decision: 'accept', acceptedKeys: ['any-model-key'], actionableKeys: ['any-model-key'], evidenceIds: [fact.id], summary: 'Reviewed actual failure.' };
            return { id: options.label, result: Promise.resolve({ stopReason: 'completed', structured }), dispose: async () => {} };
        } },
        on: (_event, handler) => { cleanup = handler; }, get: name => name === 'appExit' ? finish : undefined,
    };
    try {
        apply(ctx, { runtimeRoot, nativeRoot });
        assert.equal(await done, 0);
        assert.equal(peekMaintenance(runtimeRoot).due, 1);
        const claimed = claimMaintenance(runtimeRoot, 'maintainer', { enabled: true });
        assert.equal(claimed.state, 'claimed');
        assert.equal(claimed.request.baselines['T-0001'], 1);
        assert.equal(claimed.request.component, 'execution');
        assert.equal(tickets.length, 1);
        assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:48920/') || url === 'http://127.0.0.1:48916/security/csrf-token'));
    } finally {
        await cleanup?.(); globalThis.fetch = originalFetch;
        if (originalOnce === undefined) delete process.env.NEKO_DSH_ONCE; else process.env.NEKO_DSH_ONCE = originalOnce;
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('neko-dsh-handoff-')); fs.rmSync(root, { recursive: true, force: true });
    }
});
