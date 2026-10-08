import settings from '../settings.js';
import { createRequire } from 'node:module';
import { startViewerLanProxy } from './viewer_lan_proxy.js';
// Load only the browser transport: the package entry also loads headless-gl.
const mineflayerViewer = createRequire(import.meta.url)('prismarine-viewer/lib/mineflayer');

export async function addBrowserViewer(bot, count_id) {
    if (!settings.render_bot_view) return;
    const port = Number(settings.viewer_port || 3000) + count_id;
    if (settings.viewer_type !== 'modern') {
        mineflayerViewer(bot, { port, firstPerson: true });
        bot.viewer.info = { available: true, type: 'prismarine', url: `http://127.0.0.1:${port}/`, views: ['first'] };
        return;
    }
    const { startModernViewer } = await import('./modern/host.mjs');
    const handle = await startModernViewer(bot, { port,
        assetsDir: settings.modern_viewer_assets_dir, speakerName: bot.username });
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
        async close() { await lan?.close(); await handle.close(); } };
    console.log(`Modern viewer ready: ${handle.url}/dungeon/${lan ? ` | LAN ${lan.url}/dungeon/` : ''}`);
}
