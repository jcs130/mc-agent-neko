import test from 'node:test';
import assert from 'node:assert/strict';
import { captureModernView } from '../src/agent/vision/modern_capture.js';

function fixture({ busy = false, fail = false, abort } = {}) {
    const calls = [];
    const browser = { close: async () => calls.push('close'),
        newPage: async options => {
            calls.push(options);
            return { goto: async url => calls.push(url),
                waitForFunction: async () => { if (fail) throw new Error('renderer fault'); },
                locator: () => ({ screenshot: async () => Buffer.from('jpeg') }) };
        } };
    return { calls, options: { launchBrowser: async () => { abort?.(); return browser; },
        fetcher: async (url, options) => {
            if (options?.method === 'DELETE') { calls.push('release'); return { ok: true }; }
            return { ok: true, json: async () => ({ ok: true, captureSessions: busy ? 1 : 0, maxCaptureSessions: 1 }) };
        } } };
}

test('capture uses its separate localhost capture slot and releases it after a real frame', async () => {
    const f = fixture();
    assert.equal((await captureModernView('http://127.0.0.1:3000/', f.options)).toString(), 'jpeg');
    assert.equal(f.calls[0].extraHTTPHeaders['x-mc-viewer-capture'], '1');
    assert.equal(f.calls[1], 'http://127.0.0.1:3000/');
    assert.deepEqual(f.calls.slice(-2), ['release', 'close']);
});

test('renderer failure closes the browser and returns a real error', async () => {
    const f = fixture({ fail: true });
    await assert.rejects(captureModernView('http://127.0.0.1:3000/', f.options), /renderer fault/);
    assert.deepEqual(f.calls.slice(-2), ['release', 'close']);
});

test('abort during browser launch does not leak the newly created browser', async () => {
    const controller = new AbortController();
    const f = fixture({ abort: () => controller.abort(new Error('body replaced')) });
    await assert.rejects(captureModernView('http://127.0.0.1:3000/', { ...f.options, signal: controller.signal }), /body replaced/);
    assert.deepEqual(f.calls.slice(-2), ['release', 'close']);
});

test('busy capture does not open another browser or consume user viewing slots', async () => {
    const f = fixture({ busy: true });
    await assert.rejects(captureModernView('http://127.0.0.1:3000/', f.options), /busy/);
    assert.deepEqual(f.calls, []);
});

test('capture never connects to external or LAN model/viewer origins', async () => {
    for (const url of ['http://192.168.3.133:3000', 'https://example.com:3000', 'http://u:p@127.0.0.1:3000'])
        await assert.rejects(captureModernView(url, fixture().options), /local 127.0.0.1/);
});
