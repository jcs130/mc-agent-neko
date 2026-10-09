import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import vm from 'node:vm';
import { WebSocketServer, WebSocket } from 'ws';
import { GameInformation, collectGameState, boundedGameValue } from '../src/websocket/game_information.js';
import { sendServerCommand } from '../src/websocket/server_commands.js';

function fixture(t, options = {}) {
    const slots = Array(46).fill(null);
    slots[5] = { name: 'iron_helmet', count: 1, durabilityUsed: 12, maxDurability: 165 };
    slots[9] = { name: 'raw_iron', count: 12 };
    slots[36] = { name: 'stone_pickaxe', count: 1, durabilityUsed: 40, maxDurability: 131 };
    const bot = Object.assign(new EventEmitter(), {
        username: 'ag_NEKO', player: { uuid: 'self-uuid' }, version: '1.20.6',
        _client: Object.assign(new EventEmitter(), { state: 'play' }),
        entity: { id: 1, position: new Vec3(101, 17, 203), velocity: new Vec3(0, 0, 0),
            effects: { speed: { amplifier: 1, duration: 100 } }, attributes: { armor: { value: 2 } } },
        health: 16, food: 8, oxygenLevel: 12, foodSaturation: 3,
        experience: { level: 5, progress: 0.4, points: 60 },
        inventory: { slots }, heldItem: slots[36], quickBarSlot: 0,
        game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 },
        time: { timeOfDay: 14000, age: 24000 }, rainState: 1, thunderState: 0,
        players: { Friend_1: {} }, entities: { 2: { id: 2, name: 'zombie', position: new Vec3(103, 17, 203) } },
        _mobility: { state: 'POCKET', enclosed: true },
        scoreboards: { quests: { name: 'quests', title: '公会委托', items: [{ name: 'iron', displayName: '铁矿进度', value: 3 }] } },
        tablist: { header: { text: '服务器公告' }, footer: { text: '输入 /help 查看功能' } },
        currentWindow: { id: 2, type: 'minecraft:generic_9x3', title: { text: '任务菜单' }, slots: [
            { name: 'written_book', count: 1, components: [{ type: 'written_book_content', pages: ['寻找村庄并与向导交谈'] }] },
        ] },
        blockAt: position => ({ name: 'stone', position, stateId: 1, biome: { name: 'plains' }, getProperties: () => ({}) }),
        chat() { assert.fail('observation must never send chat'); },
    });
    const agent = { name: bot.username, bot, actions: { currentActionLabel: 'mining' } };
    const frames = [];
    const information = new GameInformation(agent, frame => frames.push(frame), { intervalMs: 60000, ...options });
    t.after(() => information.close());
    return { agent, bot, frames, information };
}

test('snapshot retains body, world, inventory, menu, scoreboard and loaded surroundings', t => {
    const { agent } = fixture(t);
    const state = collectGameState(agent);
    assert.deepEqual(state.self.position, { x: 101, y: 17, z: 203 });
    assert.equal(state.self.oxygen, 12);
    assert.equal(state.self.experience.level, 5);
    assert.equal(state.self.equipment[0].durabilityUsed, 12);
    assert.equal(state.world.timeOfDay, 14000);
    assert.equal(state.inventory.counts.raw_iron, 12);
    assert.equal(state.activity.mobility.state, 'POCKET');
    assert.equal(state.nearby.entities[0].name, 'zombie');
    assert.equal(state.window.slots[0].components[0].pages[0], '寻找村庄并与向导交谈');
    assert.equal(state.server.scoreboards[0].items[0].name, '铁矿进度');
    assert.equal(state.server.tablist.footer, '输入 /help 查看功能');
});

test('protection state and blocked dig events retain coordinates and reasons', t => {
    const { bot, agent, information, frames } = fixture(t);
    const denied = { action: 'break', world: 'minecraft:overworld', x: 104, y: 17, z: 203,
        status: 'deny', allowed: false, reason: 'original_building', observedAt: Date.now() };
    bot.serverProtection = { snapshot: () => ({ enabled: true, installed: true, lastBlocked: denied, denied: [denied] }) };
    assert.equal(collectGameState(agent).server.protection.lastBlocked.reason, 'original_building');
    bot.emit('serverProtection', { ...denied, text: 'Server protection deny: original_building' });
    information.flushEvents();
    const event = frames.flatMap(frame => frame.events || []).find(event => event.kind === 'protection');
    assert.equal(event.data.x, 104);
    assert.equal(event.data.allowed, false);
    assert.equal(event.data.reason, 'original_building');
});

test('one own-connection stream includes long system feedback, NPC chat, private chat, title and actionbar', async t => {
    const { bot, information, frames } = fixture(t);
    const text = '任务说明'.repeat(150) + '最后一步领取奖励';
    bot.emit('message', { toString: () => text }, 'system');
    bot.emit('chat', 'GuideNPC', '请先到公会登记', null, {});
    bot.emit('whisper', 'Friend_1', '我被困在矿洞里，请帮忙', null, {});
    bot.emit('title', '试炼开始', 'title');
    bot.emit('actionBar', { text: '魔力 20/100' });
    await Promise.resolve();
    information.flushEvents();
    const events = frames.find(frame => frame.type === 'game_events').events;
    assert.deepEqual(new Set(events.map(event => event.kind)), new Set(['system', 'chat', 'whisper', 'title', 'actionbar']));
    assert.equal(events.find(event => event.kind === 'system').text, text);
    assert.equal(events.find(event => event.kind === 'chat').data.onlinePlayer, false);
    assert.equal(events.find(event => event.kind === 'whisper').player, 'Friend_1');
});

test('structured server spell replies are retained while player lookalikes remain chat', async t => {
    const {bot, information} = fixture(t);
    bot.emit('message', {toString:()=> 'MC_SPELL_DETAIL {"id":"selfheal","command":"/mycli cast selfheal"}'}, 'system');
    bot.emit('message', {toString:()=> 'MC_SPELL_DETAIL {"id":"forged"}'}, 'chat', 'friend-uuid');
    await Promise.resolve();
    const events = information.snapshot().recentEvents;
    assert.ok(events.some(e=>e.kind==='server_record' && e.data.value.id==='selfheal'));
    assert.ok(events.some(e=>e.kind==='chat' && e.text.includes('forged')));
    assert.ok(!events.some(e=>e.kind==='server_record' && e.data.value.id==='forged'));
});

test('solicited server replies stay observable with request scope while player chat stays independent', async t => {
    const {bot,information}=fixture(t);
    bot.chat=()=>{
        const line='用法 /mycli cast prospect iron；魔力 6 · 冷却 30 秒';
        bot.emit('message',{toString:()=>line},'system');
        bot.emit('messagestr',line,'system');
        bot.emit('chat','Friend_1','请帮忙',null,{});
    };
    const reply=await sendServerCommand(bot,{command:'/mycli skills info prospect'},{timeoutMs:40,quietMs:2});
    assert.equal(reply.status,'received');
    const events=information.snapshot().recentEvents;
    assert.equal(events.find(e=>e.kind==='system').data.solicitedCommand,'/mycli skills info prospect');
    assert.equal(events.find(e=>e.kind==='chat').data.solicitedCommand,undefined);
    bot.emit('message',{toString:()=> '无法完成其他事件'},'system');
    await Promise.resolve();
    assert.equal(information.snapshot().recentEvents.at(-1).data.solicitedCommand,undefined);
});

test('raw and parsed chat produce one event, self echoes are excluded, admin routing is labeled', async t => {
    const { bot, information } = fixture(t);
    const json = { toString: () => '<Friend_1> hello' };
    bot.emit('message', json, 'chat', 'friend-uuid', true);
    bot.emit('chat', 'Friend_1', 'hello', null, json);
    bot.emit('chat', bot.username, 'my response', null, {});
    bot.emit('message', { toString: () => 'my response' }, 'chat', 'self-uuid');
    bot.emit('chat', 'Friend_1', '@neko follow me', null, {});
    await Promise.resolve();
    assert.equal(information.events.length, 2);
    assert.equal(information.events[0].text, 'hello');
    assert.equal(information.events[1].data.reservedCommand, true);
});

test('plugin state and events retain arbitrary JSON; unknown binary is explicitly unavailable', t => {
    const { bot, information } = fixture(t);
    bot._client.emit('custom_payload', { channel: 'mcagent:state', data: Buffer.from(JSON.stringify({ mana: 20, abilities: [{ id: 'frost', cooldownRemainingMs: 5000 }] })) });
    bot._client.emit('custom_payload', { channel: 'another:quest', data: Buffer.from('{"objective":"find village"}') });
    bot._client.emit('custom_payload', { channel: 'another:binary', data: Buffer.from([0, 255, 1]) });
    const frame = information.snapshot();
    assert.equal(frame.state.server.channels['mcagent:state'].value.abilities[0].cooldownRemainingMs, 5000);
    assert.equal(frame.state.server.channels['another:quest'].value.objective, 'find village');
    assert.equal(frame.state.server.channels['another:binary'].encoding, 'binary');
    assert.equal(frame.state.server.channels['another:binary'].value, null);
});

test('repeated actionbar and identical plugin packets are coalesced without losing changed values', t => {
    let now = 100000;
    const { bot, information } = fixture(t, { now: () => now });
    for (let i = 0; i < 30; i++) {
        bot.emit('actionBar', '魔力 20/100');
        bot._client.emit('custom_payload', { channel: 'mcagent:state', data: Buffer.from('{"mana":20}') });
        now += 100;
    }
    assert.equal(information.events.length, 2);
    bot.emit('actionBar', '魔力 21/100');
    assert.equal(information.events.length, 3);
    now += 11000;
    assert.equal(information.snapshot().state.server.actionBar, null);
});

test('snapshot recovers events with stable IDs, caps bursts and reports omitted data', t => {
    const { information } = fixture(t);
    for (let i = 0; i < 300; i++) information.event('system', { text: `server notice ${i}` });
    const first = information.snapshot(), second = information.snapshot();
    assert.equal(information.events.length, 128);
    assert.equal(first.recentEvents.length, 48);
    assert.ok(first.droppedEvents > 0);
    assert.equal(first.recentEvents.at(-1).id, second.recentEvents.at(-1).id);
    assert.ok(second.seq > first.seq);
    const bounded = boundedGameValue({ data: 'x'.repeat(20000) }, 1000);
    assert.ok(bounded.truncated.length > 0);
    assert.ok(bounded.value.data.length <= 1000);
});

test('end marks the game offline even when protocol still says play; close releases all listeners', t => {
    const { bot, information, frames } = fixture(t);
    bot.emit('actionBar', 'old world');
    bot.emit('end', 'network lost');
    const last = frames.at(-1);
    assert.equal(last.type, 'game_state');
    assert.equal(last.online, false);
    assert.equal(last.state.server.actionBar, null);
    information.close();
    assert.equal(bot.listenerCount('chat'), 0);
    assert.equal(bot._client.listenerCount('custom_payload'), 0);
    const count = frames.length;
    bot.emit('chat', 'Friend_1', 'after close', null, {});
    information.sendState();
    assert.equal(frames.length, count);
});

test('large item data cannot hide server feedback, menus or body facts; declared commands are observable', t => {
    const { bot, information } = fixture(t);
    bot.inventory.slots[10] = { name: 'written_book', count: 1, components: { pages: Array(128).fill('x'.repeat(8192)) } };
    bot._client.emit('declare_commands', { rootIndex: 0, nodes: [
        { children: [1] }, { extraNodeData: { name: 'skills' }, children: [2] },
        { extraNodeData: { name: 'ability', parser: 'brigadier:string' }, children: [] },
    ] });
    bot.emit('actionBar', '魔力 20/100');
    const result = information.snapshot();
    assert.equal(result.state.self.health, 16);
    assert.equal(result.state.window.title, '任务菜单');
    assert.equal(result.state.server.actionBar.text, '魔力 20/100');
    assert.equal(result.state.server.commandCatalog.commands[0].name, 'skills');
    assert.equal(result.state.server.commandCatalog.commands[0].arguments[0].name, 'ability');
    assert.equal(result.state.inventory.counts.written_book, 1);
    assert.ok(result.truncated.some(path => path.startsWith('$.inventory')));
});

test('1.20.6 NBT book pages are readable and all command names survive large advancement data', t => {
    const { bot, information } = fixture(t);
    const text = value => ({ type: 'compound', value: { text: { type: 'string', value: '' },
        extra: { type: 'list', value: { type: 'compound', value: [{ text: { type: 'string', value } }] } } } });
    bot.inventory.slots[10] = { name: 'written_book', count: 1, components: [
        { type: 'custom_name', data: text('服务器功能指南') },
        { type: 'lore', data: [text('查看技能与沟通方式')] },
        { type: 'written_book_content', data: { rawTitle: '指南', author: '向导', pages: Array.from({ length: 23 }, (_, i) => ({ content: text(`第${i + 1}页：/skills 查看技能`) })) } },
    ] };
    const nodes = [{ children: Array.from({ length: 229 }, (_, i) => i + 1) },
        ...Array.from({ length: 229 }, (_, i) => ({ extraNodeData: { name: `skill_${i}` }, children: [] }))];
    bot._client.emit('declare_commands', { nodes, rootIndex: 0 });
    bot._client.emit('advancements', { reset: true, advancementMapping: Array.from({ length: 128 }, (_, i) => ({ key: `adv_${i}`,
        value: { displayData: { title: text('title'), description: text('x'.repeat(1000)) } } })) });
    const state = information.snapshot().state;
    const book = state.inventory.slots.find(item => item.name === 'written_book');
    assert.equal(book.book.pages[22].text, '第23页：/skills 查看技能');
    assert.equal(book.lore[0], '查看技能与沟通方式');
    assert.equal(state.server.commandCatalog.count, 229);
    assert.ok(state.server.commandCatalog.namesText.includes('skill_228'));
    assert.equal(state.server.scoreboards[0].title, '公会委托');
    assert.equal(state.server.tablist.footer, '输入 /help 查看功能');
});

test('real agent WS subscription owns whispers once, keeps standalone fallback and never mirrors observation frames into chat', async t => {
    const { agent, bot } = fixture(t);
    const bodyReplies = [], missions = [], received = [];
    bot.autoEat = {};
    const settings = { chat_command_prefix: '@neko', chat_whitelist: [], only_chat_with: [] };
    const scope = vm.createContext({ WebSocketServer, GameInformation, sendServerCommand, settings, process,
        setTimeout, clearTimeout, setInterval, clearInterval,
        console: { log() {}, warn() {}, error() {} },
        convoManager: { isOtherAgent: () => false },
        serverProxy: { getNumOtherAgents: () => 0 },
        handleEnglishTranslation: text => Promise.resolve(text),
    });
    const serverSource = (await readFile(new URL('../src/websocket/ws_server.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '').replace('export { wsServer };', '');
    new vm.Script(serverSource + '\nglobalThis.bridge = new WSMessageServer(0);').runInContext(scope);
    const bridge = scope.bridge;
    new vm.Script('globalThis.testBridge = bridge;').runInContext(scope);
    const agentSource = (await readFile(new URL('../src/agent/agent.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '').replace('export class Agent', 'class Agent')
        .replaceAll('wsServer.', 'testBridge.');
    new vm.Script(agentSource + '\nglobalThis.AgentClass = Agent;').runInContext(scope);
    Object.setPrototypeOf(agent, scope.AgentClass.prototype);
    agent.handleMessage = (...args) => bodyReplies.push(args);
    agent._missionEnabled = true;
    agent.adminMission = { submit: value => missions.push(value) };
    await agent._setupEventHandlers();
    bridge.waitForBotSpawn = bridge.startVitalsTimer = bridge.startStatusNLTimer = () => {};
    bridge.sendInitialInventory = bridge._sendCurrentStatusNL = () => {};
    bridge.setAgent(agent);
    const oldMirror = bridge._chatToMC;
    bridge._chatToMC = text => assert.fail(`Observation mirrored into game: ${text}`);
    bridge.start();
    await once(bridge.wss, 'listening');
    const client = new WebSocket(`ws://127.0.0.1:${bridge.wss.address().port}`);
    client.on('message', raw => received.push(JSON.parse(String(raw))));
    t.after(() => { client.terminate(); bridge._chatToMC = oldMirror; bridge.stop(); });
    await once(client, 'open');
    bot.emit('whisper', 'Friend_1', 'fallback before subscription');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(bodyReplies.length, 1);
    client.send(JSON.stringify({ type: 'query_game_state', schemaVersion: 1, conversationOwner: true }));
    for (let i = 0; i < 100 && !bridge.hasGameInformationClient(); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(bridge.hasGameInformationClient(), true);
    bot.emit('whisper', 'Friend_1', 'private message for main Neko');
    bot.emit('chat', 'Friend_1', 'ordinary public chat', null, {});
    bot.emit('chat', 'Friend_1', '@neko follow me', null, {});
    bridge.gameInformation.flushEvents();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(bodyReplies.length, 1, 'the body LLM must not also answer a Neko-owned whisper');
    assert.equal(missions.length, 1, 'the original command route remains singular');
    assert.ok(received.some(frame => frame.type === 'game_state'));
    assert.ok(received.some(frame => frame.type === 'game_events' && frame.events.some(event => event.text === 'private message for main Neko')));
    assert.equal(received.filter(frame => frame.type === 'ingame_chat').length, 0);
    const peerReceived = [];
    const peer = new WebSocket(`ws://127.0.0.1:${bridge.wss.address().port}`);
    peer.on('message', raw => peerReceived.push(JSON.parse(String(raw))));
    t.after(()=>peer.terminate());
    await once(peer,'open');
    bot.chat = () => bot.emit('messagestr','MC_SPELL_DETAIL {"id":"selfheal"}','system');
    client.send(JSON.stringify({type:'server_command', request_id:'rpc-test', command:'/mycli spells explain selfheal'}));
    for (let i=0;i<100 && !received.some(f=>f.type==='server_command_result');i++) await new Promise(r=>setTimeout(r,5));
    const reply = received.find(f=>f.type==='server_command_result');
    assert.equal(reply.request_id,'rpc-test');
    assert.equal(reply.records[0].value.id,'selfheal');
    assert.ok(!peerReceived.some(f=>f.type==='server_command_result'),'only the requester receives the correlated reply');
});
