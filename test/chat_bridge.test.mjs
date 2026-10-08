import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { sendGameChat } from '../src/websocket/chat_bridge.js';

function fakeBot() {
    const bot = Object.assign(new EventEmitter(), { entity: {}, username: 'ag_NEKO' });
    bot.sent = [];
    bot.chat = text => { bot.sent.push(text); bot.emit('messagestr', `<ag_NEKO> ${text}`); };
    bot.whisper = (player, text) => { bot.sent.push({ player, text }); bot.emit('messagestr', `ag_NEKO -> ${player}: ${text}`); };
    return bot;
}
test('public chat waits for echo and never takes over a movement task', async () => {
    const bot = fakeBot();
    bot.interrupt_code = false;
    assert.equal((await sendGameChat(bot, { text: '你好' })).status, 'echoed');
    assert.equal(bot.interrupt_code, false);
    assert.equal(bot.listenerCount('messagestr'), 0);
});
test('private chat uses an explicit valid recipient', async () => {
    const bot = fakeBot();
    assert.equal((await sendGameChat(bot, { text: '你好', player: 'Friend_1' })).channel, 'whisper');
    assert.deepEqual(bot.sent, [{ player: 'Friend_1', text: '你好' }]);
});
test('rejects commands, multiline input, excessive length and invalid recipients', async () => {
    for (const payload of [{ text: '/op somebody' }, { text: 'a\nb' }, { text: 'a'.repeat(181) }, { text: 'hi', player: 'a b' }]) {
        const bot = fakeBot();
        assert.equal((await sendGameChat(bot, payload)).status, 'failed');
        assert.equal(bot.sent.length, 0);
    }
});
test('rate limits repeated sends and rejects offline state', async () => {
    const bot = fakeBot();
    await sendGameChat(bot, { text: 'one' });
    assert.equal((await sendGameChat(bot, { text: 'two' })).reason, 'rate_limited');
    assert.equal((await sendGameChat(null, { text: 'hi' })).reason, 'offline');
});
