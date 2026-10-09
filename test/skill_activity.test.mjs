import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

function fixture(modules) {
    const source = readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
    const begin = source.indexOf('export async function customSkill(');
    const end = source.indexOf('// ── Endgame milestone store', begin);
    const code = source.slice(begin, end).replace('export ', '')
        .replace(/await import\(pathToFileURL\(abs\).href \+ `\?t=\$\{Date.now\(\)\}`\)/, 'await loadModule(skillName)')
        .replace("await import('./skills.js')", '{}');
    const context = vm.createContext({ path, process, Date, world: {}, mc: {}, Vec3: {}, log() {},
        loadModule: async name => ({ default: modules[name] }) });
    vm.runInContext(code, context);
    return vm.runInContext('customSkill', context);
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('a late child cannot restore the name of an already finished parent skill', async () => {
    const child = deferred(), started = deferred();
    let run, childRun;
    run = fixture({ parent: async bot => { childRun = run(bot, 'child'); await started.promise; },
        child: async () => { started.resolve(); await child.promise; } });
    const bot = {};
    await run(bot, 'parent'); // parent raced out; child still genuinely running
    assert.equal(bot._currentSkill, 'child');
    child.resolve(); await childRun;
    assert.equal(bot._currentSkill ?? null, null, 'finished parent must not leave Neko busy forever');
});

test('concurrent invocations with the same skill name have distinct ownership', async () => {
    const older = deferred(), newer = deferred(), started = deferred();
    const run = fixture({ chopWood: async (_bot, _ctx, which) => {
        if (which === 'older') await older.promise;
        else { started.resolve(); await newer.promise; }
    } });
    const bot = {};
    const first = run(bot, 'chopWood', 'older');
    const second = run(bot, 'chopWood', 'newer');
    await started.promise; older.resolve(); await first;
    assert.equal(bot._currentSkill, 'chopWood', 'older finally must not clear the newer run');
    newer.resolve(); await second;
    assert.equal(bot._currentSkill ?? null, null);
});

test('normal nested skills restore the live parent and clear after exceptions', async () => {
    let run;
    run = fixture({ parent: async bot => { await run(bot, 'child'); assert.equal(bot._currentSkill, 'parent'); },
        child: async () => {} , broken: async () => { throw new Error('failed'); } });
    const bot = {};
    await run(bot, 'parent');
    await assert.rejects(run(bot, 'broken'), /failed/);
    assert.equal(bot._currentSkill ?? null, null);
});
