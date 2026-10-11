import settings from '../settings.js';
import { createRequire } from 'node:module';
import { startViewerLanProxy } from './viewer_lan_proxy.js';
const require = createRequire(import.meta.url);

// GameInformation owns the connection's early login packets. Never replay a
// different bot/session or a partially decoded packet as our player state.
export function cachedViewerSkills(bot, gameInformation) {
    if (!gameInformation || gameInformation.bot !== bot || gameInformation.closed !== false) return null;
    const channel = 'mcagent:state';
    const entry = gameInformation.presentation?.channels?.[channel];
    if (!entry || entry.encoding !== 'json' || !Array.isArray(entry.truncated) || entry.truncated.length
        || !Number.isFinite(entry.observedAt) || entry.observedAt <= 0 || entry.observedAt > Date.now() + 30000
        || !Number.isInteger(entry.byteLength) || entry.byteLength < 1 || entry.byteLength > 65536) return null;
    try {
        const data = Buffer.from(JSON.stringify(entry.value));
        return data.length <= 65536 ? { channel, data, observedAt: entry.observedAt } : null;
    } catch { return null; }
}

export async function addBrowserViewer(bot, count_id = 0, { gameInformation } = {}) {
    if (!settings.render_bot_view) return;
    const port = Number(settings.viewer_port ?? 3000) + count_id;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid viewer port');
    if (settings.viewer_type === 'modern' && bot.version !== '1.20.6') {
        throw new Error('The modern viewer currently requires Minecraft 1.20.6 assets and protocol');
    }
    await bot.viewer?.close?.();
    if (settings.viewer_type !== 'modern') {
        // Load only the browser transport: the package entry also loads headless-gl.
        const mineflayerViewer = require('prismarine-viewer/lib/mineflayer');
        mineflayerViewer(bot, { port, firstPerson: true });
        bot.viewer.info = { available: true, type: 'prismarine', url: `http://127.0.0.1:${port}/`, views: ['first'] };
        return;
    }
    const { startModernViewer } = await import('./modern/host.mjs');
    const handle = await startModernViewer(bot, { port,
        assetsDir: settings.modern_viewer_assets_dir, speakerName: bot.username,
        selfSkinPath: settings.modern_viewer_self_skin,
        selfSkinModel: settings.modern_viewer_self_skin_model ?? 'slim',
        observerState: settings.modern_viewer_observer_state === true,
        // Asset validation is asynchronous. Read the connection cache only
        // when the host is ready to attach its packet listeners.
        getInitialSkillsPacket: () => cachedViewerSkills(bot, gameInformation),
        maxSessions: settings.modern_viewer_max_sessions ?? 8 });
    let lan;
    try {
        if (settings.modern_viewer_lan_address) lan = await startViewerLanProxy({
            address: settings.modern_viewer_lan_address,
            prefixLength: settings.modern_viewer_lan_prefix ?? 24, port, backendPort: port,
        });
    } catch (error) { await handle.close(); throw error; }
    bot.viewer = { info: { available: true, type: 'modern', url: `${handle.url}/`,
        lan_url: lan ? `${lan.url}/` : null, username: bot.username, version: bot.version,
        views: ['first', 'third', 'dungeon'] },
        async close() { try { await lan?.close(); } finally { await handle.close(); } } };
    console.log(`Modern viewer ready: ${handle.url}/dungeon/${lan ? ` | LAN ${lan.url}/dungeon/` : ''}`);
}
