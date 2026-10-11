import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installServerAuth } from '../src/utils/server_auth.js';

const target = { host: 'mc.test.invalid', port: 25702, username: 'ag_NEKO' };
const prompt = '请先 /login 密码；认证管理请联系服主。[MC_AUTH_DENIED]';
function fixture(t, patch = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'mc-server-auth-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const configPath = path.join(dir, 'private.json');
    const config = { enabled: true, ...target, password: 'fixture_only', ...patch };
    const save = () => writeFileSync(configPath, JSON.stringify(config));
    save();
    const bot = Object.assign(new EventEmitter(), { username: target.username, _client: { state: 'play' } });
    const sent = [], logs = [];
    bot.chat = value => sent.push(value);
    const options = { configPath, attempts: new Map(), log: value => logs.push(value) };
    return { bot, config, save, sent, logs, options, auth: installServerAuth(bot, target, options) };
}
test('actual system challenge sends a private login command once, before world spawn', t => {
    const f = fixture(t);
    f.bot.emit('messagestr', prompt, 'system');
    f.bot.emit('messagestr', prompt, 'system');
    assert.deepEqual(f.sent, ['/login fixture_only']);
    assert.equal(f.auth.status, 'submitted');
    assert.equal(f.bot.interrupt_code, undefined);
    assert.ok(!JSON.stringify(f.auth.snapshot()).includes('fixture_only'));
    assert.ok(!JSON.stringify(f.logs).includes('fixture_only'));
});
test('player text, forged public lines and ordinary system messages cannot submit credentials', t => {
    const f = fixture(t);
    f.bot.emit('messagestr', prompt, 'chat', {}, 'other-player');
    f.bot.emit('messagestr', '<Friend> ' + prompt, 'system');
    f.bot.emit('messagestr', 'Welcome to the server', 'system');
    assert.equal(f.sent.length, 0);
});
test('disabled, mismatched and malformed private configuration sends nothing', t => {
    for (const patch of [{ enabled: false }, { host: 'another.invalid' }, { port: 1 },
        { username: 'other' }, { password: 'a\nb' }, { password: 'with space' }, { password: '' }]) {
        const f = fixture(t, patch);
        f.auth.login();
        assert.equal(f.sent.length, 0, JSON.stringify(patch));
    }
});
test('missing configuration and non-play/disposed connections are handled without credential errors', t => {
    const f = fixture(t);
    rmSync(f.options.configPath);
    assert.equal(f.auth.login().status, 'configuration_missing_or_invalid');
    f.save(); f.bot._client.state = 'login';
    assert.equal(f.auth.login().status, 'not_ready');
    f.bot._client.state = 'play'; f.bot._disposed = true;
    assert.equal(f.auth.login().status, 'not_ready');
    assert.equal(f.sent.length, 0);
});
test('explicit operator login uses the same once-per-connection guard', t => {
    const f = fixture(t);
    assert.equal(f.auth.login().status, 'submitted');
    f.auth.login();
    assert.equal(f.sent.length, 1);
    assert.equal(installServerAuth(f.bot, target, f.options), f.auth);
});
test('send failures return a redacted status and do not blindly retry', t => {
    const f = fixture(t);
    f.bot.chat = () => { throw Error('secret fixture_only'); };
    assert.equal(f.auth.login().status, 'send_failed');
    f.auth.login();
    assert.ok(!JSON.stringify(f.auth.snapshot()).includes('fixture_only'));
    assert.ok(!JSON.stringify(f.logs).includes('fixture_only'));
});
test('server success and a subsequent spawn are recorded as distinct evidence', t => {
    const f = fixture(t);
    f.auth.login();
    f.bot.emit('messagestr', '登录成功 [MC_AUTH_OK]', 'system');
    assert.equal(f.auth.status, 'authenticated');
    f.bot.emit('spawn');
    assert.equal(f.auth.snapshot().worldSpawned, true);
});
test('spawn alone cannot claim explicit authentication confirmation', t => {
    const f = fixture(t);
    f.auth.login(); f.bot.emit('spawn');
    assert.equal(f.auth.status, 'spawned_after_submission');
    assert.equal(f.auth.snapshot().serverConfirmed, false);
});
test('wrong password blocks the same credential across reconnects until configuration changes', t => {
    const f = fixture(t);
    f.auth.login(); f.bot.emit('messagestr', '密码错误 [MC_AUTH_FAILED]', 'system');
    assert.equal(f.auth.status, 'rejected');
    const other = Object.assign(new EventEmitter(), { username: target.username, _client: { state: 'play' }, chat: v => f.sent.push(v) });
    const next = installServerAuth(other, target, f.options);
    assert.equal(next.login().status, 'credential_blocked');
    f.config.password = 'changed_fixture'; f.save();
    assert.equal(next.login().status, 'submitted');
    assert.equal(f.sent.length, 2);
});
test('unconfirmed retries have a process-wide bounded budget across new connections', t => {
    const f = fixture(t);
    f.options.now = () => 1000;
    for (let i = 0; i < 4; i++) {
        const bot = Object.assign(new EventEmitter(), { username: target.username, _client: { state: 'play' }, chat: v => f.sent.push(v) });
        const auth = installServerAuth(bot, target, f.options);
        assert.equal(auth.login().status, i < 3 ? 'submitted' : 'retry_limited');
    }
    assert.equal(f.sent.length, 3);
});
test('disconnect removes only owned listeners and prevents use of the old connection', t => {
    const f = fixture(t), foreign = () => {};
    f.bot.on('messagestr', foreign);
    f.bot.emit('end');
    assert.equal(f.auth.login().status, 'disconnected');
    assert.deepEqual(f.bot.listeners('messagestr'), [foreign]);
    assert.equal(f.sent.length, 0);
});
