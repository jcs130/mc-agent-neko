import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import Vec3 from 'vec3';
import * as helpers from '../src/agent/library/container_windows.js';

const source = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const injectInventory = require('mineflayer/lib/plugins/inventory.js');
const data = require('minecraft-data')('1.20.6');
const Item = require('prismarine-item')('1.20.6');
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };

function fixture({ reached = true, cancelOnScan = false, retireOnNavigation = false } = {}) {
    const bot = new EventEmitter();
    Object.assign(bot, { health: 20, interrupt_code: false, currentWindow: null,
        entity: { position: new Vec3(0, 65, 0) },
        inventory: { findInventoryItem: () => ({ type: 1, count: 3 }) } });
    const calls = { opens: 0, closes: 0 }, messages = [];
    bot.activateBlock = async () => { calls.opens++; };
    bot.openContainer = async () => { calls.opens++; return new Promise(() => {}); };
    bot.closeWindow = window => { calls.closes++; if (bot.currentWindow === window) bot.currentWindow = null; };
    const chest = { name: 'chest', position: new Vec3(1, 65, 0) };
    const context = vm.createContext({ ...helpers, log: (_, text) => messages.push(text),
        world: { getNearestBlockAsync: async () => { if (cancelOnScan) bot.interrupt_code = true; return chest; } },
        goToPosition: async () => { if (retireOnNavigation) bot._actionGeneration = 1; return reached; },
    });
    function run(name) {
        const start = source.indexOf(`export async function ${name}(`);
        const tail = source.slice(start + 1), next = /\nexport (?:async )?function /.exec(tail);
        const text = source.slice(start, next ? start + 1 + next.index : undefined).replace('export ', '');
        vm.runInContext(text + `\nglobalThis.run = ${name};`, context);
        return context.run(bot, 'dirt', 1);
    }
    return { bot, calls, messages, run };
}

for (const name of ['viewChest', 'putInChest', 'takeFromChest']) {
    test(`${name} does not interact after the navigation's action generation is retired`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
        const f = fixture({ retireOnNavigation: true });
        let result;
        f.run(name).then(value => { result = value; });
        await flush();
        assert.equal(result, false);
        assert.equal(f.calls.opens, 0);
    });

    test(`${name} does not interact after failed navigation`, async () => {
        const f = fixture({ reached: false });
        let result;
        f.run(name).then(value => { result = value; });
        await flush();
        assert.equal(result, false);
        assert.equal(f.calls.opens, 0);
    });

    test(`${name} leaves the action promptly when safety interrupts a missing window`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
        const f = fixture();
        let result;
        f.run(name).then(value => { result = value; });
        await flush();
        assert.equal(f.calls.opens, 1);
        f.bot.interrupt_code = true;
        t.mock.timers.tick(200);
        await flush();
        assert.equal(result, false, 'must finish before the terminal reconnect watchdog');
        assert.equal(f.bot.listenerCount('windowOpen'), 0);
        assert.equal(f.calls.closes, 0);
    });
}

test('inspection does not call an unopened container empty', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const f = fixture();
    let result;
    f.run('viewChest').then(value => { result = value; });
    await flush();
    t.mock.timers.tick(6000);
    await flush();
    assert.equal(result, false);
    assert.ok(f.messages.some(message => /timeout/i.test(message)));
    assert.ok(f.messages.every(message => !/empty/i.test(message)));
});

test('cancellation during the asynchronous chest scan prevents interaction', async () => {
    const f = fixture({ cancelOnScan: true });
    let result;
    f.run('viewChest').then(value => { result = value; });
    await flush();
    assert.equal(result, false);
    assert.equal(f.calls.opens, 0);
});

function initializedWindow(f, items = []) {
    const window = { id: 7, type: 'minecraft:generic_9x3', containerItems: () => items,
        close: () => f.bot.closeWindow(window), deposit: async () => {}, withdraw: async () => {} };
    f.bot.currentWindow = window;
    f.bot.emit('windowOpen', window);
    return window;
}

test('a successful inspection reports received items and closes only its own window', async () => {
    const f = fixture();
    const pending = f.run('viewChest');
    await flush();
    initializedWindow(f, [{ name: 'bread', count: 4 }]);
    assert.equal(await pending, true);
    assert.ok(f.messages.includes('4 bread'));
    assert.equal(f.calls.closes, 1);
    assert.equal(f.bot.listenerCount('windowOpen'), 0);
    assert.equal(f.bot.listenerCount('end'), 0);
});

for (const reason of ['death', 'end', 'generation']) test(`${reason} releases a missing-window wait`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const f = fixture();
    const pending = f.run('viewChest');
    await flush();
    if (reason === 'death') f.bot.health = 0;
    if (reason === 'end') f.bot.emit('end');
    if (reason === 'generation') f.bot._actionGeneration = 1;
    t.mock.timers.tick(100);
    await flush();
    assert.equal(await pending, false);
    assert.equal(f.bot.listenerCount('windowOpen'), 0);
    assert.equal(f.bot.listenerCount('end'), 0);
});

test('existing menus and carried cursors prevent a new block interaction', async () => {
    for (const occupied of ['window', 'cursor']) {
        const f = fixture();
        if (occupied === 'window') f.bot.currentWindow = { id: 3, type: 'minecraft:merchant' };
        else f.bot.inventory.selectedItem = { name: 'diamond', count: 1 };
        assert.equal(await f.run('viewChest'), false);
        assert.equal(f.calls.opens, 0);
        assert.equal(f.calls.closes, 0);
    }
});

test('an unexpected merchant window remains open and is never described as chest contents', async () => {
    const f = fixture();
    const pending = f.run('viewChest');
    await flush();
    const merchant = { id: 8, type: 'minecraft:merchant', containerItems: () => [{ name: 'diamond', count: 3 }] };
    f.bot.currentWindow = merchant;
    f.bot.emit('windowOpen', merchant);
    assert.equal(await pending, false);
    assert.equal(f.calls.closes, 0);
    assert.equal(f.bot.currentWindow, merchant);
    assert.ok(f.messages.every(message => !message.includes('3 diamond')));
});

test('a superseding window between receipt and continuation is not touched', async () => {
    const f = fixture();
    const pending = f.run('viewChest');
    await flush();
    initializedWindow(f, [{ name: 'bread', count: 4 }]);
    const replacement = { id: 8, type: 'minecraft:merchant' };
    f.bot.currentWindow = replacement;
    assert.equal(await pending, false);
    assert.equal(f.calls.closes, 0);
    assert.equal(f.bot.currentWindow, replacement);
});

test('safety interruption after receipt prevents a deposit', async () => {
    const f = fixture();
    const pending = f.run('putInChest');
    await flush();
    const window = initializedWindow(f);
    let deposits = 0;
    window.deposit = async () => { deposits++; };
    f.bot.interrupt_code = true;
    assert.equal(await pending, false);
    assert.equal(deposits, 0);
    assert.equal(f.calls.closes, 1);
});

test('retiring the action generation leaves a still-current window to its new owner', async () => {
    const f = fixture();
    const pending = f.run('viewChest');
    await flush();
    const window = initializedWindow(f);
    f.bot._actionGeneration = 1;
    assert.equal(await pending, false);
    assert.equal(f.calls.closes, 0);
    assert.equal(f.bot.currentWindow, window);
});

test('a timed-out operation has no listener that can close a later window', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const f = fixture();
    const pending = f.run('viewChest');
    await flush();
    t.mock.timers.tick(6000);
    assert.equal(await pending, false);
    const late = initializedWindow(f, [{ name: 'bread', count: 4 }]);
    assert.equal(f.calls.closes, 0);
    assert.equal(f.bot.currentWindow, late);
    assert.equal(f.bot.listenerCount('windowOpen'), 0);
});

test('activation rejection returns a real failure and cleans up owned listeners', async () => {
    const f = fixture();
    f.bot.activateBlock = async () => { throw new Error('interaction rejected'); };
    assert.equal(await f.run('viewChest'), false);
    assert.ok(f.messages.some(message => message.includes('interaction rejected')));
    assert.equal(f.bot.listenerCount('windowOpen'), 0);
    assert.equal(f.bot.listenerCount('end'), 0);
});

test('Mineflayer initializes actual slots and transfer methods before our window wait resolves', async () => {
    const bot = new EventEmitter();
    const client = new EventEmitter();
    const writes = [];
    client.write = (name, packet) => writes.push({ name, packet });
    Object.assign(bot, { _client: client, registry: data, version: '1.20.6', health: 20,
        QUICK_BAR_START: 36, supportFeature: name => data.supportFeature(name),
        lookAt: async () => {}, swingArm() {}, entity: { position: new Vec3(0, 65, 0) } });
    injectInventory(bot, { hideErrors: true });
    const pending = helpers.openChestWindow(bot, { name: 'chest', position: new Vec3(1, 65, 0) });
    await flush();
    assert.ok(writes.some(write => write.name === 'block_place'));
    client.emit('open_window', { windowId: 7, inventoryType: 'minecraft:generic_9x3', windowTitle: 'Chest', slotCount: 27 });
    const items = Array.from({ length: 63 }, () => Item.toNotch(null));
    items[0] = Item.toNotch(new Item(data.itemsByName.bread.id, 4));
    client.emit('window_items', { windowId: 7, items, carriedItem: Item.toNotch(null), stateId: 1 });
    const window = await pending;
    assert.equal(window, bot.currentWindow);
    assert.equal(window.containerItems()[0].name, 'bread');
    assert.equal(window.containerItems()[0].count, 4);
    assert.equal(typeof window.deposit, 'function');
    assert.equal(typeof window.withdraw, 'function');
    assert.equal(helpers.closeOwnedChestWindow(bot, window), true);
    assert.ok(writes.some(write => write.name === 'close_window' && write.packet.windowId === 7));
    assert.equal(bot.currentWindow, null);
});

test('the real viewChest command wrapper preserves a failed skill result for the planner', async () => {
    const actions = readFileSync(new URL('../src/agent/commands/actions.js', import.meta.url), 'utf8');
    const wrapper = actions.slice(actions.indexOf('function runAsAction '), actions.indexOf('function targetedDigFeedback('));
    const start = actions.indexOf("        name: '!viewChest',");
    const end = actions.indexOf('\n    },', start);
    const command = '{' + actions.slice(start, end) + '\n}';
    const context = vm.createContext({ skills: { viewChest: async () => false } });
    vm.runInContext(wrapper + `\nglobalThis.actionsList = [${command}]; globalThis.run = actionsList[0].perform;`, context);
    const agent = { bot: {}, actions: { runAction: async (_, action) => {
        await action();
        return { success: true, message: 'Chest opening timeout; contents unknown.' };
    } } };
    assert.match(await context.run(agent), /^Action failed: !viewChest/);
});
