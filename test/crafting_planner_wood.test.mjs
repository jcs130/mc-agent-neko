import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import data from 'minecraft-data';

const registry = data('1.20.6');
const source = readFileSync(new URL('../src/utils/mcdata.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
const recipesModule = await import('../src/utils/crafting_recipes.js');
function plan(item, stock, quantity = 1) {
    const context = vm.createContext({ settings: { minecraft_version: '1.20.6' }, plugin: {},
        usesInterchangeablePlanks: recipesModule.usesInterchangeablePlanks,
    });
    vm.runInContext(source, context);
    context.registry = registry;
    vm.runInContext('mcdata = registry', context);
    const before = JSON.stringify(stock);
    const result = context.getDetailedCraftingPlan(item, quantity, stock);
    assert.equal(JSON.stringify(stock), before, 'planning does not consume the caller inventory');
    return result;
}

for (const species of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry']) {
    for (const form of ['log', 'planks']) {
        test(`stone pickaxe planning uses held ${species}_${form} instead of inventing missing oak`, () => {
            const wood = `${species}_${form}`;
            const result = plan('stone_pickaxe', { cobblestone: 3, [wood]: form === 'log' ? 1 : 2 });
            assert.doesNotMatch(result, /missing|need to find/i);
            assert.match(result, new RegExp(wood));
            assert.match(result, /3 cobblestone \+ 2 stick -> 1 stone_pickaxe/);
        });
    }
}

test('generic recipes combine held plank species without overallocating a stack', () => {
    const result = plan('crafting_table', { spruce_planks: 2, birch_planks: 2 });
    assert.doesNotMatch(result, /missing/i);
    assert.match(result, /2 spruce_planks/);
    assert.match(result, /2 birch_planks/);
});

test('held planks are used before producing the shortfall from another stocked log species', () => {
    const result = plan('crafting_table', { spruce_planks: 2, birch_log: 1 });
    assert.doesNotMatch(result, /missing/i);
    assert.match(result, /1 birch_log -> 4 birch_planks/);
    assert.match(result, /2 spruce_planks \+ 2 birch_planks -> 1 crafting_table/);
});

for (const wood of ['stripped_spruce_log', 'spruce_wood', 'stripped_spruce_wood', 'crimson_stem', 'warped_stem']) {
    test(`generic planner accepts vanilla same-species plank source ${wood}`, () => {
        const result = plan('stone_pickaxe', { cobblestone: 3, [wood]: 1 });
        assert.doesNotMatch(result, /missing/i);
        assert.match(result, new RegExp(`1 ${wood} -> 4 `));
    });
}

test('a real non-wood shortfall stays missing after resolving held wood', () => {
    const result = plan('stone_pickaxe', { cobblestone: 2, spruce_log: 1 });
    assert.match(result, /missing/i);
    assert.match(result, /- 1 cobblestone/);
    assert.doesNotMatch(result, /- \d+ oak_log/);
});

test('insufficient total wood stays missing instead of borrowing unrelated wood products', () => {
    const result = plan('crafting_table', { spruce_planks: 1, spruce_fence: 20 });
    assert.match(result, /missing/i);
    assert.match(result, /- \d+ oak_log/);
    assert.doesNotMatch(result, /spruce_fence ->/);
});

test('species-specific outputs never consume another wood species', () => {
    const boat = plan('oak_boat', { spruce_planks: 8, spruce_log: 5 });
    assert.match(boat, /missing/i);
    assert.match(boat, /oak_log/);
    assert.doesNotMatch(boat, /spruce/);
    const planks = plan('oak_planks', { stripped_spruce_log: 1 });
    assert.match(planks, /missing/i);
    assert.doesNotMatch(planks, /spruce/);
});

test('produced leftovers and mixed material batches are counted across recursive crafting', () => {
    const result = plan('wooden_pickaxe', { spruce_log: 1, birch_planks: 1 });
    assert.doesNotMatch(result, /missing/i);
    assert.match(result, /wooden_pickaxe/);
});
