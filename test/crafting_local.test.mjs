import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import data from 'minecraft-data';
import injectCraft from 'mineflayer/lib/plugins/craft.js';
import { makeableRecipes } from '../src/utils/crafting_recipes.js';

const registry = data('1.20.6');
async function localCraft(name, stock) {
    const logs = [], attempts = [];
    const bot = { registry, entity: { position: { distanceTo: () => 0 } },
        inventory: {
            items: () => Object.entries(stock).map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count })),
            count: id => stock[registry.items[id]?.name] || 0,
        }, clearControlStates() {} };
    injectCraft(bot);
    bot.craft = async (recipe, n, table) => attempts.push({recipe,n,table});
    let tableLookups = 0;
    const context = vm.createContext({ makeableRecipes, log: (_,s) => logs.push(s),
        mc: { getItemId: n => registry.itemsByName[n]?.id,
            getItemCraftingRecipes: n => bot.recipesAll(registry.itemsByName[n].id,null,true),
            ingredientsFromPrismarineRecipe: r => Object.fromEntries(r.delta.filter(x=>x.count<0).map(x=>[registry.items[x.id].name,-x.count])),
            calculateLimitingResource: () => ({num:1}) },
        world: { getInventoryCounts: () => stock, getNearestBlockAsync: async () => {tableLookups++; return null;} },
    });
    const source = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url),'utf8');
    const fn = source.slice(source.indexOf('export async function craftRecipeLocal('),source.indexOf('async function placeCraftingTableWithinReach(')).replace(/^export /,'');
    vm.runInContext(fn,context);
    const ok = await context.craftRecipeLocal(bot,name,1);
    return {ok,logs,attempts,tableLookups};
}

test('missing 2x2 ingredients never become a missing crafting table', async () => {
    const r = await localCraft('spruce_planks', {});
    assert.equal(r.ok,false);
    assert.equal(r.tableLookups,0);
    assert.match(r.logs.join('\n'),/resources|materials|ingredients/i);
    assert.doesNotMatch(r.logs.join('\n'),/needs a reachable crafting table/);
});

test('held stripped wood crafts planks in the inventory without a table', async () => {
    const r = await localCraft('spruce_planks',{stripped_spruce_log:1});
    assert.equal(r.ok,true);
    assert.equal(r.tableLookups,0);
    assert.equal(r.attempts[0].table,null);
});

test('missing sticks for a 3x3 recipe are reported before workstation navigation', async () => {
    const r = await localCraft('iron_pickaxe',{iron_ingot:3});
    assert.equal(r.ok,false);
    assert.equal(r.tableLookups,0);
    assert.match(r.logs.join('\n'),/resources|materials|ingredients/i);
});

test('a genuinely makeable 3x3 recipe still requires a reachable table', async () => {
    const r = await localCraft('iron_pickaxe',{iron_ingot:3,stick:2});
    assert.equal(r.ok,false);
    assert.equal(r.tableLookups,1);
    assert.match(r.logs.join('\n'),/needs a reachable crafting table/);
});
