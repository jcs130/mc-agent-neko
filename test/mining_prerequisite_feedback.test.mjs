import test from 'node:test';
import assert from 'node:assert/strict';
import mineOres from '../bots/_supervisor/skills/mineOres.js';

for (const items of [[], [{ name: 'wooden_pickaxe', count: 1 }]]) {
    test(`iron mining reports its missing usable pickaxe (${items.length ? 'wooden only' : 'none'})`, async () => {
        const messages = [];
        const bot = { entity: {}, inventory: { items: () => items } };
        const ctx = { skills: {}, world: {}, log: (target, text) => {
            assert.equal(target, bot); messages.push(text);
        } };
        assert.equal(await mineOres(bot, ctx, { ore: 'iron' }), false);
        assert.equal(messages.length, 1, 'the body LLM must receive a failure instead of empty Action output');
        assert.match(messages[0], /cannot|failed|无法|失败/i);
        assert.match(messages[0], /pickaxe|镐/i);
        assert.match(messages[0], /craft|repair|补|合成|修/i);
    });
}
