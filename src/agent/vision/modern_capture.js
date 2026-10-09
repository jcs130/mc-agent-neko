import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Reuse the visible modern viewer. A short-lived browser process owns WebGL;
// Mineflayer never loads the native in-process headless-gl renderer.
export async function captureModernView(viewerUrl, { timeoutMs = 25000, signal,
    launchBrowser, fetcher = fetch, executablePath = browserExecutable() } = {}) {
    const url = new URL(viewerUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password)
        throw new Error('Vision capture requires the local 127.0.0.1 modern viewer.');
    signal?.throwIfAborted();
    const deadline = Date.now() + timeoutMs;
    const remaining = () => {
        signal?.throwIfAborted();
        const ms = deadline - Date.now();
        if (ms <= 0) throw new Error('Vision capture timed out.');
        return ms;
    };
    const health = await fetcher(`${url.origin}/healthz`, {
        signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(remaining())]),
    }).then(r => { if (!r.ok) throw new Error('Viewer health check failed.'); return r.json(); });
    if (!health.ok || !health.maxCaptureSessions || health.captureSessions >= health.maxCaptureSessions)
        throw new Error('Viewer capture unavailable or busy.');
    const lease = randomUUID();
    const headers = { 'x-mc-viewer-capture': '1', 'x-mc-viewer-capture-key': lease };
    let browser;
    let timer;
    const close = () => { void browser?.close().catch(() => {}); };
    signal?.addEventListener('abort', close, { once: true });
    try {
        const launch = launchBrowser || (options => import('playwright-core').then(({ chromium }) => chromium.launch(options)));
        browser = await launch({ executablePath, headless: true, timeout: remaining(),
            args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
        // An abort during browser startup must also close the newly created browser.
        remaining();
        timer = setTimeout(close, remaining());
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
            extraHTTPHeaders: headers });
        await page.goto(`${url.origin}/`, { waitUntil: 'domcontentloaded', timeout: remaining() });
        await page.waitForFunction(viewerCaptureReady, undefined, { polling: 100, timeout: remaining() });
        const jpeg = await page.locator('canvas[data-cortico-capture-scene="true"]')
            .screenshot({ type: 'jpeg', quality: 85, timeout: remaining() });
        if (!jpeg.length || jpeg.length > 12 * 1024 * 1024) throw new Error('Invalid viewer capture size.');
        return jpeg;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', close);
        if (browser) {
            await fetcher(`${url.origin}/capture-lease`, { method: 'DELETE', headers,
                signal: AbortSignal.timeout(2000) }).catch(() => {});
            await browser.close().catch(() => {});
        }
    }
}

export function browserExecutable() {
    return [process.env.NEKO_VISION_BROWSER,
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
        path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge',
    ].find(p => p && existsSync(p));
}

export function viewerCaptureReady() {
    const boot = document.querySelector('.boot');
    if (boot?.classList.contains('is-error')) throw new Error(boot.textContent || 'Viewer renderer failed.');
    if (!boot?.classList.contains('is-compact')) return false;
    const world = globalThis.world;
    const loaded = Object.keys(world?.loadedChunks || {});
    const meshed = Object.keys(world?.finishedChunks || {}).sort();
    if (!meshed.length || loaded.some(key => !world.finishedChunks[key])
        || world.sectionsWaiting?.size || world.messageQueue?.length) return false;
    const canvas = [...document.querySelectorAll('canvas')].find(c => {
        if (c.id === 'corti-tactical-canvas' || c.closest('.corti-minimap')) return false;
        const rect = c.getBoundingClientRect();
        return rect.width >= innerWidth / 2 && rect.height >= innerHeight / 2;
    });
    if (!canvas) return false;
    const chunks = meshed.join(';');
    const previous = globalThis.__nekoCapture;
    if (!previous || previous.chunks !== chunks) {
        globalThis.__nekoCapture = { chunks, since: performance.now() };
        return false;
    }
    if (performance.now() - previous.since < 350) return false;
    canvas.setAttribute('data-cortico-capture-scene', 'true');
    return true;
}
