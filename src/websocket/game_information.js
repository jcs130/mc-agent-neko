import { randomUUID, createHash } from 'node:crypto';
import { plainText } from '../agent/library/books.js';
import { activeServerCommand } from './server_commands.js';

// Observation only: this module never sends game packets, chat or actions.
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const point = value => value ? { x: finite(value.x), y: finite(value.y), z: finite(value.z) } : null;
export function gameText(value) {
    if (value == null) return '';
    if (typeof value === 'string') {
        try { return gameText(JSON.parse(value)); } catch { return value.replace(/§[0-9a-fk-or]/gi, ''); }
    }
    if (Array.isArray(value)) return value.map(gameText).join('');
    if (typeof value === 'object') {
        if (['compound', 'string', 'list'].includes(value.type) && value.value != null) return gameText(value.value);
        if (value.toString && value.toString !== Object.prototype.toString) {
            try { return String(value).replace(/§[0-9a-fk-or]/gi, ''); } catch { /* use components */ }
        }
        return gameText(value.text ?? value.translate ?? '') +
            (Array.isArray(value.with) ? ' ' + value.with.map(gameText).join(' ') : '') +
            (Array.isArray(value.extra) ? value.extra.map(gameText).join('') : '');
    }
    return String(value);
}

export function boundedGameValue(value, maxChars = 96000) {
    const clipped = [], seen = new WeakSet();
    let left = maxChars;
    function visit(input, depth, location) {
        if (input == null || typeof input === 'boolean') return input ?? null;
        if (typeof input === 'number') return finite(input);
        if (typeof input === 'bigint') return String(input);
        if (typeof input === 'string') {
            const size = Math.max(0, Math.min(input.length, 8192, left));
            left -= size;
            if (size < input.length) clipped.push(location);
            return input.slice(0, size);
        }
        if (typeof input !== 'object') return null;
        if (depth >= 9 || seen.has(input) || left <= 0) { clipped.push(location); return null; }
        if (Buffer.isBuffer(input) || ArrayBuffer.isView(input)) return { byteLength: input.byteLength };
        seen.add(input);
        const entries = Array.isArray(input) ? input.entries() : Object.entries(input);
        const output = Array.isArray(input) ? [] : {};
        let count = 0;
        for (const [key, item] of entries) {
            if (++count > 128 || left <= 0) { clipped.push(location); break; }
            if (['__proto__', 'constructor', 'prototype'].includes(String(key))) continue;
            left -= String(key).length + 8;
            output[key] = visit(item, depth + 1, `${location}.${key}`);
        }
        seen.delete(input);
        return output;
    }
    return { value: visit(value, 0, '$'), truncated: [...new Set(clipped)].slice(0, 32) };
}

function itemState(item, slot) {
    if (!item) return null;
    const result = { slot }, unavailable = [];
    for (const key of ['name', 'count', 'type', 'displayName', 'durabilityUsed', 'maxDurability', 'enchants']) {
        try { result[key] = item[key]; } catch { result[key] = null; unavailable.push(key); }
    }
    try {
        result.customName = gameText(item.customName);
        result.lore = (item.customLore ?? item.components?.find(value => /^(minecraft:)?lore$/.test(value.type))?.data ?? []).map(value => plainText(value));
        const book = item.components?.find(value => /^(minecraft:)?(written|writable)_book_content$/.test(value.type))?.data;
        if (Array.isArray(book?.pages)) result.book = {
            title: plainText(book.rawTitle ?? book.title), author: plainText(book.author), pageCount: book.pages.length,
            pages: book.pages.slice(0, 128).map((page, index) => ({ page: index + 1, text: plainText(page.content ?? page.rawContent ?? page) })),
            pagesOmitted: Math.max(0, book.pages.length - 128),
        };
    } catch { unavailable.push('readableItemText'); }
    if (finite(result.durabilityUsed) != null && finite(result.maxDurability) != null && result.durabilityUsed > result.maxDurability) {
        result.durabilityInconsistent = true;
        result.durabilityNote = 'Received damage exceeds library maximum; do not infer remaining lifetime from this maximum.';
    }
    for (const key of ['metadata', 'components', 'nbt']) {
        try { result[key] = item[key]; } catch { result[key] = null; unavailable.push(key); }
    }
    if (unavailable.length) result.unavailableFields = unavailable;
    return result;
}
function blockState(block) {
    if (!block) return null;
    let properties = null;
    try { properties = block.getProperties?.() ?? null; } catch { /* unloading column */ }
    return { name: block.name, position: point(block.position), stateId: block.stateId, properties,
        biome: block.biome?.name ?? block.biome, light: block.light, skyLight: block.skyLight,
        signText: block.signText, blockEntity: block.blockEntity };
}
function distance(a, b) {
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity;
}

export function collectGameState(agent, presentation = {}) {
    const bot = agent.bot, pos = bot.entity?.position;
    const slots = bot.inventory?.slots ?? [], counts = {};
    slots.forEach((item, slot) => {
        // Player storage + offhand; crafting output and equipped armour are separate.
        if (item && slot >= 9) counts[item.name] = (counts[item.name] ?? 0) + item.count;
    });
    const blockAt = (x, y, z) => {
        try { return bot.blockAt?.(pos.offset(x, y, z)) ?? null; } catch { return null; }
    };
    const below = pos ? blockAt(0, -1, 0) : null;
    const blocks = new Map();
    if (pos) for (let x = -4; x <= 4; x += 2) for (let y = -2; y <= 2; y += 2) for (let z = -4; z <= 4; z += 2) {
        const block = blockAt(x, y, z);
        if (block && !['air', 'cave_air', 'void_air'].includes(block.name)) blocks.set(`${x},${y},${z}`, blockState(block));
    }
    const entities = Object.values(bot.entities ?? {}).filter(entity => entity.id !== bot.entity?.id && distance(pos, entity.position) <= 32)
        .sort((a, b) => distance(pos, a.position) - distance(pos, b.position));
    const window = bot.currentWindow;
    const scoreboards = Object.values(bot.scoreboards ?? {}).slice(0, 12).map(board => ({
        name: board.name, title: gameText(board.title),
        items: (board.items ?? []).slice(0, 64).map(item => ({ name: gameText(item.displayName ?? item.name), value: item.value })),
    }));
    return {
        self: { username: bot.username, health: finite(bot.health), food: finite(bot.food),
            saturation: finite(bot.foodSaturation), oxygen: finite(bot.oxygenLevel), experience: bot.experience ?? null,
            position: point(pos), velocity: point(bot.entity?.velocity), yaw: finite(bot.entity?.yaw), pitch: finite(bot.entity?.pitch),
            onGround: bot.entity?.onGround ?? null, sleeping: bot.isSleeping ?? null,
            effects: bot.entity?.effects ?? {}, attributes: bot.entity?.attributes ?? {},
            equipment: slots.slice(5, 9).map((item, i) => itemState(item, i + 5)), offhand: itemState(slots[45], 45) },
        world: { version: bot.version, dimension: bot.game?.dimension, gameMode: bot.game?.gameMode,
            minY: bot.game?.minY, height: bot.game?.height, difficulty: bot.game?.difficulty,
            hardcore: bot.game?.hardcore, timeOfDay: bot.time?.timeOfDay,
            age: bot.time?.age, weather: { rain: finite(bot.rainState), thunder: finite(bot.thunderState) },
            biome: below?.biome?.name ?? below?.biome ?? null, spawnPoint: point(bot.spawnPoint) },
        inventory: { counts, selectedHotbar: bot.quickBarSlot, held: itemState(bot.heldItem),
            slots: slots.map(itemState).filter(Boolean) },
        nearby: { radius: 32, entities: entities.slice(0, 32).map(entity => ({ id: entity.id, name: entity.name,
            type: entity.type, username: entity.username, displayName: gameText(entity.displayName),
            customName: gameText(entity.metadata?.[2]),
            position: point(entity.position), distance: Math.round(distance(pos, entity.position) * 10) / 10,
            health: finite(entity.health), equipment: entity.equipment?.map(item => itemState(item)),
            metadata: entity.metadata })), entitiesOmitted: Math.max(0, entities.length - 32),
            onlinePlayers: Object.keys(bot.players ?? {}).slice(0, 64),
            under: blockState(below), feet: pos ? blockState(blockAt(0, 0, 0)) : null,
            head: pos ? blockState(blockAt(0, 1, 0)) : null,
            sampledBlocks: [...blocks.values()], sampleRadius: 4,
            signs: presentation.signs ?? [] },
        window: window ? { id: window.id, type: window.type, title: gameText(window.title),
            inventoryStart: window.inventoryStart, inventoryEnd: window.inventoryEnd,
            selectedItem: itemState(window.selectedItem), slots: window.slots?.map(itemState).filter(Boolean),
            properties: presentation.windowProperties ?? {}, trades: presentation.trades ?? null } : null,
        activity: { action: agent.actions?.currentActionLabel ?? null, skill: bot._currentSkill ?? null,
            mobility: bot._mobility ?? null, digging: blockState(bot.targetDigBlock),
            usingHeldItem: bot.usingHeldItem ?? null },
        server: { welcome: presentation.welcome, scoreboards,
            protection: bot.serverProtection?.snapshot() ?? null,
            bossBars: Array.isArray(bot.bossBars) ? bot.bossBars.map(bar => ({ id: bar.entityUUID,
                title: gameText(bar.title), health: bar.health, color: bar.color, dividers: bar.dividers })) : presentation.bossBars,
            tablist: { header: gameText(bot.tablist?.header), footer: gameText(bot.tablist?.footer) },
            titles: presentation.titles, actionBar: presentation.actionBar,
            commandCatalog: presentation.commandCatalog, playerAbilities: presentation.playerAbilities,
            channels: presentation.channels, teams: presentation.teams, signs: presentation.signs,
            windowProperties: presentation.windowProperties, trades: presentation.trades,
            recipeBook: presentation.recipeBook, advancements: presentation.advancements },
        coverage: { source: 'own Mineflayer connection and loaded game state',
            unavailable: ['unreceived server data', 'unloaded terrain', 'undecoded binary plugin payloads'],
            nearbyBlocks: 'loaded samples, not a complete map', maxNearbyEntities: 32 },
    };
}

export class GameInformation {
    constructor(agent, publish, { intervalMs = 3000, flushMs = 250, now = Date.now, commandPrefix = '@neko' } = {}) {
        this.agent = agent; this.bot = agent.bot; this.publish = publish; this.now = now;
        this.sessionId = randomUUID(); this.eventSeq = 0; this.stateSeq = 0;
        this.events = []; this.pending = []; this.recent = new Map(); this.listeners = [];
        this.presentation = { bossBars: {}, channels: {}, advancements: {}, titles: {}, actionBar: null, signs: [] };
        this.presentation.welcome = { sessionId: this.sessionId, startedAt: now(), captureUntil: now() + 30000,
            messages: [], truncated: false, omittedMessages: 0 };
        this.welcomeKeys = new Set(); this.welcomeChars = 0;
        this.closed = false; this.dropped = 0; this.flushMs = flushMs;
        this.online = this.bot._client?.state === 'play';
        this.on(this.bot, 'login', () => {
            // Observation starts before login. Anchor the window to the real
            // login while retaining any welcome text already received.
            this.presentation.welcome.startedAt = now();
            this.presentation.welcome.captureUntil = now() + 30000;
        });
        const structured = new WeakSet();
        const own = player => player === this.bot.username || player === agent.name;
        const chat = (kind, player, text, _translate, json) => {
            if (json && typeof json === 'object') structured.add(json);
            if (own(player)) return;
            this.event(kind, { player, text: gameText(text), source: 'player',
                data: { onlinePlayer: Boolean(this.bot.players?.[player]),
                    reservedCommand: kind === 'chat' && Boolean(this.bot.players?.[player]) &&
                        (!commandPrefix || text.trimStart().startsWith(commandPrefix) || text.trimStart().startsWith('!')) } });
        };
        this.on(this.bot, 'chat', (...args) => chat('chat', ...args));
        this.on(this.bot, 'whisper', (...args) => chat('whisper', ...args));
        this.on(this.bot, 'message', (json, position, sender, verified) => {
            const solicitedCommand = position === 'system' && !sender ? activeServerCommand(this.bot)?.command : undefined;
            queueMicrotask(() => { try {
            if (this.closed || (json && typeof json === 'object' && structured.has(json))) return;
            if (sender && sender === this.bot.player?.uuid) return;
            const text = gameText(json);
            if (text.startsWith(`<${this.bot.username}>`)) return;
            const record = position === 'system' && !sender && /^(MC_[A-Z_]+)\s+(\{.*\})$/.exec(text);
            if (record) {
                try {
                    this.event('server_record', { text, source: 'server', data: { kind: record[1], value: JSON.parse(record[2]), ...(solicitedCommand ? { solicitedCommand } : {}) } });
                    return;
                } catch { /* malformed JSON remains observable text */ }
            }
            this.event(position === 'game_info' ? 'actionbar' : position === 'chat' ? 'chat' : 'system',
                { text, source: position === 'chat' ? 'received_chat' : 'server', data: { sender, verified, translation: json?.translate, ...(solicitedCommand ? { solicitedCommand } : {}) } });
        } catch { /* malformed text is not a game failure */ } });
        });
        this.on(this.bot, 'actionBar', value => this.actionBar(gameText(value)));
        this.on(this.bot, 'serverProtection', value => this.event('protection', {
            text: value.text, source: 'server_permission_check',
            data: boundedGameValue(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'text')), 4000).value,
        }));
        this.on(this.bot, 'title', (value, type = 'title') => {
            this.presentation.titles[type] = { text: gameText(value), observedAt: now() };
            this.event(type, { text: gameText(value), source: 'server' });
        });
        this.on(this.bot, 'title_clear', () => { this.presentation.titles = {}; });
        for (const name of ['bossBarCreated', 'bossBarUpdated', 'bossBarDeleted']) this.on(this.bot, name, bar => {
            const id = bar.entityUUID ?? bar.uuid ?? bar.id;
            if (name === 'bossBarDeleted') delete this.presentation.bossBars[id];
            else this.presentation.bossBars[id] = { title: gameText(bar.title), health: bar.health, color: bar.color, dividers: bar.dividers };
            while (Object.keys(this.presentation.bossBars).length > 64) delete this.presentation.bossBars[Object.keys(this.presentation.bossBars)[0]];
        });
        for (const name of ['death', 'spawn', 'respawn', 'kicked', 'end', 'sleep', 'wake']) this.on(this.bot, name, reason => {
            if (['spawn', 'respawn'].includes(name)) this.online = true;
            if (['kicked', 'end'].includes(name)) this.online = false;
            if (['respawn', 'end'].includes(name)) this.resetPresentation();
            this.event(name, { text: typeof reason === 'string' ? reason : gameText(reason), source: 'game',
                data: { position: point(this.bot.entity?.position) } });
            this.sendState();
        });
        this.on(this.bot, 'entityHurt', entity => {
            if (entity.id === this.bot.entity?.id) this.event('damage', { source: 'game', data: { health: finite(this.bot.health) } });
        });
        this.on(this.bot, 'windowOpen', window => {
            this.presentation.trades = null; this.presentation.windowProperties = {};
            this.event('window_open', { source: 'game', text: gameText(window.title), data: { type: window.type, id: window.id } });
        });
        this.on(this.bot, 'windowClose', () => { this.presentation.trades = null; this.presentation.windowProperties = {}; });
        this.on(this.bot._client, 'custom_payload', packet => this.pluginPacket(packet));
        this.on(this.bot._client, 'declare_commands', packet => {
            const nodes = packet.nodes ?? [], root = nodes[packet.rootIndex ?? 0];
            const commands = (root?.children ?? []).map(index => nodes[index]).filter(Boolean);
            this.presentation.commandCatalog = {
                source: 'server-declared commands visible to this account; declaration does not prove execution permission',
                count: commands.length, namesText: commands.map(node => node.extraNodeData?.name ?? node.name).join(', '),
                argumentDetailsOmitted: Math.max(0, commands.length - 32),
                commands: commands.slice(0, 32).map(node => ({ name: node.extraNodeData?.name ?? node.name,
                    arguments: (node.children ?? []).slice(0, 16).map(index => {
                        const child = nodes[index];
                        return { name: child?.extraNodeData?.name ?? child?.name,
                            parser: child?.extraNodeData?.parser ?? child?.parser };
                    }) })),
            };
        });
        this.on(this.bot._client, 'abilities', packet => { this.presentation.playerAbilities = boundedGameValue(packet, 2000).value; });
        this.on(this.bot._client, 'tile_entity_data', packet => {
            if (!/sign/i.test(gameText(packet.nbtData?.value?.id?.value))) return;
            this.presentation.signs.push({ position: packet.location, nbt: packet.nbtData, observedAt: now() });
            this.presentation.signs = this.presentation.signs.slice(-16);
        });
        this.on(this.bot._client, 'advancements', packet => {
            if (packet.reset || !this.presentation.advancements.entries) this.presentation.advancements = { progress: {}, entries: {}, omitted: 0 };
            const state = this.presentation.advancements;
            for (const id of packet.identifiers ?? []) { delete state.entries[id]; delete state.progress[id]; }
            for (const entry of packet.advancementMapping ?? []) state.entries[entry.key] = {
                title: gameText(entry.value?.displayData?.title), description: gameText(entry.value?.displayData?.description),
                parent: entry.value?.parentId, requirements: entry.value?.requirements,
            };
            for (const entry of packet.progressMapping ?? []) state.progress[entry.key] = boundedGameValue(entry.value, 2000).value;
            for (const map of [state.entries, state.progress]) while (Object.keys(map).length > 128) {
                delete map[Object.keys(map)[0]]; state.omitted++;
            }
            this.event('advancement', { source: 'server', data: boundedGameValue({ progress: packet.progressMapping }, 4000).value });
        });
        for (const name of ['trade_list', 'window_items', 'craft_progress_bar', 'unlock_recipes']) this.on(this.bot._client, name, packet => {
            if (name === 'trade_list') this.presentation.trades = boundedGameValue(packet, 12000).value;
            if (name === 'unlock_recipes') this.presentation.recipeBook = boundedGameValue(packet, 6000).value;
            if (name === 'craft_progress_bar') {
                this.presentation.windowProperties ??= {};
                this.presentation.windowProperties[packet.property] = packet.value;
                while (Object.keys(this.presentation.windowProperties).length > 64) delete this.presentation.windowProperties[Object.keys(this.presentation.windowProperties)[0]];
            }
        });
        this.on(this.bot._client, 'teams', packet => {
            this.presentation.teams ??= {};
            if (packet.mode === 1) delete this.presentation.teams[packet.team];
            else this.presentation.teams[packet.team] = boundedGameValue(packet, 4000).value;
            while (Object.keys(this.presentation.teams).length > 64) delete this.presentation.teams[Object.keys(this.presentation.teams)[0]];
        });
        this.timer = setInterval(() => this.sendState(), intervalMs);
        this.timer.unref?.();
    }

    on(emitter, name, fn) {
        if (!emitter?.on) return;
        const guarded = (...args) => { try { fn(...args); } catch { /* observation cannot stop gameplay */ } };
        emitter.on(name, guarded); this.listeners.push(() => emitter.removeListener(name, guarded));
    }

    actionBar(text) {
        this.presentation.actionBar = text ? { text, observedAt: this.now() } : null;
        this.event('actionbar', { text, source: 'server' });
    }

    event(kind, detail) {
        if (this.closed) return;
        const now = this.now(), text = String(detail.text ?? '').trim();
        if (!text && !detail.data) return;
        if (kind === 'actionbar') this.presentation.actionBar = text ? { text, observedAt: now } : null;
        const fingerprint = JSON.stringify([kind, detail.player, text, detail.data]);
        const previous = this.recent.get(fingerprint);
        this.recent.set(fingerprint, now);
        for (const [key, time] of this.recent) if (now - time > 10000 || this.recent.size > 512) this.recent.delete(key);
        if (previous != null && now - previous < (kind === 'actionbar' ? 5000 : 1000)) return;
        const bounded = boundedGameValue({ id: `${this.sessionId}:${++this.eventSeq}`, kind, observedAt: now,
            ...detail, text: text.slice(0, 8192) }, 16000);
        const event = { ...bounded.value, truncated: text.length > 8192 || bounded.truncated.length > 0 };
        this.captureWelcome(event);
        this.events.push(event); this.pending.push(event);
        if (this.events.length > 128) { this.events.shift(); this.dropped++; }
        if (this.pending.length > 64) { this.pending.shift(); this.dropped++; }
        if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushEvents(), this.flushMs);
    }

    captureWelcome(event) {
        const welcome = this.presentation.welcome;
        if (event.observedAt > welcome.captureUntil || event.source !== 'server' ||
            !['system', 'title', 'subtitle'].includes(event.kind) ||
            event.data?.solicitedCommand || event.data?.sender || !event.text) return;
        const key = createHash('sha256').update(event.kind + '\0' + event.text).digest('hex');
        if (this.welcomeKeys.has(key)) return;
        const left = 8192 - this.welcomeChars;
        if (welcome.messages.length >= 32 || left <= 0) {
            welcome.truncated = true; welcome.omittedMessages++;
            return;
        }
        const text = event.text.slice(0, left), truncated = event.truncated || text.length < event.text.length;
        welcome.messages.push({ id: event.id, kind: event.kind, source: 'server',
            observedAt: event.observedAt, text, truncated });
        welcome.truncated ||= truncated;
        this.welcomeKeys.add(key); this.welcomeChars += text.length;
    }

    pluginPacket(packet) {
        const channel = String(packet.channel ?? '').slice(0, 200), bytes = packet.data;
        if (!Buffer.isBuffer(bytes)) return;
        let value = null, encoding = 'binary';
        if (bytes.length <= 32768) {
            const text = bytes.toString('utf8');
            const controls = [...text].some(char => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char));
            if (!text.includes('\uFFFD') && !controls) {
                encoding = 'utf8';
                try { value = JSON.parse(text); encoding = 'json'; } catch { value = text; }
            }
        }
        const parsed = boundedGameValue(value, 20000);
        const entry = { channel, encoding, byteLength: bytes.length, observedAt: this.now(),
            value: parsed.value, truncated: parsed.truncated, sha256: createHash('sha256').update(bytes).digest('hex') };
        const same = this.presentation.channels[channel]?.sha256 === entry.sha256;
        delete this.presentation.channels[channel];
        this.presentation.channels[channel] = entry;
        while (Object.keys(this.presentation.channels).length > 16) delete this.presentation.channels[Object.keys(this.presentation.channels)[0]];
        if (!same) this.event('plugin_message', { source: 'server', data: entry });
    }

    resetPresentation() {
        // Respawn/dimension changes do not create a new server connection.
        // A new GameInformation instance owns the next connection's cache.
        this.presentation = { welcome: this.presentation.welcome,
            bossBars: {}, channels: {}, advancements: {}, titles: {}, actionBar: null, signs: [] };
        this.events = []; this.pending = []; this.recent.clear();
    }

    flushEvents() {
        clearTimeout(this.flushTimer); this.flushTimer = null;
        if (!this.closed && this.pending.length) {
            const pending = this.pending.slice();
            try {
                this.publish({ type: 'game_events', schemaVersion: 1, sessionId: this.sessionId,
                    observedAt: this.now(), events: pending, droppedEvents: this.dropped });
                this.pending.splice(0, pending.length);
            } catch { /* the next snapshot still includes recent events */ }
        }
    }

    snapshot() {
        const now = this.now();
        if (this.presentation.actionBar && now - this.presentation.actionBar.observedAt > 10000) this.presentation.actionBar = null;
        for (const [kind, value] of Object.entries(this.presentation.titles)) if (now - value.observedAt > 15000) delete this.presentation.titles[kind];
        // A large book/plugin payload must not consume another section's budget.
        const raw = collectGameState(this.agent, this.presentation), state = {}, truncated = [];
        const budgets = { self: 8000, world: 2000, activity: 3000, server: 20000, window: 24000,
            inventory: 24000, nearby: 12000, coverage: 1000 };
        for (const [section, budget] of Object.entries(budgets)) {
            const bounded = boundedGameValue(raw[section], budget);
            state[section] = bounded.value;
            truncated.push(...bounded.truncated.map(path => `$.${section}${path.slice(1)}`));
        }
        return { type: 'game_state', schemaVersion: 1, sessionId: this.sessionId, seq: ++this.stateSeq,
            observedAt: now, online: this.online && this.bot._client?.state === 'play' && this.bot._client?.socket?.destroyed !== true, state,
            recentEvents: this.events.filter(event => now - event.observedAt < 120000).slice(-48),
            truncated: truncated.slice(0, 32), droppedEvents: this.dropped };
    }

    sendState(client) {
        if (this.closed) return;
        try {
            const frame = this.snapshot();
            if (client) client.send(JSON.stringify(frame));
            else this.publish(frame);
        } catch { /* incomplete spawn state must not stop the game */ }
    }

    close() {
        this.closed = true; clearInterval(this.timer); clearTimeout(this.flushTimer);
        for (const dispose of this.listeners) dispose();
        this.listeners = []; this.pending = [];
    }
}
