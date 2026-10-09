import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import data from 'minecraft-data';
import loadItem from 'prismarine-item';
import { repairLegacyDurability, installItemDurability } from '../src/utils/item_durability.js';

test('actual 1.20.6 registry yields usable vanilla tools and armor, without changing item IDs', () => {
    const registry = data('1.20.6');
    const id = registry.itemsByName.stone_pickaxe.id;
    repairLegacyDurability(registry);
    const Item = loadItem('1.20.6');
    for (const [name, maximum] of [['stone_pickaxe',131], ['iron_pickaxe',250], ['iron_boots',195], ['shield',336]]) {
        const item = Item.fromNotch({itemId:registry.itemsByName[name].id,itemCount:1,
            components:[{type:'damage',data:49}],removeComponents:[]});
        assert.equal(item.maxDurability,maximum,name);
        assert.ok(item.durabilityUsed / item.maxDurability < .85, name+' must remain usable');
    }
    assert.equal(registry.itemsByName.stone_pickaxe.id,id);
    assert.equal(repairLegacyDurability(registry),0,'idempotent on reconnect');
});

test('does not rewrite valid metadata, other versions or non-durable materials', () => {
    const registry = {version:{minecraftVersion:'1.20.6'},itemsByName:{
        iron_pickaxe:{name:'iron_pickaxe',maxDurability:400},
        cobblestone:{name:'cobblestone'}, custom_tool:{name:'custom_tool',maxDurability:1}}};
    repairLegacyDurability(registry);
    assert.equal(registry.itemsByName.iron_pickaxe.maxDurability,400);
    assert.equal(registry.itemsByName.cobblestone.maxDurability,undefined);
    assert.equal(registry.itemsByName.custom_tool.maxDurability,1);
    const other={version:{minecraftVersion:'1.21'},itemsByName:{iron_pickaxe:{name:'iron_pickaxe',maxDurability:1}}};
    assert.equal(repairLegacyDurability(other),0);
    assert.equal(other.itemsByName.iron_pickaxe.maxDurability,1);
});

function botFixture(items) {
    const registry={version:{minecraftVersion:'1.20.6'},itemsByName:{iron_pickaxe:{name:'iron_pickaxe',maxDurability:1}}};
    return Object.assign(new EventEmitter(),{version:'1.20.6',registry,
        inventory:Object.assign(new EventEmitter(),{slots:items})});
}

test('explicit server max_damage including one overrides repaired vanilla defaults', () => {
    const item={name:'iron_pickaxe',maxDurability:1,components:[{type:'max_damage',data:1000}],removedComponents:[]};
    const bot=botFixture([item]);
    assert.equal(installItemDurability(bot),true);
    assert.equal(item.maxDurability,1000);
    const custom={name:'iron_pickaxe',maxDurability:250,components:[{type:'minecraft:max_damage',data:1}],removedComponents:[]};
    bot.inventory.emit('updateSlot',9,null,custom);
    assert.equal(custom.maxDurability,1,'a genuine server-defined one-use tool is not the library placeholder');
    const unbreakable={name:'iron_pickaxe',maxDurability:250,components:[],removedComponents:['max_damage']};
    bot.inventory.emit('updateSlot',9,null,unbreakable);
    assert.equal(unbreakable.maxDurability,null);
});

test('new inventory and hand items are normalized once without duplicate listeners', () => {
    const existing={name:'iron_pickaxe',maxDurability:1,components:[]};
    const bot=botFixture([existing]);
    installItemDurability(bot); installItemDurability(bot);
    assert.equal(existing.maxDurability,250);
    assert.equal(bot.inventory.listenerCount('updateSlot'),1);
    const fresh={name:'iron_pickaxe',maxDurability:1,components:[]};
    bot.inventory.emit('updateSlot',10,null,fresh);
    assert.equal(fresh.maxDurability,250);
    const held={name:'iron_pickaxe',maxDurability:1,components:[{type:'max_damage',data:800}]};
    bot.emit('heldItemChanged',held);
    assert.equal(held.maxDurability,800);
});
