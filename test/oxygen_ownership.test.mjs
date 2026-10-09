import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import minecraftData from 'minecraft-data';
import { GameInformation } from '../src/websocket/game_information.js';
import { vitalNow } from '../src/agent/framework/arbiter.js';

const require = createRequire(import.meta.url);

function fixture(t) {
    const registry = minecraftData('1.20.6');
    const Entity = require('prismarine-entity')('1.20.6');
    const bot = Object.assign(new EventEmitter(), {
        version: '1.20.6', registry,
        supportFeature: name => registry.supportFeature(name),
        _client: Object.assign(new EventEmitter(), { state: 'play', write() { assert.fail('no game packets'); } }),
    });
    // Exercise the installed dependency's real metadata and breath handlers.
    require('mineflayer/lib/plugins/entities')(bot);
    bot.entity = new Entity(1);
    bot.entity.name = 'player';
    bot.entities[1] = bot.entity;
    bot.entities[2] = new Entity(2);
    bot.entities[2].name = 'zombie';
    bot.oxygenLevel = 20;
    const information = new GameInformation({ bot }, () => {}, { intervalMs: 60000 });
    t.after(() => information.close());
    const breath = [];
    bot.on('breath', () => breath.push(bot.oxygenLevel));
    const air = (id, value) => {
        const name = bot.entities[id].name;
        const key = registry.entitiesByName[name].metadataKeys.indexOf('air_supply');
        bot._client.emit('entity_metadata', { entityId: id, metadata: [{ key, type: 'varint', value }] });
    };
    return { bot, information, air, breath, Entity };
}

test('foreign entity air cannot overwrite own oxygen or trigger native drowning thresholds', t => {
    const { bot, information, air, breath } = fixture(t);
    air(1, 300);
    air(2, 120);
    air(2, 0);
    assert.equal(bot.oxygenLevel, 20, 'nearby drowning entities must not make the bot think it is drowning');
    assert.deepEqual(breath, [20, 20, 20], 'synchronous native breath consumers must also see own air');
    assert.equal(information.snapshot().state.self.oxygen, 20);
});

test('real own air decreases still reach native safety thresholds and recover to full', t => {
    const { bot, information, air, breath } = fixture(t);
    for (const value of [300, 285, 120, 0, 300]) {
        air(1, value);
        assert.equal(bot.oxygenLevel, Math.round(value / 15));
        assert.equal(information.snapshot().state.self.oxygen, Math.round(value / 15));
    }
    assert.deepEqual(breath, [20, 19, 8, 0, 20]);
});

test('native vital arbitration ignores foreign air while preserving real drowning rescue', t => {
    const { bot, air } = fixture(t);
    bot.blockAt = () => ({ name: 'water' });
    air(1, 300);
    air(2, 0);
    assert.equal(vitalNow(bot), false, 'a nearby mob must not claim the bot drowning priority');
    air(1, 120);
    assert.equal(vitalNow(bot), true, 'real own low air must retain survival priority');
    air(1, 0);
    assert.equal(vitalNow(bot), true);
    air(1, 300);
    assert.equal(vitalNow(bot), false);
});

test('missing own air stays unknown despite foreign updates and a new own entity', t => {
    const { bot, information, air, Entity } = fixture(t);
    air(2, 0);
    assert.equal(bot.oxygenLevel, undefined);
    assert.equal(information.snapshot().state.self.oxygen, null);
    air(1, 120);
    bot.entity = new Entity(3);
    bot.entity.name = 'player';
    bot.entities[3] = bot.entity;
    assert.equal(bot.oxygenLevel, undefined, 'respawn must not reuse old entity air');
    air(3, 300);
    air(2, 0);
    assert.equal(bot.oxygenLevel, 20);
});

test('closing observation restores the ordinary property with current own oxygen', t => {
    const { bot, information, air } = fixture(t);
    air(1, 120);
    air(2, 0);
    information.close();
    const descriptor = Object.getOwnPropertyDescriptor(bot, 'oxygenLevel');
    assert.equal(descriptor.get, undefined);
    assert.equal(descriptor.value, 8);
    bot.oxygenLevel = 19;
    assert.equal(bot.oxygenLevel, 19);
});

test('legacy protocol oxygen ownership remains with its own-entity breath handler', t => {
    const bot = Object.assign(new EventEmitter(), {
        _client: Object.assign(new EventEmitter(), { state: 'play' }),
        supportFeature: () => false,
        oxygenLevel: 12,
    });
    const information = new GameInformation({ bot }, () => {}, { intervalMs: 60000 });
    t.after(() => information.close());
    assert.equal(Object.getOwnPropertyDescriptor(bot, 'oxygenLevel').get, undefined);
    assert.equal(information.snapshot().state.self.oxygen, 12);
    bot.oxygenLevel = 6;
    assert.equal(information.snapshot().state.self.oxygen, 6);
});

test('disposing the oxygen guard does not replace a later property owner', t => {
    const { bot, information } = fixture(t);
    const laterGet = () => 11;
    Object.defineProperty(bot, 'oxygenLevel', { configurable: true, get: laterGet });
    information.close();
    assert.equal(Object.getOwnPropertyDescriptor(bot, 'oxygenLevel').get, laterGet);
});
