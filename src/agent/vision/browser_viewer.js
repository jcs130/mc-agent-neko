import settings from '../settings.js';
import { createRequire } from 'node:module';
// Load only the browser transport: the package entry also loads headless-gl.
const mineflayerViewer = createRequire(import.meta.url)('prismarine-viewer/lib/mineflayer');

export function addBrowserViewer(bot, count_id) {
    if (settings.render_bot_view)
        mineflayerViewer(bot, { port: 3000+count_id, firstPerson: true, });
}
