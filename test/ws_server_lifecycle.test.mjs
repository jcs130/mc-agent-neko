import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

function fixture() {
    const created = [];
    class Server extends EventEmitter {
        constructor() { super(); created.push(this); }
        close() { this.emit('close'); }
    }
    const context = vm.createContext({ WebSocketServer: Server, process, setTimeout, clearTimeout,
        clearInterval, console: { log() {}, warn() {}, error() {} } });
    const source = readFileSync(new URL('../src/websocket/ws_server.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export \{ wsServer \};\s*$/m, '');
    vm.runInContext(source + '\nglobalThis.bridge = new WSMessageServer(0);', context);
    return { bridge: context.bridge, created };
}

test('only an installed external mission emits its exact acceptance, before movement is claimed', () => {
    const { bridge } = fixture();
    const frames = [];
    bridge.broadcast = frame => frames.push(frame);
    bridge.beginMissionTask('沿现有通道去入口', 'task-owned', 'ws');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, 'task_accepted');
    assert.equal(frames[0].task_id, 'task-owned');
    assert.equal(frames[0].phase, 'planning');
    assert.equal(frames[0].acceptedAt, bridge.taskStartTime);
    assert.equal('completed' in frames[0], false);
});

test('legacy or in-game missions do not fabricate an external task acceptance', () => {
    const { bridge } = fixture();
    const frames = [];
    bridge.broadcast = frame => frames.push(frame);
    bridge.beginMissionTask('chat task', 'chat-owned', 'chat');
    bridge.beginMissionTask('legacy task', null, 'ws');
    assert.equal(frames.length, 0);
});

test('respawn start reuses the binding and existing clients while the listener is alive', () => {
    const { bridge, created } = fixture();
    bridge.start();
    const server = bridge.wss;
    const client = {};
    bridge.clients.add(client);
    bridge.start();
    bridge.start();
    assert.equal(created.length, 1, 'respawns must not attempt another port bind');
    assert.equal(bridge.wss, server);
    assert.equal(bridge.clients.has(client), true);
    assert.equal(server.listenerCount('connection'), 1);
});

test('a stopped listener can be started again after close without clearing a newer listener', () => {
    const { bridge, created } = fixture();
    bridge.start();
    const old = bridge.wss;
    bridge.stop();
    assert.equal(bridge.wss, null);
    bridge.start();
    assert.equal(created.length, 2);
    const current = bridge.wss;
    old.emit('close');
    assert.equal(bridge.wss, current, 'a late close belongs only to its original listener');
    bridge.stop();
});
