const lastSent = new WeakMap();
const recentMessages = new WeakMap();
const INTERNAL_TEXT = /![A-Za-z_]\w*\s*\(|\bminecraft_(?:task|server|observe|chat)\s*\(|^\s*MC_[A-Z_]+\s+\{|^\s*\[(?:dbg|GameAgent|adminMission|kernel(?:-out)?|chopDBG|server-command)\]/i;

export async function sendGameChat(bot, { text, player } = {}) {
    if (!bot?.entity || typeof bot.chat !== 'function') return { status: 'failed', reason: 'offline' };
    if (typeof text !== 'string' || !text.trim() || text.length > 180 || /[\x00-\x1f]/.test(text) || text.trim().startsWith('/')) {
        return { status: 'failed', reason: 'Use 1-180 characters of plain chat text, without commands or control characters.' };
    }
    if (player != null && (typeof player !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(player))) {
        return { status: 'failed', reason: 'Invalid player name.' };
    }
    if (INTERNAL_TEXT.test(text)) return { status: 'failed', reason: 'internal_text',
        note: 'Keep tool calls, action diagnostics and raw server records in the local UI. This channel is for actual player conversation.' };
    if (player && player.toLowerCase() === bot.username?.toLowerCase()) return { status: 'failed', reason: 'self_recipient' };
    if (player && bot.players && !Object.keys(bot.players).some(name => name.toLowerCase() === player.toLowerCase()))
        return { status: 'failed', reason: 'player_offline' };
    if (player && typeof bot.whisper !== 'function') return { status: 'failed', reason: 'whisper_unavailable' };
    const now = Date.now(), signature = `${player?.toLowerCase() || '*public*'}:${text.trim().replace(/\s+/g, ' ')}`;
    const recent = recentMessages.get(bot) || new Map();
    for (const [key, stamp] of recent) if (now - stamp >= 60000) recent.delete(key);
    if (recent.has(signature)) return { status: 'failed', reason: 'duplicate', retryAfterMs: 60000 - (now - recent.get(signature)) };
    if (now - (lastSent.get(bot) ?? -Infinity) < 2000) return { status: 'failed', reason: 'rate_limited' };
    lastSent.set(bot, now); recent.set(signature, now);
    while (recent.size > 128) recent.delete(recent.keys().next().value);
    recentMessages.set(bot, recent);
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
            recent.delete(signature);
            finish({ status: 'failed', reason: error.message });
        }
    });
}
