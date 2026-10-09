import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';
import { maroonedNavigationSuppressed } from '../src/agent/framework/mobility_ownership.js';

const nativeSource = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
const oreSource = readFileSync(new URL('../bots/_supervisor/skills/mineOres.js', import.meta.url), 'utf8');

function botFor({ intent = true, state = 'MAROONED', owner = 'action:mineOres', vital = false, threat = false } = {}) {
    const bot = {
        _extIntentUntil: intent ? Date.now() + 60000 : 0,
        _mobility: { state, exits: [[1, 0]], enclosed: true },
        _bodyOwner: owner ? { name: owner, kind: owner.startsWith('mode:') ? 'mode' : 'action' } : null,
        entity: { position: new Vec3(0, 50, 0) },
        blockAt: () => ({ name: vital ? 'lava' : 'air' }),
        inventory: { items: () => [{ name: 'wooden_pickaxe', count: 1 }] },
        entities: {},
    };
    if (threat) bot.entities.enemy = { hostile: true, position: new Vec3(2, 50, 0) };
    return bot;
}

// Exercise each real entry gate, stopping before pathfinding or mining can act.
// Everything after the gate retains its normal safety checks in production.
function entryGates() {
    const goal = nativeSource.slice(nativeSource.indexOf('export async function goToGoal('),
        nativeSource.indexOf('    // Setup movements.', nativeSource.indexOf('export async function goToGoal(')))
        .replace('export ', '') + "return 'navigation'; }";
    const positionStart = nativeSource.indexOf('export async function goToPosition(');
    const position = nativeSource.slice(positionStart, nativeSource.indexOf('    const cur = bot.entity.position;', positionStart))
        .replace('export ', '') + "return 'navigation'; }";
    const tunnelStart = nativeSource.indexOf('async function tunnelToOre(');
    const tunnel = nativeSource.slice(tunnelStart, nativeSource.indexOf('        const orePos = new Vec3(', tunnelStart))
        + "return 'navigation'; } catch (error) { throw error; } }";
    const oreStart = oreSource.indexOf('export default async function mineOres(');
    const ore = oreSource.slice(oreStart, oreSource.indexOf('    bot._svnOreZeroRounds = 0;', oreStart))
        .replace('export default ', '') + "return 'mining'; }";
    const context = vm.createContext({
        Date, process: { env: {} }, maroonedNavigationSuppressed,
        motionGoal: () => ({}), motionAudit() {}, log() {}, prog() {},
        mc: { isHostile: entity => entity.hostile },
        DROP_OF: { coal: /^coal$/ }, PICK_FOR: { coal: /_pickaxe$/ }, COLLECT_KEY: { coal: 'coal' },
        oracleFamily: ore => ore,
    });
    vm.runInContext(goal + position + tunnel + ore
        + '\nglobalThis.entries = { goToGoal, goToPosition, tunnelToOre, mineOres };', context);
    return {
        goToGoal: bot => context.entries.goToGoal(bot, {}),
        goToPosition: bot => context.entries.goToPosition(bot, 1, 50, 0),
        tunnelToOre: bot => context.entries.tunnelToOre(bot, { position: new Vec3(2, 50, 0) }),
        mineOres: bot => context.entries.mineOres(bot, { skills: {}, world: {}, Vec3 }, { ore: 'coal' }),
    };
}

const gates = entryGates();
for (const [name, run] of Object.entries(gates)) {
    const reached = name === 'mineOres' ? 'mining' : 'navigation';
    test(`${name}: a fresh external task is not blocked by a frozen MAROONED march`, async () => {
        assert.equal(await run(botFor()), reached);
    });
    test(`${name}: an actual mobility owner still reserves the body`, async () => {
        assert.notEqual(await run(botFor({ owner: 'mode:mobility' })), reached);
    });
    test(`${name}: standalone MAROONED behavior stays suppressed`, async () => {
        assert.notEqual(await run(botFor({ intent: false, owner: null })), reached);
    });
    test(`${name}: an expired external lease cannot bypass recovery`, async () => {
        const bot = botFor(); bot._extIntentUntil = Date.now() - 1;
        assert.notEqual(await run(bot), reached);
    });
    test(`${name}: vital danger preserves the existing MAROONED gate`, async () => {
        assert.notEqual(await run(botFor({ vital: true })), reached);
    });
    for (const state of ['ENTOMBED', 'SEALED']) test(`${name}: ${state} is not altered by the regional navigation gate`, async () => {
        assert.equal(await run(botFor({ state })), reached);
    });
}

test('goToGoal retains its existing nearby-hostile escape exception', async () => {
    assert.equal(await gates.goToGoal(botFor({ intent: false, owner: 'mode:mobility', threat: true })), 'navigation');
});

test('low air with current water evidence keeps vital recovery eligible', () => {
    const bot = botFor(); bot.oxygenLevel = 8; bot.blockAt = () => ({ name: 'water' });
    assert.equal(maroonedNavigationSuppressed(bot), true);
});

test('the exception does not rewrite topology or claim mobility ownership', () => {
    const bot = botFor(), mobility = bot._mobility, owner = bot._bodyOwner;
    assert.equal(maroonedNavigationSuppressed(bot), false);
    assert.equal(bot._mobility, mobility);
    assert.equal(bot._bodyOwner, owner);
    assert.equal(bot._mobility.state, 'MAROONED');
});
