import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const installed = new WeakMap(), attempts = new Map();
// Both formats were observed from this gateway. Keep the prefix and command
// anchored so a player-name/public-line wrapper cannot become a login request.
const challenge = /(?:^请先\s*\/login\s+.*\[MC_AUTH_(?:DENIED|REQUIRED)\]\s*$|^\[MC_AUTH_LOGIN\]\s*请先登录[:：]\s*\/login(?:\s+|$))/u;
const success = /\[MC_AUTH_OK\]|^登录成功|^\[MC_AUTH_SUCCESS\]\s*登录成功/u;
const rejected = /\[MC_AUTH_(?:FAILED|INVALID_PASSWORD)\]|^(?:密码错误|Wrong password|Incorrect password)/iu;

function privateConfig(file, connection) {
    if (statSync(file).size > 16384) throw Error('invalid configuration');
    const config = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (config.enabled !== true) return null;
    if (typeof config.host !== 'string' || config.host.toLowerCase() !== String(connection.host).toLowerCase()
        || config.port !== connection.port || config.username !== connection.username
        || typeof config.password !== 'string' || !/^[^\s\x00-\x1f\x7f]{1,128}$/u.test(config.password)) {
        throw Error('invalid configuration');
    }
    return config;
}

// Credentials stay in an ignored operator-owned file. This is not a model tool
// or a public-chat escape hatch: the only command this adapter can send is login.
export function installServerAuth(bot, connection, options = {}) {
    if (installed.has(bot)) return installed.get(bot);
    const file = options.configPath || process.env.MC_SERVER_AUTH_FILE
        || path.resolve('bots/_supervisor/server-auth.json');
    const budget = options.attempts || attempts, now = options.now || Date.now;
    const log = options.log || (message => console.log(`[ServerAuth] ${message}`));
    const key = `${String(connection.host).toLowerCase()}:${connection.port}:${connection.username}`;
    let status = 'waiting_for_challenge', sent = false, closed = false;
    let serverConfirmed = false, worldSpawned = false, record = null;
    const snapshot = () => ({ status, submitted: sent, serverConfirmed, worldSpawned });
    const set = value => { status = value; log(value); return snapshot(); };
    const login = () => {
        if (closed) return snapshot();
        if (sent) return snapshot();
        if (bot._disposed || bot._client?.state !== 'play' || typeof bot.chat !== 'function'
            || bot.username !== connection.username) return set('not_ready');
        let config;
        try { config = privateConfig(file, connection); }
        catch { return set('configuration_missing_or_invalid'); }
        if (!config) return set('disabled');
        const fingerprint = createHash('sha256').update(config.password).digest('hex');
        record = budget.get(key);
        if (!record || record.fingerprint !== fingerprint) {
            record = { fingerprint, count: 0, resetAt: now() + 300000, blocked: false };
            budget.set(key, record);
        }
        if (record.blocked) return set('credential_blocked');
        if (now() >= record.resetAt) { record.count = 0; record.resetAt = now() + 300000; }
        if (record.count >= 3) return set('retry_limited');
        sent = true; record.count++;
        set('submitted');
        try { bot.chat(`/login ${config.password}`); }
        catch { return set('send_failed'); } // Error messages can contain the command.
        return snapshot();
    };
    const onMessage = (line, position, _json, sender) => {
        if (closed || position !== 'system' || sender) return;
        const text = String(line).replace(/§[0-9a-fk-or]/gi, '').trim();
        if (sent && rejected.test(text)) {
            if (record) record.blocked = true;
            set('rejected');
        } else if (sent && success.test(text)) {
            serverConfirmed = true;
            if (record) record.count = 0;
            set('authenticated');
        } else if (challenge.test(text)) login();
    };
    const onSpawn = () => {
        if (!sent || closed) return;
        worldSpawned = true;
        if (record && !record.blocked) record.count = 0;
        if (!serverConfirmed) set('spawned_after_submission');
    };
    const close = () => {
        if (closed) return;
        closed = true; status = 'disconnected';
        bot.removeListener('messagestr', onMessage);
        bot.removeListener('spawn', onSpawn);
        bot.removeListener('end', close);
        bot.removeListener('kicked', close);
    };
    const controller = { login, snapshot, close, get status() { return status; } };
    installed.set(bot, controller);
    bot.on('messagestr', onMessage);
    bot.on('spawn', onSpawn);
    bot.once('end', close);
    bot.once('kicked', close);
    return controller;
}
