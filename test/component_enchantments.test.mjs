import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import data from 'minecraft-data';
const require = createRequire(import.meta.url);
let loadItem = require('prismarine-item');
if (process.env.ENCHANT_ITEM_SOURCE) {
    const module = { exports:{} };
    vm.runInNewContext(readFileSync(process.env.ENCHANT_ITEM_SOURCE,'utf8'), {
        require:createRequire(require.resolve('prismarine-item')),module,exports:module.exports,Buffer,
    });
    loadItem=module.exports;
}
const injectDigging = require('mineflayer/lib/plugins/digging.js');

function fixture() {
    const registry = data('1.20.6'), Item = loadItem('1.20.6');
    const item = (name, enchantments) => Item.fromNotch({
        itemId: registry.itemsByName[name].id, itemCount:1, removeComponents:[],
        components: [{type:'enchantments',data:{enchantments,showTooltip:true}}],
    });
    const slots = [];
    slots[5] = item('iron_helmet', [{id:registry.enchantmentsByName.aqua_affinity.id,level:1}]);
    const bot = { heldItem:item('iron_pickaxe', []), inventory:{ slots },
        entity:{onGround:true,effects:{}}, game:{gameMode:'survival'}, getEquipmentDestSlot:()=>5, on() {} };
    injectDigging(bot);
    return { bot, registry, item };
}
test('1.20.6 empty component enchantments and a helmet cannot crash real Mineflayer digTime', () => {
    const f = fixture(); let received;
    const block = { material:'mineable/pickaxe',digTime(...args) { received=args; return 500; } };
    const before = JSON.stringify(f.bot.heldItem.components);
    assert.equal(f.bot.digTime(block),500);
    assert.deepEqual(received[4],[{name:'aqua_affinity',lvl:1}]);
    assert.equal(JSON.stringify(f.bot.heldItem.components),before,'received components remain unchanged');
});
test('component efficiency levels remain effective and raw IDs are not mistaken for names', () => {
    const f = fixture();
    f.bot.heldItem = f.item('iron_pickaxe',[{id:f.registry.enchantmentsByName.efficiency.id,level:4}]);
    assert.deepEqual(f.bot.heldItem.enchants,[{name:'efficiency',lvl:4}]);
    let enchants;
    f.bot.digTime({digTime(_a,_b,_c,_d,value) { enchants=value; return 100; }});
    assert.deepEqual(enchants,[{name:'efficiency',lvl:4},{name:'aqua_affinity',lvl:1}]);
});
test('legacy NBT enchantments keep their normalized interface', () => {
    const registry=data('1.20.4'), Item=loadItem('1.20.4');
    const item=new Item(registry.itemsByName.iron_pickaxe.id,1);
    item.enchants=[{name:'efficiency',lvl:3}];
    assert.deepEqual(JSON.parse(JSON.stringify(item.enchants)),[{name:'efficiency',lvl:3}]);
});
