import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Vec3 from 'vec3';
import { protectedRetreatHandoff } from '../src/agent/protected_retreat_recovery.js';

const source = readFileSync(process.env.NIGHT_POLICY_SOURCE ?? new URL('../src/agent/modes.js', import.meta.url), 'utf8');
function fixture({ external = true, hurt = false, creeper = false } = {}) {
    const clock = { now: 100000 };
    const bot = { game: { dimension: 'overworld' }, health: 20, food: 20, oxygenLevel: 20,
        lastDamageTime: hurt ? 99999 : 0, entity: { position: new Vec3(.5, 64, .5) },
        inventory: { slots: [], items: () => [] }, entities: {}, time: { timeOfDay: 18000 },
        blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p.floored(),
            boundingBox: p.y < 64 ? 'block' : 'empty' }),
        serverProtection: { isDenied: () => true } };
    if (creeper) bot.entities[1] = { name: 'creeper', position: bot.entity.position.offset(3, 0, 0) };
    const context = vm.createContext({ Date: { now: () => clock.now },
        settings: { proactive_night_shelter: true }, hasMeleeWeapon: () => false,
        mc: { isHostile: () => true }, threatCanReachBot: () => true,
        commandedFightActive: () => false, rangedUnreachableTrap: () => false,
        armoredSoloBrawl: () => false,
        arbiterVitalNow: () => false, protectedRetreatHandoff,
    });
    const start = source.indexOf('const modes_list = [');
    vm.runInContext(source.slice(start, source.indexOf('async function execute(', start))
        + '\nglobalThis.mode = modes_list.find(m => m.name === "self_preservation");', context);
    const mode = context.mode;
    mode.armoredZombieBrawl = () => false;
    const agent = { bot, hasExternalAutonomyOwner: () => external };
    return { bot, agent, clock, context, mode };
}

test('night alone cannot interrupt the external planner, including gaps between tasks', () => {
    const f = fixture();
    assert.equal(f.mode.shouldNightShelter(f.bot, f.agent), false);
    f.bot._extIntentUntil = 1;
    assert.equal(f.mode.shouldNightShelter(f.bot, f.agent), false);
});
test('standalone preventive night shelter and its disable switch remain available', () => {
    const f = fixture({ external: false });
    assert.equal(f.mode.shouldNightShelter(f.bot, f.agent), true);
    assert.equal(f.mode.shouldNightShelter(f.bot), true);
    f.context.settings.proactive_night_shelter = false;
    assert.equal(f.mode.shouldNightShelter(f.bot, f.agent), false);
});
test('actual threats still reach reactive retreat regardless of external night policy', () => {
    const f = fixture({ hurt: true });
    f.bot.entities[1] = { name: 'zombie', type: 'hostile', position: f.bot.entity.position.offset(3,0,0) };
    assert.equal(f.mode.shouldFlee(f.bot), true);
    assert.equal(f.mode.yieldProtectedRetreat(f.agent), false);
    const c = fixture({ creeper: true });
    assert.equal(c.mode.creeperBackoffTarget(c.bot)?.name, 'creeper');
});
test('both non-vital hold and mobility respect the same measured protected-retreat handoff', () => {
    const f = fixture();
    for (const now of [100000,105000,110000,115000]) {
        f.clock.now = now;
        f.mode.yieldProtectedRetreat(f.agent);
    }
    assert.equal(f.mode.yieldProtectedRetreat(f.agent), true);
    const holdStart = source.indexOf('            else if (this.yieldProtectedRetreat(agent)) {');
    const holdEnd = source.indexOf('            else if (this.coveredNightHoldStatus(bot).hold)', holdStart);
    assert(holdStart > 0 && holdEnd > holdStart, 'handoff must precede passive hold');
    const gateStart = source.indexOf('            // Protected recovery owns the next physical choice.');
    const gateEnd = source.indexOf('            // ── reactions ──', gateStart);
    assert(gateStart > 0 && gateEnd > gateStart);
    vm.runInContext('(function(agent, bot) {' + source.slice(gateStart, gateEnd)
        + '; throw Error("mobility reclaimed protected body"); })(agent,bot)',
        Object.assign(f.context, { agent:f.agent, bot:f.bot }));
    f.bot.lastDamageTime = f.clock.now;
    assert.equal(f.mode.yieldProtectedRetreat(f.agent), false, 'new damage immediately revokes the soft handoff');
});
