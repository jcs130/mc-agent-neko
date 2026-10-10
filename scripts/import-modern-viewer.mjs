import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const sourceRoot = path.resolve(process.argv[2] || '');
const rendererRoot = path.resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3]) {
    throw new Error('Usage: node scripts/import-modern-viewer.mjs <Cortico checkout> <mc-visual-console checkout>');
}
const rendererDirectory = 'packages/modern-viewer/renderer-src';
const rendererHost = path.join(rendererRoot, rendererDirectory, 'host');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
git(sourceRoot, 'diff', '--quiet', 'HEAD', '--', 'src/worlds/minecraft');
git(rendererRoot, 'diff', '--quiet', 'HEAD', '--', rendererDirectory);
const rendererSource = {
    repository: 'https://github.com/jcs130/mc-visual-console',
    revision: git(rendererRoot, 'rev-parse', 'HEAD'), directory: rendererDirectory,
    gitTree: git(rendererRoot, 'rev-parse', `HEAD:${rendererDirectory}`),
    minecraftVersion: '1.20.6', socketProtocol: `${rendererDirectory}/SOCKET_PROTOCOL.md`,
    license: 'MIT', licenseFile: 'RENDERER_LICENSE',
};
function replaceOnce(source, before, after, label) {
    if (source.split(before).length !== 2) throw new Error(`Upstream ${label} changed; review the importer.`);
    return source.replace(before, after);
}
const destination = path.resolve('src/agent/vision/modern');
const sourceRequire = createRequire(path.join(sourceRoot, 'package.json'));
const { build } = sourceRequire('esbuild');
const entry = path.join(sourceRoot, 'src/worlds/minecraft/modern-viewer.ts');
await mkdir(destination, { recursive: true });

const result = await build({
    absWorkingDir: sourceRoot,
    entryPoints: [path.relative(sourceRoot, entry)], outfile: path.join(destination, 'host.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node22',
    packages: 'external', metafile: true, legalComments: 'eof',
    plugins: [{
        name: 'neko-without-stream-overlay',
        setup(build) {
            build.onResolve({ filter: /^neko-shared-viewer\/content$/ }, () => ({
                path: path.join(rendererHost, 'viewer-content.mjs'),
            }));
            build.onResolve({ filter: /^\.\/viewer-asset-server\.ts$/ }, () => ({
                path: path.join(rendererHost, 'viewer-asset-server.mjs'),
            }));
            build.onLoad({ filter: /[\\/]modern-viewer\.ts$/ }, async ({ path: filename }) => {
                let source = (await readFile(filename, 'utf8')).replace(/\r\n/g, '\n');
                const speechSetup = / {2}const speechBubbleScript = await readFile\([\s\S]*? {2}const speechRelay = new ViewerSpeechRelay\([^;]+;/;
                if (!speechSetup.test(source)) throw new Error('Upstream speech setup changed; review the importer.');
                if (!source.includes('res.end(page); return;')) throw new Error('Upstream page output changed; review the importer.');
                const viewerStart = 'export async function startModernViewer(bot: mineflayer.Bot, options: ModernViewerOptions): Promise<ModernViewerHandle> {';
                if (!source.includes('const MAX_SESSIONS = 2;') || !source.includes(viewerStart)) {
                    throw new Error('Upstream viewer session configuration changed; review the importer.');
                }
                source = source.replace(/import \{ ViewerSpeechRelay \} from '[^']+';\r?\n/, '')
                    .replace('const MAX_SESSIONS = 2;', '')
                    .replace(viewerStart, `${viewerStart}
  const MAX_SESSIONS = options.maxSessions ?? 8;
  if (!Number.isInteger(MAX_SESSIONS) || MAX_SESSIONS < 1 || MAX_SESSIONS > 16) {
    throw new Error('modern viewer: maxSessions must be an integer from 1 to 16');
  }`)
                    .replace(speechSetup, "  const speakerScript = '';\n  const speechRelay = { handle: async () => false, close() {} };")
                    .replace(/'<iframe class="corti-speech-bubble"[^\n]+<\/iframe>',/, "'',")
                    .replace("'<script src=\"/speech-bubble.js\" defer></script>'", "''")
                    // Generated asset pages can contain the same overlay already.
                    .replace('res.end(page); return;', String.raw`res.end(page
                      .replace(/<iframe\b[^>]*\bid=["']corti-speech-bubble["'][^>]*>[\s\S]*?<\/iframe>/gi, '')
                      .replace(/<script\b[^>]*\bsrc=["']\/speech-bubble\.js["'][^>]*>[\s\S]*?<\/script>/gi, '')); return;`);
                source = "import { createViewerContentBridge } from 'neko-shared-viewer/content';\n" + source;
                source = replaceOnce(source, '  const viewerSockets = new Set<Socket>();',
                    '  const content = createViewerContentBridge(bot);\n  const viewerSockets = new Set<Socket>();', 'content lifecycle');
                source = replaceOnce(source, "    socket.emit('version', bot.version);",
                    "    socket.emit('version', bot.version);\n    content.subscribeSocket(socket);", 'content subscription');
                source = replaceOnce(source, '    first.close(); third.close();\n    throw error;',
                    '    content.dispose();\n    first.close(); third.close();\n    throw error;', 'failed-start cleanup');
                source = replaceOnce(source, '      closed = true;\n      speechRelay.close();',
                    '      closed = true;\n      content.dispose();\n      speechRelay.close();', 'content shutdown');
                source = replaceOnce(source, "  protocol.on('world_particles', onParticle);", '', 'legacy particle registration');
                source = replaceOnce(source, "      protocol.off('world_particles', onParticle);", '', 'legacy particle cleanup');
                return { contents: source, loader: 'ts', resolveDir: path.dirname(filename) };
            });
        },
    }],
});
await copyFile(path.join(sourceRoot, 'LICENSE'), path.join(destination, 'LICENSE'));
await copyFile(path.join(rendererRoot, 'LICENSE'), path.join(destination, 'RENDERER_LICENSE'));
let bundle = await readFile(path.join(destination, 'host.mjs'), 'utf8');
const healthPayload = '{ ok: !closed, version: bot.version, ...sessionSlots.status() }';
if (!bundle.includes(healthPayload)) throw new Error('Upstream health response changed; review the importer.');
bundle = bundle.replace('import { Vec3 as Vec33 } from "vec3";',
    'import { Vec3 as Vec33 } from "vec3";\nimport { gameOnline } from "../game_health.js";')
    .replace(healthPayload, '{ ok: !closed, gameOnline: gameOnline(bot), version: bot.version, ...sessionSlots.status() }');
if (!bundle.includes('import { gameOnline }')) throw new Error('Upstream imports changed; review the importer.');
await writeFile(path.join(destination, 'host.mjs'), bundle);
function inputsFrom(root) {
    return Object.keys(result.metafile.inputs).map(file => path.relative(root, path.resolve(sourceRoot, file)))
        .filter(file => file && !file.startsWith('..') && !path.isAbsolute(file))
        .map(file => file.replaceAll('\\', '/'));
}
await writeFile(path.join(destination, 'source.json'), JSON.stringify({
    repository: 'https://github.com/jcs130/Cortico',
    revision: git(sourceRoot, 'rev-parse', 'HEAD'),
    entry: 'src/worlds/minecraft/modern-viewer.ts',
    bundleSha256: createHash('sha256').update(bundle).digest('hex'),
    inputs: inputsFrom(sourceRoot),
    renderer: { ...rendererSource, inputs: inputsFrom(rendererRoot) },
    changes: ['Remove the host speech and livestream overlay; retain game rendering and sound.',
        'Make concurrent viewing configurable (default 8, range 1-16); keep the separate capture limit.',
        'Report Minecraft connection health separately from the renderer HTTP listener.',
        'Observe original particle, map and TextDisplay packets through the shared renderer bridge; remove the duplicate legacy particle path.',
        'Serve original font ZIP resources through the shared bounded asset server.'],
}, null, 2) + '\n');
await writeFile(path.join(destination, 'renderer-source.json'), JSON.stringify(rendererSource, null, 2) + '\n');
console.log(`Imported modern viewer host (${bundle.length} bytes).`);
