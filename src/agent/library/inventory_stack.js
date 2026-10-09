// Adapted from Cortico src/worlds/minecraft/inventory-click-sync.ts.
// Copyright (c) 2026 Phantivia. MIT license: LICENSES/Cortico-MIT.txt.
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, canonical(child)]));
    }
    return value;
}

// Count and slot are not identity. Custom components, removals and NBT are.
export function sameInventoryStack(a, b) {
    if (!a || !b) return a === b;
    const kind = item => JSON.stringify(canonical({ type: item.type, metadata: item.metadata ?? null,
        nbt: item.nbt ?? null,
        components: [...(item.components ?? [])].map(canonical)
            .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
        removedComponents: [...(item.removedComponents ?? [])].sort() }));
    return kind(a) === kind(b);
}
