import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from 'minecraft-data';
import prismarine from 'prismarine-recipe';
import { makeableRecipes } from '../src/utils/crafting_recipes.js';

const registry = data('1.20.6');
const { Recipe } = prismarine(registry);
function botWith(stock) {
    return { registry,
        inventory: { items: () => Object.entries(stock).map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, metadata: 0 })) },
        recipesAll: id => Recipe.find(id, null),
    };
}
const recipes = (stock, name, table = null) => makeableRecipes(botWith(stock), registry.itemsByName[name].id, table);

test('actual 1.20.6 generic plank recipes accept held spruce rather than nonexistent oak', () => {
    for (const [name, stock, table] of [['crafting_table', { spruce_planks: 4 }, null],
        ['stick', { spruce_planks: 2 }, null], ['wooden_pickaxe', { spruce_planks: 3, stick: 2 }, true]]) {
        const result = recipes(stock, name, table);
        assert.ok(result.length, name);
        assert.ok(result[0].delta.some(d => d.id === registry.itemsByName.spruce_planks.id && d.count < 0));
        assert.ok(!result[0].delta.some(d => d.id === registry.itemsByName.oak_planks.id && d.count < 0));
    }
});

test('mixed plank stacks satisfy generic recipes without overallocating either stack', () => {
    const r = recipes({ spruce_planks: 2, birch_planks: 2 }, 'crafting_table')[0];
    assert.ok(r);
    for (const name of ['spruce_planks', 'birch_planks']) {
        assert.equal(r.delta.find(d => d.id === registry.itemsByName[name].id).count, -2);
    }
});

test('missing sticks or insufficient planks cannot create an executable recipe', () => {
    assert.equal(recipes({ spruce_planks: 20 }, 'wooden_pickaxe', true).length, 0);
    assert.equal(recipes({ spruce_planks: 3 }, 'crafting_table').length, 0);
    assert.equal(recipes({ spruce_planks: 3, stick: 2 }, 'wooden_pickaxe').length, 0);
});

test('wood-specific recipes never substitute another species and source recipes stay immutable', () => {
    assert.equal(recipes({ spruce_planks: 8 }, 'oak_boat', true).length, 0);
    recipes({ spruce_planks: 4 }, 'crafting_table');
    assert.equal(Recipe.find(registry.itemsByName.crafting_table.id, null)[0].inShape[0][0].id,
        registry.itemsByName.oak_planks.id);
});
