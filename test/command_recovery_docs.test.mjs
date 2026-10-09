import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function docs(names, blocked = []) {
    const context = vm.createContext({
        queryList: [], actionsList: names.map(name => ({ name, description: `Description ${name}` })),
    });
    const source = readFileSync(new URL('../src/agent/commands/index.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, context);
    return vm.runInContext('getCommandDocs', context)({ blocked_actions: blocked });
}

test('actual command docs foreground available recovery entry points', () => {
    const text = docs(['!inventory', '!equip', '!craftRecipe', '!goToSurface', '!pillarUp']);
    const brief = text.split('Detailed commands:')[0];
    assert.match(brief, /Recovery entry points/);
    assert.match(brief, /!goToSurface.*!pillarUp/s);
    assert.match(brief, /prerequisites/);
});

test('recovery brief never advertises missing or blocked commands', () => {
    const text = docs(['!inventory', '!goToSurface', '!pillarUp'], ['!goToSurface', '!pillarUp']);
    assert.doesNotMatch(text, /!goToSurface|!pillarUp|!craftRecipe|!serverCommand/);
    assert.match(text, /!inventory/);
});
