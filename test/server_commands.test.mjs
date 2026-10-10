import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function commands(file, name) {
    const source = readFileSync(new URL(`../src/agent/commands/${file}.js`,import.meta.url),'utf8')
        .replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
    const context = vm.createContext({});
    vm.runInContext(source,context);
    return vm.runInContext(name,context);
}

test('body exposes server discovery and execution separately from local runSkill', () => {
    assert.ok(commands('queries','queryList').find(x=>x.name==='!serverQuery'));
    assert.ok(commands('actions','actionsList').find(x=>x.name==='!serverCommand'));
});

async function bridge() { return (await import('../src/websocket/server_commands.js')).sendServerCommand; }
function fakeBot(reply) {
    const bot=Object.assign(new EventEmitter(), { entity: {}, username:'ag_NEKO' });
    bot.sent=[];
    bot.chat=command=>{bot.sent.push(command); reply?.(bot,command);};
    return bot;
}

test('server replies are captured before synchronous send, parsed and cleaned up', async()=>{
    const send=await bridge();
    const bot=fakeBot(b=>{
        b.emit('messagestr','MC_SPELL_LIST {"schemaVersion":1,"page":1,"pages":1,"total":1}','system');
        b.emit('messagestr','MC_SPELL_ITEM {"id":"selfheal","command":"/mycli cast selfheal"}','system');
    });
    const r=await send(bot,{command:'/mycli spells list 1'},{timeoutMs:60,quietMs:5});
    assert.equal(r.status,'received');
    assert.equal(r.confirmed,false,'a catalog is not successful learning or casting');
    assert.equal(r.records[1].value.id,'selfheal');
    assert.equal(bot.listenerCount('messagestr'),0);
    assert.equal(bot.listenerCount('end'),0);
});

test('player chat cannot confirm a server reply', async()=>{
    const send=await bridge();
    const bot=fakeBot(b=>b.emit('messagestr','MC_SPELL_DETAIL {"id":"selfheal"}','chat',{},'player-uuid'));
    const r=await send(bot,{command:'/mycli spells explain selfheal'},{timeoutMs:10,quietMs:2});
    assert.equal(r.status,'submitted');
    assert.equal(r.messages.length,0);
});

test('rejects command injection and non-gameplay roots before sending',async()=>{
    const send=await bridge();
    for(const command of ['/op ag_NEKO','/mycli\n/op ag_NEKO','/mycli;op','/mycli\u0000 skills','/mycli '+'x'.repeat(220)]){
        const bot=fakeBot();
        assert.equal((await send(bot,{command})).status,'failed',command);
        assert.equal(bot.sent.length,0);
    }
    assert.equal((await send(null,{command:'/mycli help'})).reason,'offline');
});

test('read-only discovery rejects learning and casting but accepts paginated explanation',async()=>{
    const send=await bridge();
    const bot=fakeBot(b=>b.emit('messagestr','说明','system'));
    assert.equal((await send(bot,{command:'/mycli skills learn selfheal',readOnly:true})).status,'failed');
    assert.equal((await send(bot,{command:'/mycli cast selfheal',readOnly:true})).status,'failed');
    assert.equal((await send(bot,{command:'/mycli spells explain selfheal',readOnly:true},{timeoutMs:20,quietMs:2})).status,'received');
});

test('read-only discovery accepts the live server skill and profession status grammar',async()=>{
    const send=await bridge();
    const bot=fakeBot(b=>b.emit('messagestr','MC_SKILL_POINTS {"remaining":5}','system'));
    for (const command of ['/mycli skills info selfheal', '/mycli skills mine', '/mycli skills points', '/mycli profession status']) {
        assert.equal((await send(bot,{command,readOnly:true},{timeoutMs:20,quietMs:2})).status,'received',command);
    }
    assert.equal((await send(bot,{command:'/mycli profession choose warrior',readOnly:true})).status,'failed');
});

test('concurrent requests refuse busy and disconnect releases the request slot',async()=>{
    const send=await bridge(), bot=fakeBot();
    const first=send(bot,{command:'/mycli help'},{timeoutMs:50,quietMs:2});
    assert.equal((await send(bot,{command:'/mycli spells list 1'})).reason,'busy');
    bot.emit('end');
    assert.equal((await first).status,'unknown');
    assert.equal(bot.listenerCount('messagestr'),0);
    bot.chat=()=>bot.emit('messagestr','说明','system');
    assert.equal((await send(bot,{command:'/mycli help'},{timeoutMs:20,quietMs:2})).status,'received');
});

test('protection and land inspection are read-only; land mutations remain forbidden', async () => {
    const send = await bridge(), bot = fakeBot(b => b.emit('messagestr', 'MC_PROTECTION {"status":"deny"}', 'system'));
    for (const command of ['/mycli protect break -574 73 -505', '/mycli protect place 1 2 3',
        '/mycli protect container 1 2 3', '/mycli protect use 1 2 3', '/mycli land here', '/mycli land list', '/mycli land info abc123']) {
        assert.equal((await send(bot, { command, readOnly: true }, { quietMs: 2, timeoutMs: 20 })).status, 'received', command);
    }
    for (const command of ['/mycli land claim', '/mycli land delete abc123', '/mycli protect break 1 2 3 extra', '/mycli protect break 1.5 2 3']) {
        assert.equal((await send(bot, { command, readOnly: true })).status, 'failed', command);
    }
});

test('reply collection is bounded and preserves an explicit truncation indicator',async()=>{
    const send=await bridge();
    const bot=fakeBot(b=>{for(let i=0;i<200;i++) b.emit('messagestr',`MC_TEST {"i":${i},"text":"${'x'.repeat(900)}"}`,'system');});
    const r=await send(bot,{command:'/mycli help'},{timeoutMs:30,quietMs:2});
    assert.equal(r.truncated,true);
    assert.ok(r.messages.join('').length<=16000);
    assert.ok(r.records.length<=64);
});

test('reply metadata distinguishes allowlisted queries from mutations and unknown commands', async () => {
    const send = await bridge(), bot = fakeBot(b => b.emit('messagestr', 'reply', 'system'));
    for (const command of ['/mycli guild status', '/agentfriend:mycli  spells list 1', '/mycli help']) {
        const result = await send(bot, { command }, { quietMs: 2, timeoutMs: 20 });
        assert.equal(result.readOnly, true, command);
    }
    for (const command of ['/mycli cast selfheal', '/mycli guild accept example', '/mycli future-command']) {
        const result = await send(bot, { command }, { quietMs: 2, timeoutMs: 20 });
        assert.equal(result.readOnly, false, command);
        assert.equal(result.confirmed, false);
    }
});

test('reply metadata recognizes documented market, engineering and world catalogue queries', async () => {
    const send = await bridge(), bot = fakeBot(b => b.emit('messagestr', 'catalogue', 'system'));
    for (const command of ['/mycli guild market list', '/mycli guild market tm_trail_supply',
        '/mycli guild market tm_field_cycle', '/mycli guild engineering list', '/mycli world board']) {
        const result = await send(bot, { command }, { quietMs: 2, timeoutMs: 20 });
        assert.equal(result.readOnly, true, command);
        assert.equal(result.confirmed, false);
    }
});

test('catalogue result classification does not expand serverQuery permissions', async () => {
    const send = await bridge(), bot = fakeBot();
    for (const command of ['/mycli guild market tm_field_cycle', '/mycli world board']) {
        assert.equal((await send(bot, { command, readOnly: true })).status, 'failed');
    }
    assert.equal(bot.sent.length, 0);
});

test('catalogue-like mutation and unknown arguments cannot gain query metadata', async () => {
    const send = await bridge(), bot = fakeBot(b => b.emit('messagestr', 'MC_MARKET_DETAIL {"id":"tm_field_cycle"}', 'system'));
    for (const command of ['/mycli guild market accept', '/mycli guild market tm_field_cycle claim',
        '/mycli guild claim tm_trail_supply', '/mycli guild engineering accept hut',
        '/mycli world board reset', '/mycli guild market arbitrary']) {
        assert.equal((await send(bot, { command }, { quietMs: 2, timeoutMs: 20 })).readOnly, false, command);
    }
});
