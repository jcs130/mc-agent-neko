import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGameState } from '../src/websocket/game_information.js';

test('inventory free capacity includes a completely full bag as zero', () => {
    for (const count of [0, 5, 36]) {
        const bot = { inventory: { slots: [], emptySlotCount: () => count } };
        assert.equal(collectGameState({ bot }).inventory.emptySlots, count);
    }
});

test('unavailable or invalid inventory free capacity remains unknown', () => {
    for (const count of [null, undefined, '0', -1, 37, 2.5, NaN, Infinity]) {
        const bot = { inventory: { slots: [], emptySlotCount: () => count } };
        assert.equal(collectGameState({ bot }).inventory.emptySlots, null);
    }
    assert.equal(collectGameState({ bot: { inventory: { slots: [] } } }).inventory.emptySlots, null);
    assert.equal(collectGameState({ bot: {} }).inventory.emptySlots, null);
});

test('inventory free capacity lookup failure does not break state collection', () => {
    const bot = { inventory: { slots: [], emptySlotCount() { throw new Error('window not ready'); } } };
    assert.equal(collectGameState({ bot }).inventory.emptySlots, null);
});
