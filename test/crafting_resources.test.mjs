import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLimitingResource } from '../src/utils/mcdata.js';

test('a missing ingredient is zero stock, not unlimited craft capacity', () => {
    assert.deepEqual(calculateLimitingResource({ spruce_planks: 8 }, { oak_planks: 4 }),
        { num: 0, limitingResource: 'oak_planks' });
});

test('missing one material rejects a recipe even when its other material is stocked', () => {
    assert.equal(calculateLimitingResource({ stick: 12 }, { stick: 2, cobblestone: 3 }).num, 0);
});

test('complete stock limits batches by the scarce ingredient', () => {
    assert.deepEqual(calculateLimitingResource({ stick: 12, cobblestone: 7 }, { stick: 2, cobblestone: 3 }),
        { num: 2, limitingResource: 'cobblestone' });
    assert.equal(calculateLimitingResource({ oak_planks: 3 }, { oak_planks: 4 }, false).num, 0.75);
});
