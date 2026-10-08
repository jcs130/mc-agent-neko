import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfPrompter } from '../src/agent/self_prompter.js';

test('stopping an inactive loop does not cancel the first turn of its next goal', async () => {
    let turns = 0;
    const prompter = new SelfPrompter({
        actions: { stop: async () => {} }, isIdle: () => true,
        handleMessage: async () => { turns++; return true; },
    });
    prompter.cooldown = 1;
    await prompter.stop(false, true);
    prompter.start('制作并放置工作台');
    assert.equal(turns, 1, 'a fresh goal must actually enter the command loop');
    await prompter.stop(false, true);
});

test('stop waits for the previous turn before a new mission can take the loop', async () => {
    let release;
    const prompter = new SelfPrompter({
        actions: { stop: async () => {} }, isIdle: () => true,
        handleMessage: () => new Promise(resolve => { release = resolve; }),
    });
    prompter.cooldown = 1;
    prompter.start('旧任务');
    let settled = false;
    const stopped = prompter.stop(false, true).then(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    const stoppedPrematurely = settled;
    release(true);
    await stopped;
    assert.equal(stoppedPrematurely, false, 'stop must not leave an old live turn behind');
    assert.equal(prompter.loop_active, false);
    assert.equal(prompter.interrupt, false);
});

test('stop interrupts the old self-prompt turn even after its state becomes STOPPED', async () => {
    let release;
    const prompter = new SelfPrompter({actions: {stop: async () => {}},
        handleMessage: () => new Promise(resolve => { release = resolve; }),
    });
    prompter.cooldown = 1;
    prompter.start('旧挖矿目标');
    await prompter.stop(false);
    const interruptedOldTurn = prompter.shouldInterrupt(true);
    const interruptedHumanTurn = prompter.shouldInterrupt(false);
    release(true);
    await prompter.stop(false, true);
    assert.equal(interruptedOldTurn, true, 'STOPPED must still cancel its outstanding self-prompt');
    assert.equal(interruptedHumanTurn, false, 'a human instruction may take over');
});

test('a failed model turn releases the loop for recovery', async () => {
    const prompter = new SelfPrompter({
        handleMessage: async () => { throw new Error('local model stream lost'); },
    });
    await assert.rejects(prompter.startLoop(), /local model stream lost/);
    assert.equal(prompter.loop_active, false, 'an exception must not leave a phantom running loop');
    assert.equal(prompter.interrupt, false);
});

test('a terminal command can stop its own loop without deadlocking', async () => {
    let commandReturned = false;
    const prompter = new SelfPrompter({actions: {stop: async () => {}},
        handleMessage: async () => {
            await prompter.stop(false);
            commandReturned = true;
            return true;
        },
    });
    prompter.cooldown = 1;
    const running = prompter.startLoop();
    await new Promise(resolve => setTimeout(resolve, 10));
    const returnedBeforeCleanup = commandReturned;
    if (!returnedBeforeCleanup) prompter.loop_active = false;
    await running;
    assert.equal(returnedBeforeCleanup, true, 'a loop must not await itself');
});

test('no-progress handoff does not clear the replacement loop running flag', async () => {
    let turns = 0, release;
    const prompter = new SelfPrompter({actions: {stop: async () => {}},
        handleMessage: async () => {
            if (++turns <= 3) return false;
            return new Promise(resolve => { release = resolve; });
        },
    });
    prompter.cooldown = 1;
    prompter.owner = {onNoProgress: async () => { prompter.start('新的短目标'); }};
    await prompter.startLoop();
    const replacementWasActive = prompter.loop_active;
    const stopping = prompter.stop(false, true);
    release(true);
    await stopping;
    assert.equal(replacementWasActive, true, 'old cleanup must not clobber its successor');
});
