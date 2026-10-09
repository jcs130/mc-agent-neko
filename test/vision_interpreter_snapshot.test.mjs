import test from 'node:test';
import assert from 'node:assert/strict';
import { VisionInterpreter } from '../src/agent/vision/vision_interpreter.js';

test('grounded center-block facts stay with the captured frame during slow vision inference', async () => {
    let name = 'coal_ore';
    const agent = { bot: { blockAtCursor: () => ({ name, position: { x: 1, y: 40, z: 2 } }) },
        history: { getHistory: () => [] }, prompter: { promptVision: async () => {
            name = 'iron_ore'; return 'A stone tunnel.';
        } } };
    const vision = new VisionInterpreter(agent, true);
    const result = await vision.analyzeImage(Buffer.from('frame'));
    assert.match(result, /coal_ore/);
    assert.doesNotMatch(result, /iron_ore/);
});
