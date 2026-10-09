import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture({ owner = true, enabled = true, recipients = [] } = {}) {
    const source = readFileSync(new URL('../src/agent/agent.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace('export class Agent', 'class Agent');
    const publicMessages = [], whispers = [], local = [], frames = [];
    const context = vm.createContext({
        console, settings: { chat_ingame: enabled, only_chat_with: recipients, speak: false },
        containsCommand: text => /![A-Za-z_][\w]*/.exec(text)?.[0] || null,
        handleTranslation: async text => text,
        sendOutputToServer: (_name, text) => local.push(text),
        wsServer: { hasGameInformationClient: () => owner, broadcastAgentResponse: text => frames.push(text) },
    });
    new vm.Script(source + '\nglobalThis.TestAgent=Agent;').runInContext(context);
    const agent = Object.create(context.TestAgent.prototype);
    agent.name = 'ag_NEKO';
    agent.bot = { chat: text => publicMessages.push(text), whisper: (player, text) => whispers.push({ player, text }) };
    return { agent, publicMessages, whispers, local, frames };
}

test('external conversation ownership keeps body tools and narration entirely local', async () => {
    const f = fixture();
    await f.agent.openChat('收到，开始找木头。\n!getWood(8)');
    await f.agent.openChat('获取木头失败，准备换个目标。');
    assert.deepEqual(f.publicMessages, []);
    assert.deepEqual(f.whispers, []);
    assert.equal(f.local.length, 2);
    assert.ok(f.frames[0].includes('!getWood(8)'), 'tool detail remains available in the local UI');
});

test('chat_ingame false covers automatic whispers as well as public output', async () => {
    const f = fixture({ owner: false, enabled: false, recipients: ['Friend_1'] });
    await f.agent.openChat('执行中。!runSkill("chopWood")');
    assert.deepEqual(f.publicMessages, []);
    assert.deepEqual(f.whispers, []);
    assert.equal(f.frames.length, 1);
});

test('external ownership also suppresses configured automatic whispers', async () => {
    const f = fixture({ recipients: ['Friend_1'] });
    await f.agent.openChat('执行中。!getWood(8)');
    assert.deepEqual(f.whispers, []);
});

test('standalone conversation keeps its text but never publishes the tool suffix', async () => {
    const f = fixture({ owner: false });
    await f.agent.openChat('你好。\n!getWood(8)');
    await f.agent.openChat('!getInventory()');
    assert.deepEqual(f.publicMessages, ['你好。']);
    assert.equal(f.frames.length, 2);
});

test('standalone deliberate recipient routing also excludes the tool suffix', async () => {
    const f = fixture({ owner: false, recipients: ['Friend_1'] });
    await f.agent.openChat('谢谢你的帮助。\n!getWood(8)');
    assert.deepEqual(f.whispers, [{ player: 'Friend_1', text: '谢谢你的帮助。' }]);
});

test('debug chat and mission banners are opt-in', () => {
    for (const [file, method] of [['../src/websocket/ws_server.js', '_chatToMC'], ['../src/agent/admin_mission.js', '_emitBanner']]) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
        const begin = source.indexOf(`    ${method}(text) {`);
        const body = source.slice(begin, source.indexOf('\n    }', begin) + 6);
        const sent = [], bot = { entity: {}, chat: text => sent.push(text) }, env = {};
        const context = vm.createContext({ process: { env }, Date });
        new vm.Script(`class Output {${body}};globalThis.Output=Output;`).runInContext(context);
        const output = new context.Output(); output.agent = { bot }; output._bot = () => bot;
        output[method]('debug tool output'); assert.deepEqual(sent, []);
        env.DEBUG_CHAT = '0'; output[method]('debug tool output'); assert.deepEqual(sent, []);
        env.DEBUG_CHAT = '1'; output[method]('debug tool output'); assert.deepEqual(sent, ['debug tool output']);
    }
});
