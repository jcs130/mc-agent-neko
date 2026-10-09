import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMenu, clickMenuSlot, openNpcTradingInterface } from '../src/agent/library/menus.js';

const menuBot = () => ({ currentWindow: { id: 3, type: 'generic_9x3', title: '{"text":"技能罗盘"}', inventoryStart: 2,
    slots: [{ name: 'ender_pearl', count: 1, components: [{ type: 'custom_name', data: { type: 'string', value: '传送地点' } },
        { type: 'lore', data: ['点击查看村庄'] }] }, null, { name: 'diamond', count: 64 }] } });
test('reads actual menu metadata without exposing player inventory or taking actions', () => {
    const bot = menuBot();
    const before = structuredClone(bot);
    const text = describeMenu(bot);
    assert.match(text, /id=3.*技能罗盘/);
    assert.match(text, /\[slot 0\].*传送地点.*村庄/);
    assert.doesNotMatch(text, /diamond/);
    assert.deepEqual(bot, before);
    assert.match(describeMenu({}), /No server menu/);
});
test('rejects stale menus, inventory slots, empty slots and an occupied cursor', async () => {
    const bot = menuBot();
    bot.clickWindow = () => assert.fail('must not click');
    assert.match(await clickMenuSlot(bot, 2, 0), /Menu changed/);
    for (const slot of [-999, 1, 2, 999]) assert.match(await clickMenuSlot(bot, 3, slot), /Invalid or empty/);
    const start = bot.currentWindow.inventoryStart;
    delete bot.currentWindow.inventoryStart;
    assert.match(await clickMenuSlot(bot, 3, 0), /Invalid or empty/);
    bot.currentWindow.inventoryStart = start;
    bot.currentWindow.selectedItem = { name: 'dirt' };
    assert.match(await clickMenuSlot(bot, 3, 0), /Cursor/);
});
test('clicks only the observed menu slot and does not claim a completed teleport', async () => {
    const bot = menuBot();
    const calls = [];
    bot.clickWindow = async (...args) => calls.push(args);
    const result = await clickMenuSlot(bot, 3, 0);
    assert.deepEqual(calls, [[0, 0, 0]]);
    assert.match(result, /Submitted/);
    assert.match(result, /verify the server outcome/);
});

test('generic NPC shops expose real menu slots without invoking the vanilla trade API', async () => {
    const bot = menuBot();
    const window = bot.currentWindow;
    window.type = 'minecraft:generic_9x1';
    bot.currentWindow = null;
    const npc = { id: 18 };
    bot.openEntity = entity => { assert.equal(entity, npc); bot.currentWindow = window; return Promise.resolve(window); };
    bot.openVillager = () => assert.fail('generic menus must not install a vanilla trade-list listener');
    bot.clickWindow = () => assert.fail('inspection must not purchase anything');
    const result = await openNpcTradingInterface(bot, npc);
    assert.equal(result.kind, 'menu');
    assert.equal(bot.currentWindow, window);
    assert.match(result.description, /generic_9x1.*技能罗盘/);
    assert.match(result.description, /slot 0.*传送地点/);
    assert.match(result.description, /!clickWindow/);
    assert.doesNotMatch(result.description, /diamond/);
});

test('vanilla merchants reopen through the trade API to await actual offers', async () => {
    for (const type of ['minecraft:merchant', 'minecraft:villager']) {
        const raw = { id: 3, type }, merchant = { id: 4, type, trades: [{ actual: true }] };
        const calls = [];
        const bot = {
            openEntity: entity => { calls.push(['inspect', entity]); bot.currentWindow = raw; return Promise.resolve(raw); },
            closeWindow: window => { assert.equal(window, raw); calls.push(['close', window.id]); bot.currentWindow = null; },
            openVillager: entity => { calls.push(['offers', entity]); bot.currentWindow = merchant; return Promise.resolve(merchant); },
        };
        const result = await openNpcTradingInterface(bot, 42);
        assert.equal(result.kind, 'merchant');
        assert.equal(result.window, merchant);
        assert.deepEqual(calls, [['inspect', 42], ['close', 3], ['offers', 42]]);
    }
});

test('NPC inspection rejects occupied cursors, closed windows and bounded open failures', async () => {
    for (const bot of [{ currentWindow: { selectedItem: {} } }, { inventory: { selectedItem: {} } }]) {
        bot.openEntity = () => assert.fail('must not interact with an occupied cursor');
        await assert.rejects(openNpcTradingInterface(bot, 18), /Cursor/);
    }
    const bot = { openEntity: () => Promise.resolve({ id: 3 }), openVillager: () => assert.fail('stale window') };
    await assert.rejects(openNpcTradingInterface(bot, 18), /changed or closed/);
    bot.openEntity = () => Promise.reject(new Error('windowOpen did not fire within timeout of 20000ms'));
    await assert.rejects(openNpcTradingInterface(bot, 18), /timeout/);
});
