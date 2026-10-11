import { installServerAuth } from '../../../src/utils/server_auth.js';
import settings from '../../../src/agent/settings.js';

// Explicit local operator entry for an already-connected authentication lobby.
// No password arguments, model requests, movement or public chat are involved.
export default async function serverLogin(bot) {
    return installServerAuth(bot, {
        host: settings.host, port: settings.port, username: bot.username,
    }).login();
}
