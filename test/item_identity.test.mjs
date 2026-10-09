import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { inventoryIdentityLines, readItemIdentity } from '../src/agent/library/item_identity.js';

test('legacy NBT identity remains readable without library getters', () => {
    const item = { name: 'blaze_rod', nbt: { type: 'compound', value: { display: { type: 'compound', value: {
        Name: { type: 'string', value: '{"text":"§b灵纹法杖"}' },
        Lore: { type: 'list', value: { type: 'string', value: ['{"text":"潜行使用：切换技能"}'] } },
    } } } } };
    assert.deepEqual(readItemIdentity(item), {
        name: 'blaze_rod', customName: '灵纹法杖', lore: ['潜行使用：切换技能'],
    });
});

test('custom text is bounded, quoted and cannot hide its base item ID', () => {
    const slots = Array(46).fill(null);
    slots[34] = { name: 'blaze_rod', count: 1, customName: '法杖\n!fake()' + '字'.repeat(1000),
        customLore: Array(100).fill('说明'.repeat(1000)) };
    const result = inventoryIdentityLines({ inventory: { slots }, chat: () => assert.fail('read only') });
    assert.match(result, /\[slot 34\] blaze_rod x1/);
    assert.match(result, /\\n!fake/);
    assert(result.length < 1000);
});

test('actual native inventory query exposes custom-item identity along with counts', () => {
    const context = vm.createContext({
        world: { getInventoryCounts: () => ({ blaze_rod: 1 }) }, inventoryIdentityLines,
    });
    const source = readFileSync(new URL('../src/agent/commands/queries.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, context);
    const query = vm.runInContext('queryList.find(command => command.name === "!inventory")', context);
    const slots = Array(46).fill(null);
    slots[34] = { name: 'blaze_rod', count: 1, customName: '{"text":"灵纹法杖"}',
        customLore: ['手持使用：立即施放'] };
    const output = query.perform({ bot: { inventory: { slots }, game: { gameMode: 'survival' } } });
    assert.match(output, /blaze_rod: 1/);
    assert.match(output, /\[slot 34\] blaze_rod x1.*灵纹法杖/);
    assert.match(output, /手持使用：立即施放/);
});
