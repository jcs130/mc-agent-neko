// minecraft-data 1.20.6 expands #planks to oak only. Materialize that tag
// against the actual inventory, only for outputs whose vanilla recipe uses
// interchangeable planks. Species-specific outputs must keep their recipe.
const GENERIC_PLANK_OUTPUTS = new Set([
    'crafting_table', 'stick', 'bowl', 'chest', 'barrel', 'shield',
    'wooden_sword', 'wooden_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_hoe',
    'bookshelf', 'lectern', 'jukebox', 'piston', 'tripwire_hook',
]);

export function usesInterchangeablePlanks(output) {
    return GENERIC_PLANK_OUTPUTS.has(output) || /_bed$/.test(output || '');
}

export function makeableRecipes(bot, itemId, craftingTable = null) {
    const registry = bot.registry;
    const output = registry.items[itemId]?.name;
    const interchangeable = usesInterchangeablePlanks(output);
    // The bundled 1.20.6 data also expands each logs tag to the unstripped
    // log alone. Vanilla accepts the same species' wood/stem and stripped
    // variants as inputs for planks; never substitute a different species.
    const plankSpecies = output?.match(/^(.+)_planks$/)?.[1];
    const sameWood = name => plankSpecies && new RegExp(`^(?:stripped_)?${plankSpecies}_(?:log|wood|stem|hyphae|block)$`).test(name || '');
    if (!interchangeable && !plankSpecies && typeof bot.recipesFor === 'function') {
        return bot.recipesFor(itemId, null, 1, craftingTable) || [];
    }
    const stock = new Map();
    for (const item of bot.inventory.items()) {
        const key = item.type;
        stock.set(key, (stock.get(key) || 0) + item.count);
    }
    const result = [];
    for (const source of bot.recipesAll(itemId, null, craftingTable) || []) {
        if (source.requiresTable && !craftingTable) continue;
        const remaining = new Map(stock);
        const consumed = new Map();
        let valid = true;
        const resolve = (ingredient, signed = false) => {
            if (ingredient.id < 0) return [{ ...ingredient }];
            const count = Math.abs(ingredient.count);
            const entries = [];
            for (let n = 0; n < count; n++) {
                let id = ingredient.id;
                const name = registry.items[id]?.name;
                if (!(remaining.get(id) > 0) && interchangeable && name === 'oak_planks') {
                    id = [...remaining.keys()].find(k => remaining.get(k) > 0 && /_planks$/.test(registry.items[k]?.name || ''));
                }
                if (!(remaining.get(id) > 0) && sameWood(name)) {
                    id = [...remaining.keys()].find(k => remaining.get(k) > 0 && sameWood(registry.items[k]?.name));
                }
                if (id == null || !(remaining.get(id) > 0)) { valid = false; break; }
                remaining.set(id, remaining.get(id) - 1);
                consumed.set(id, (consumed.get(id) || 0) + 1);
                entries.push({ ...ingredient, id, count: signed ? -1 : 1 });
            }
            return entries;
        };
        const recipe = { ...source };
        if (source.inShape) {
            recipe.inShape = source.inShape.map(row => row.map(i => resolve(i)[0]));
        }
        if (source.ingredients) recipe.ingredients = source.ingredients.flatMap(i => resolve(i, true));
        if (!valid) continue;
        recipe.delta = source.delta.filter(d => d.count >= 0).map(d => ({ ...d }));
        for (const [id, count] of consumed) recipe.delta.push({ id, metadata: null, count: -count });
        result.push(recipe);
    }
    return result;
}
