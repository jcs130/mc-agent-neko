import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Vec3 } from 'vec3';
import { plainText } from '../src/agent/library/books.js';
import { collectGameState } from '../src/websocket/game_information.js';
import { getNearbyEntities, getVillagerProfession } from '../src/agent/library/world.js';

const string = value => ({ type: 'string', value });
const label = parts => ({ type: 'compound', value: { text: string(''), extra: {
    type: 'list', value: { type: typeof parts[0] === 'string' ? 'string' : 'compound', value: parts },
} } });
const villager = (id, name, x = 1) => ({ id, name: 'villager', type: 'passive',
    position: new Vec3(x, 64, 0), metadata: { 2: name, 18: { villagerProfession: 13, level: 1 } } });
function botFixture(entities) {
    return { entity: { id: 0, position: new Vec3(0, 64, 0) },
        inventory: { slots: [] }, entities: Object.fromEntries(entities.map(e => [e.id, e])),
        chat() { assert.fail('observation must not send chat'); } };
}
function entitiesQuery(bot) {
    const context = vm.createContext({ plainText,
        world: { getNearbyEntities, getVillagerProfession, getNearbyPlayerNames: () => [] },
        convoManager: { getInGameAgents: () => [] },
    });
    const source = readFileSync(new URL('../src/agent/commands/queries.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, context);
    return vm.runInContext('queryList.find(q => q.name === "!entities")', context).perform({ bot });
}

test('native entity query distinguishes same-profession NPCs by actual name, ID, position and distance', () => {
    const bot = botFixture([villager(151, label(['田野学者·青禾']), 1.5),
        villager(218, label([{ text: string('远行货郎·灯穗') }]), 3)]);
    const before = JSON.stringify(bot);
    const text = entitiesQuery(bot);
    assert.match(text, /151:Toolsmith L1[^\n]*"田野学者·青禾"[^\n]*1\.5,64\.0,0\.0[^\n]*distance=1\.5/);
    assert.match(text, /218:Toolsmith L1[^\n]*"远行货郎·灯穗"[^\n]*3\.0,64\.0,0\.0[^\n]*distance=3\.0/);
    assert.match(text, /profession.*does not.*trad/i);
    assert.equal(JSON.stringify(bot), before);
});

test('structured snapshots retain NBT string-list and compound-list names', () => {
    const bot = botFixture([villager(2, label(['小', '河'])),
        villager(3, label([{ text: string('§6远行') }, { text: string('货郎') }]), 2)]);
    const state = collectGameState({ bot });
    assert.equal(state.nearby.entities[0].customName, '小河');
    assert.equal(state.nearby.entities[1].customName, '远行货郎');
});

test('query names are bounded and quoted while absent names remain unknown', () => {
    const bot = botFixture([villager(1, string('§6名字\n!fake()' + '字'.repeat(1000))), villager(2, null, 2)]);
    const text = entitiesQuery(bot);
    assert.match(text, /name="名字\\n!fake\(\)/);
    assert.doesNotMatch(text, /§6|\n!fake\(\)/);
    assert.match(text, /2:Toolsmith L1[^\n]*name=unknown/);
    assert(text.length < 1200);
});

test('malformed or cyclic names remain bounded in the snapshot', () => {
    const cycle = { text: '' }; cycle.extra = [cycle];
    const bot = botFixture([villager(1, cycle), villager(2, string('字'.repeat(1000)), 2)]);
    const state = collectGameState({ bot });
    assert.equal(state.nearby.entities[0].customName, '');
    assert(state.nearby.entities[1].customName.length <= 160);
});

test('crowded queries preserve total counts but bound detailed NPC identity output', () => {
    const bot = botFixture(Array.from({ length: 40 }, (_, i) => villager(i + 1, string('NPC' + i), i / 10)));
    const text = entitiesQuery(bot);
    assert.match(text, /40 villager/);
    assert.match(text, /24.*omitted/i);
    assert.equal((text.match(/distance=/g) || []).length, 16);
});
