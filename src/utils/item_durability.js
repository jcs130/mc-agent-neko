import minecraftData from 'minecraft-data';

const installed = new WeakSet();
const affected = version => version === '1.20.5' || version === '1.20.6';

export function repairLegacyDurability(registry) {
    if (!affected(registry?.version?.minecraftVersion)) return 0;
    // These two minecraft-data tables contain 1 as a placeholder for every
    // durable item. Adjacent 1.21 data has the same named items' real defaults.
    // Copy only this field by name, never numeric IDs or the protocol schema.
    const defaults = minecraftData('1.21').itemsByName;
    let repaired = 0;
    for (const item of Object.values(registry.itemsByName || {})) {
        const maximum = defaults[item.name]?.maxDurability;
        if (item.maxDurability === 1 && Number.isInteger(maximum) && maximum > 1) {
            item.maxDurability = maximum;
            repaired++;
        }
    }
    return repaired;
}

export function installItemDurability(bot) {
    if (!affected(bot?.version) || !bot.inventory?.on) return false;
    if (installed.has(bot)) return true;
    repairLegacyDurability(bot.registry);
    const normalize = item => {
        if (!item) return;
        const component = item.components?.find(value => /^(minecraft:)?max_damage$/.test(value.type));
        if (Number.isInteger(component?.data) && component.data > 0) {
            item.maxDurability = component.data; // Server-defined values, including 1, take priority.
        } else if (item.removedComponents?.some(type => /^(minecraft:)?max_damage$/.test(type))) {
            item.maxDurability = null;
        } else {
            const maximum = bot.registry?.itemsByName?.[item.name]?.maxDurability;
            if (Number.isInteger(maximum) && maximum > 1) item.maxDurability = maximum;
        }
    };
    for (const item of bot.inventory.slots || []) normalize(item);
    normalize(bot.heldItem);
    bot.inventory.on('updateSlot', (_slot, _old, item) => normalize(item));
    bot.on('heldItemChanged', normalize);
    installed.add(bot);
    return true;
}
