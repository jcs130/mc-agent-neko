import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sanitizeMemorySummary, memoryEvidence, boundedPromptHistory } from '../src/agent/context_budget.js';

function fixture() {
    const files = new Map(), timers = new Set(), calls = [], clock = { now: 100000 };
    const agent = { name: 'offline-fixture', task: {}, self_prompter: { state: 0, isStopped: () => true },
        prompter: { _activeConversationRequests: 0, promptMemSaving: (turns, oldMemory) => new Promise((resolve, reject) => {
            calls.push({ turns, oldMemory, resolve, reject });
        }) } };
    const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, settings: { max_messages: 12 },
        sanitizeMemorySummary, memoryEvidence, boundedPromptHistory, Date: class extends Date { static now() { return clock.now; } },
        mkdirSync() {}, existsSync: path => files.has(path), readFileSync: path => files.get(path),
        writeFileSync: (path, value) => files.set(path, value),
        setTimeout: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.add(timer); return timer; },
        clearTimeout: timer => timers.delete(timer) });
    const source = readFileSync(new URL('../src/agent/history.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace('export class History', 'class History');
    vm.runInContext(source + '\nglobalThis.History = History;', context);
    const history = new context.History(agent); agent.history = history;
    const adds = [];
    const add = (count, prefix = 'fact') => {
        for (let i = 0; i < count; i++) adds.push(history.add('system', `${prefix}-${i}: learned a recipe constraint`));
    };
    return { history, agent, calls, files, timers, clock, add, adds,
        settle: async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); } };
}

test('overflow batches for 45 seconds instead of generating a summary every five turns', async () => {
    const f = fixture(); f.add(20); await f.settle();
    assert.equal(f.calls.length, 0);
    assert.equal(f.history.getHistory().length, 20, 'pending raw observations must remain visible');
    f.clock.now += 45000;
    const flush = f.history.flushMemories(); await f.settle();
    assert.equal(f.calls.length, 1);
    f.calls[0].resolve('Spruce planks can make sticks.'); await flush;
    assert.equal(f.history.memory, 'Spruce planks can make sticks.');
});

test('pending original turns survive trimming, serialization and reload', async () => {
    const f = fixture(); f.add(20); await f.settle(); await f.history.save();
    const before = JSON.stringify(f.history.getHistory());
    f.history.clear(); f.history.load();
    assert.equal(JSON.stringify(f.history.getHistory()), before);
    assert(f.history.getHistory().some(turn => turn.content.startsWith('fact-0:')));
});

test('forced capacity flush is singleflight while new evidence keeps arriving', async () => {
    const f = fixture(); f.history._pendingCharLimit = 150; f.add(12); await f.settle();
    assert.equal(f.calls.length, 1);
    f.add(12, 'new'); await f.settle();
    assert.equal(f.calls.length, 1, 'a second summary must not run concurrently');
    assert(f.history.getHistory().some(turn => turn.content.startsWith('new-0:')));
    f.calls[0].resolve('First verified recipe constraint.'); await f.settle();
    assert.equal(f.calls.length, 1, 'capacity backlog must yield between model requests');
    const next = f.history.flushMemories(true); await f.settle();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].oldMemory, 'First verified recipe constraint.');
    f.calls[1].resolve('First verified recipe constraint. Second verified fact.');
    await next;
    assert.match(f.history.memory, /First verified/);
    assert.match(f.history.memory, /Second verified/);
});

test('failed summaries retain original observations and back off before retrying', async () => {
    const f = fixture(); f.add(20); await f.settle();
    const before = JSON.stringify(f.history.getHistory());
    const flush = f.history.flushMemories(true); await f.settle();
    f.calls[0].reject(new Error('offline model failure')); await flush;
    assert.equal(JSON.stringify(f.history.getHistory()), before);
    await f.history.flushMemories();
    assert.equal(f.calls.length, 1);
});

test('clear invalidates a late summary without replacing the new history memory', async () => {
    const f = fixture(); f.add(20); await f.settle();
    const flush = f.history.flushMemories(true); await f.settle();
    f.history.clear(); f.history.memory = 'New session fact.';
    f.calls[0].resolve('Old session result.'); await flush;
    assert.equal(f.history.memory, 'New session fact.');
});

test('summary work waits while the native conversation request is active', async () => {
    const f = fixture(); f.agent.prompter._activeConversationRequests = 1;
    f.add(20); await f.settle(); f.clock.now += 45000;
    await f.history.flushMemories(true);
    assert.equal(f.calls.length, 0);
    f.agent.prompter._activeConversationRequests = 0;
    const flush = f.history.flushMemories(true); await f.settle();
    f.calls[0].resolve('Verified server recipe.'); await flush;
    assert.equal(f.calls.length, 1);
});

test('empty or disconnected model replies cannot erase pending learned facts', async () => {
    for (const result of ['', 'My brain disconnected, try again.']) {
        const f = fixture(); f.add(20); await f.settle();
        const flush = f.history.flushMemories(true); await f.settle();
        f.calls[0].resolve(result); await flush;
        assert(f.history.getHistory().some(turn => turn.content.startsWith('fact-0:')));
    }
});

test('a failed capacity flush does not hammer the model on every incoming observation', async () => {
    const f = fixture(); f.history._pendingCharLimit = 150; f.add(12); await f.settle();
    f.calls[0].reject(new Error('model unavailable')); await f.history.waitForMemory();
    f.add(12, 'later'); await f.settle();
    assert.equal(f.calls.length, 1, 'capacity pressure must respect failure backoff');
    assert(f.history.getHistory().some(turn => turn.content.startsWith('fact-0:')));
    assert(f.history.getHistory().some(turn => turn.content.startsWith('later-0:')));
});

test('load invalidates an old request and preserves a newer persisted pending queue', async () => {
    const f = fixture(); f.add(20); await f.settle();
    const flush = f.history.flushMemories(true); await f.settle();
    f.files.set(f.history.memory_fp, JSON.stringify({ memory: 'New loaded recipe.',
        turns: [], pending_memory: [{ role: 'system', content: 'New pending server protection fact.' }] }));
    f.history.load(); f.calls[0].resolve('Old request recipe.'); await flush;
    assert.equal(f.history.memory, 'New loaded recipe.');
    assert.equal(f.history.getHistory()[0].content, 'New pending server protection fact.');
});

test('successful commit removes only its own batch and preserves later observations', async () => {
    const f = fixture(); f.add(20); await f.settle();
    const flush = f.history.flushMemories(true); await f.settle();
    f.add(12, 'during'); await f.settle();
    f.calls[0].resolve('Committed original recipe.'); await flush;
    assert(f.history.getHistory().some(turn => turn.content.startsWith('during-0:')));
    assert.equal(f.calls.length, 1, 'small later batch waits for the next interval');
    const snapshot = JSON.parse(f.files.get(f.history.memory_fp));
    assert(snapshot.pending_memory.some(turn => turn.content.startsWith('during-0:')));
});

test('failed summaries keep disk facts intact while model input stays explicitly bounded', async () => {
    const f = fixture(); f.add(150, 'persistent-fact'); await f.settle();
    assert.equal(f.calls.length, 1);
    f.calls[0].reject(new Error('offline')); await f.history.waitForMemory();
    await f.history.save();
    const snapshot = JSON.parse(f.files.get(f.history.memory_fp));
    assert.equal(snapshot.pending_memory.length + snapshot.turns.length, 150);
    assert(snapshot.pending_memory.some(turn => turn.content.startsWith('persistent-fact-0:')));
    const input = f.history.getHistory();
    assert(input.length <= 32);
    assert(input.reduce((sum, turn) => sum + turn.content.length, 0) <= 12000);
    assert.match(input[0].content, /CONTEXT LIMIT.*incomplete/);
    assert(input.some(turn => turn.content.startsWith('persistent-fact-149:')));
    while (f.history.pending_memory.length) {
        const flush = f.history.flushMemories(true); await f.settle();
        assert(f.calls.at(-1).turns.length <= 32);
        f.calls.at(-1).resolve('Recovered verified recipe constraints from this batch.'); await flush;
    }
    assert.equal(f.history.pending_memory.length, 0);
});

test('an oversized newest observation is bounded only in the prompt projection', async () => {
    const f = fixture(), original = 'Verified server observation: ' + 'x'.repeat(20000);
    await f.history.add('system', original); await f.history.save();
    const input = f.history.getHistory();
    assert(input.reduce((sum, turn) => sum + turn.content.length, 0) <= 12000);
    assert.match(input[0].content, /CONTEXT LIMIT/);
    assert.equal(JSON.parse(f.files.get(f.history.memory_fp)).turns[0].content, original);
});

test('a hung memory request cannot indefinitely hold the next action inference', async () => {
    const f = fixture(); f.add(20); await f.settle();
    const flush = f.history.flushMemories(true); await f.settle();
    const originalRequest = f.history._summaryInFlight;
    const waiting = f.history.waitForMemory();
    const deadline = [...f.timers].find(timer => timer.ms === 8000);
    assert(deadline, 'action inference must have an independent eight second wait bound');
    deadline.fn(); await waiting;
    assert.equal(f.history._summaryInFlight, originalRequest, 'timeout does not duplicate or discard the summary');
    assert.equal(f.history.flushMemories(true), originalRequest);
    assert.equal(f.calls.length, 1);
    f.calls[0].resolve('Late verified server rule.'); await flush;
    assert.equal(f.history.memory, 'Late verified server rule.');
});

test('bounded prompt history keeps the newest command and result together', () => {
    const turns = Array.from({ length: 40 }, (_, i) => ({ role: 'system', content: `old fact ${i}` }));
    turns.push({ role: 'assistant', content: '!craftRecipe("stick", 2)' },
        { role: 'system', content: 'Crafted 8 sticks; measured inventory increase: 8.' });
    const input = boundedPromptHistory(turns);
    assert(input.length <= 32);
    assert.equal(input.at(-2).content, turns.at(-2).content);
    assert.equal(input.at(-1).content, turns.at(-1).content);
    assert.match(input[0].content, /CONTEXT LIMIT/);
    assert.equal(turns.length, 42);
});

test('an oversized assistant turn cannot hide the newest denial result', () => {
    const result = 'Protected land: permission denied; no blocks changed.';
    const original = 'Thinking aloud '.repeat(2000);
    const turns = [{ role: 'assistant', content: original }, { role: 'system', content: result }];
    const input = boundedPromptHistory(turns);
    assert(input.at(-2).content.length <= 1000);
    assert.equal(input.at(-1).content, result);
    assert.match(input.at(-2).content, /PROMPT PROJECTION OMITTED MIDDLE/);
    assert.equal(turns[0].content, original);
});

test('an oversized result retains its opening facts and final failure condition', () => {
    const turns = [{ role: 'assistant', content: '!mineOres("coal_ore", 8)' },
        { role: 'system', content: 'Measured gain: 0. ' + 'details '.repeat(3000) + 'FINAL: protection denied.' }];
    const input = boundedPromptHistory(turns);
    assert(input.reduce((sum, turn) => sum + turn.content.length, 0) <= 12000);
    assert.match(input.at(-1).content, /^Measured gain: 0\./);
    assert.match(input.at(-1).content, /FINAL: protection denied\.$/);
    assert.match(input.at(-1).content, /PROMPT PROJECTION OMITTED MIDDLE/);
});

test('summary backlog is oldest-first, bounded and yields before the next batch', async () => {
    const f = fixture(); f.add(150); await f.settle();
    assert.equal(f.calls.length, 1);
    assert(f.calls[0].turns.length <= 32);
    assert(f.calls[0].turns.reduce((sum, turn) => sum + turn.content.length, 0) <= 8000);
    assert.match(f.calls[0].turns[0].content, /^fact-0:/);
    f.calls[0].resolve('Verified first batch.'); await f.history.waitForMemory();
    assert.equal(f.calls.length, 1, 'completion must not immediately drain the whole backlog');
    assert(f.history.pending_memory.length > 0);
    assert([...f.timers].some(timer => timer.ms === 1000), 'capacity backlog gets a yielding scheduling window');
    const flush = f.history.flushMemories(true); await f.settle();
    assert.equal(f.calls[1].oldMemory, 'Verified first batch.');
    assert.match(f.calls[1].turns[0].content, /^fact-32:/);
    f.calls[1].resolve('Verified first and second batches.'); await flush;
});

test('oversized single-turn summary input is bounded while the full archive stays intact', async () => {
    const f = fixture(), original = 'Server rules opening. ' + 'detail '.repeat(3000) + ' Final protection rule.';
    f.history.pending_memory.push({ role: 'system', content: original });
    await f.history.appendFullHistory(f.history.pending_memory);
    const flush = f.history.flushMemories(true); await f.settle();
    assert(f.calls[0].turns.reduce((sum, turn) => sum + turn.content.length, 0) <= 8000);
    assert.match(f.calls[0].turns[0].content, /MEMORY INPUT LIMIT/);
    assert.match(f.calls[0].turns.at(-1).content, /^Server rules opening/);
    assert.match(f.calls[0].turns.at(-1).content, /Final protection rule\.$/);
    f.calls[0].resolve('Server protection rule learned.'); await flush;
    assert.equal(JSON.parse(f.files.get(f.history.full_history_fp))[0].content, original);
});
