import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';
import minecraftData from 'minecraft-data';

const source = readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
const matcher = source.match(/^const FILL_RE = .+;$/m)?.[0];
assert.ok(matcher, 'load the production shared material predicate');
const selectorStart = source.indexOf('const GRAVITY_FILL = ');
const selectorEnd = source.indexOf('try { bot.clearControlStates();', selectorStart);
assert.ok(selectorStart >= 0 && selectorEnd > selectorStart);

function bunkerMaterial(counts) {
    const context = vm.createContext({
        bot: {}, world: { getInventoryCounts: () => counts },
        skills: { isPlankBlock: name => /_planks$/.test(name) },
    });
    vm.runInContext(matcher + source.slice(selectorStart, selectorEnd) + '\nglobalThis.selected = fillerOf();', context);
    return context.selected;
}

test('the carried moss block is a full block and available for the actual bunker selector', () => {
    assert.equal(minecraftData('1.20.6').blocksByName.moss_block.boundingBox, 'block');
    assert.equal(bunkerMaterial({ compass: 1, player_head: 1, moss_block: 33 }), 'moss_block');
});

test('moss caps take priority over falling blocks while planks remain reserved', () => {
    assert.equal(bunkerMaterial({ oak_planks: 16, sand: 64, moss_block: 33 }), 'moss_block');
    assert.equal(bunkerMaterial({ oak_planks: 16 }), undefined);
});

test('partial blocks, storage heads and tools are not made emergency filler by the moss addition', () => {
    assert.equal(bunkerMaterial({ moss_carpet: 8, player_head: 1, stone_slab: 3, compass: 1, crafting_table: 1 }), undefined);
    assert.equal(bunkerMaterial({ red_sand: 3 }), 'red_sand', 'retain the existing fallback');
});

async function interpose(items, { interrupted = false, occupied = false } = {}) {
    const cells = new Map(), placed = [], equipped = [];
    const bot = {
        entity: { position: new Vec3(.5, 64, .5) }, entities: {}, health: 20,
        interrupt_code: interrupted, inventory: { items: () => items },
        blockAt(position) {
            const p = position.floored();
            return { name: p.y < 64 || cells.has(p.toString()) ? 'stone' : 'air',
                boundingBox: p.y < 64 || cells.has(p.toString()) ? 'block' : 'empty', position: p };
        },
        async equip(item) { equipped.push(item.name); this.heldItem = item; },
        async placeBlock(ref, face) { const p = ref.position.plus(face); cells.set(p.toString(), true); placed.push({ name: this.heldItem.name, position: p }); },
        clearControlStates() {},
    };
    const creeper = { position: new Vec3(3.5, 64, .5) };
    if (occupied) bot.entities = { 1: { type: 'player', position: new Vec3(1.5, 64, .5) }, 2: { type: 'player', position: new Vec3(.5, 64, 1.5) } };
    const start = source.indexOf('creeperInterpose: async function');
    const end = source.indexOf('// EMERGENCY BUNKER', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({ Vec3, Date, setTimeout, clearTimeout, setInterval, clearInterval,
        fs: { appendFileSync() {} } });
    vm.runInContext(matcher + '\nglobalThis.mode = {' + source.slice(start, end) + '};', context);
    const ok = await context.mode.creeperInterpose({ bot }, creeper, 1200);
    return { ok, placed, equipped };
}

test('the real creeper interpose equips and places moss when it is the only filler', async () => {
    const result = await interpose([{ name: 'moss_block', count: 33 }]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.equipped, ['moss_block']);
    assert.equal(result.placed.length, 1);
    assert.equal(result.placed[0].name, 'moss_block');
});

test('new filler cannot bypass interrupt or entity collision safety', async () => {
    for (const options of [{ interrupted: true }, { occupied: true }]) {
        const result = await interpose([{ name: 'moss_block', count: 33 }], options);
        assert.equal(result.ok, false);
        assert.equal(result.placed.length, 0);
    }
});
