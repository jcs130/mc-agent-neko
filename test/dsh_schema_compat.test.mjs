import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { roleSchema } from '../services/dsh-supervisor/core.mjs';

const dshBin = process.env.NEKO_DSH_BIN ?? (process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/lib/bin.js') : null);
let validator;
if (dshBin && fs.existsSync(dshBin)) {
    const toolsPackage = createRequire(dshBin).resolve('@deepseek-ai/dsh-tools/package.json');
    validator = path.join(path.dirname(toolsPackage), 'lib/types/json-schema.js');
}

test('role output schemas pass the installed DSH validator, including no-candidate review',
    { skip: !validator && 'DSH is optional; install it to run its real schema compatibility gate' }, async () => {
        const { assertSupportedJsonSchema, validateJsonSchemaValue } = await import(pathToFileURL(validator).href);
        for (const role of ['observer', 'diagnoser', 'reviewer']) {
            for (const candidates of [[], ['real-issue']]) assert.doesNotThrow(() =>
                assertSupportedJsonSchema(roleSchema(role, ['game.self', 'native.failure'], candidates)));
        }
        const schema = roleSchema('reviewer', ['native.failure'], ['real-issue']);
        const report = { decision: 'accept', acceptedKeys: ['real-issue'], evidenceIds: ['native.failure'], summary: 'confirmed' };
        assert.deepEqual(validateJsonSchemaValue(schema, report), []);
        assert.ok(validateJsonSchemaValue(schema, { ...report, acceptedKeys: ['native.failure'] }).length);
        assert.deepEqual(validateJsonSchemaValue(roleSchema('reviewer', ['game.self'], []),
            { decision: 'reject', acceptedKeys: [], evidenceIds: [], summary: 'no issue' }), []);
    });
