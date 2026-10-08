import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMenu, clickMenuSlot } from '../src/agent/library/menus.js';

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
