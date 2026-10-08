const lastSent = new WeakMap();

export async function sendGameChat(bot, { text, player } = {}) {
    if (!bot?.entity || typeof bot.chat !== 'function') return { status: 'failed', reason: 'offline' };
    if (typeof text !== 'string' || !text.trim() || text.length > 180 || /[\x00-\x1f]/.test(text) || text.trim().startsWith('/')) {
        return { status: 'failed', reason: 'Use 1-180 characters of plain chat text, without commands or control characters.' };
    }
    if (player != null && (typeof player !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(player))) {
        return { status: 'failed', reason: 'Invalid player name.' };
    }
    if (Date.now() - (lastSent.get(bot) || 0) < 2000) return { status: 'failed', reason: 'rate_limited' };
    lastSent.set(bot, Date.now());
    return await new Promise(resolve => {
        let timer;
        const finish = result => {
            clearTimeout(timer);
            bot.removeListener('messagestr', onMessage);
            resolve(result);
        };
        const onMessage = (line, _position, _json, sender) => {
            if (String(line).includes(text.trim()) &&
                ((sender && sender === bot.player?.uuid) || String(line).includes(bot.username))) {
                finish({ status: 'echoed', channel: player ? 'whisper' : 'public' });
            }
        };
        bot.on('messagestr', onMessage);
        timer = setTimeout(() => finish({ status: 'submitted', channel: player ? 'whisper' : 'public' }), 1800);
        try {
            if (player) bot.whisper(player, text.trim());
            else bot.chat(text.trim());
        } catch (error) {
            finish({ status: 'failed', reason: error.message });
        }
    });
}
