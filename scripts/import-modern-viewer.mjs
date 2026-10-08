import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const sourceRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/import-modern-viewer.mjs <Cortico checkout>');
const destination = path.resolve('src/agent/vision/modern');
const sourceRequire = createRequire(path.join(sourceRoot, 'package.json'));
const { build } = sourceRequire('esbuild');
const entry = path.join(sourceRoot, 'src/worlds/minecraft/modern-viewer.ts');
await mkdir(destination, { recursive: true });

const result = await build({
    entryPoints: [entry], outfile: path.join(destination, 'host.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node22',
    packages: 'external', metafile: true, legalComments: 'eof',
    plugins: [{
        name: 'neko-without-stream-overlay',
        setup(build) {
            build.onLoad({ filter: /[\\/]modern-viewer\.ts$/ }, async ({ path: filename }) => {
                let source = await readFile(filename, 'utf8');
                const speechSetup = /  const speechBubbleScript = await readFile\([\s\S]*?  const speechRelay = new ViewerSpeechRelay\([^;]+;/;
                if (!speechSetup.test(source)) throw new Error('Upstream speech setup changed; review the importer.');
                if (!source.includes('res.end(page); return;')) throw new Error('Upstream page output changed; review the importer.');
                source = source.replace(/import \{ ViewerSpeechRelay \} from '[^']+';\r?\n/, '')
                    .replace(speechSetup, "  const speakerScript = '';\n  const speechRelay = { handle: async () => false, close() {} };")
                    .replace(/'<iframe class="corti-speech-bubble"[^\n]+<\/iframe>',/, "'',")
                    .replace("'<script src=\"/speech-bubble.js\" defer></script>'", "''")
                    // Generated asset pages can contain the same overlay already.
                    .replace('res.end(page); return;', String.raw`res.end(page
                      .replace(/<iframe\b[^>]*\bid=["']corti-speech-bubble["'][^>]*>[\s\S]*?<\/iframe>/gi, '')
                      .replace(/<script\b[^>]*\bsrc=["']\/speech-bubble\.js["'][^>]*>[\s\S]*?<\/script>/gi, '')); return;`);
                return { contents: source, loader: 'ts', resolveDir: path.dirname(filename) };
            });
        },
    }],
});
await copyFile(path.join(sourceRoot, 'LICENSE'), path.join(destination, 'LICENSE'));
const bundle = await readFile(path.join(destination, 'host.mjs'));
await writeFile(path.join(destination, 'source.json'), JSON.stringify({
    repository: 'https://github.com/jcs130/Cortico',
    revision: execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    entry: 'src/worlds/minecraft/modern-viewer.ts',
    bundleSha256: createHash('sha256').update(bundle).digest('hex'),
    inputs: Object.keys(result.metafile.inputs).map(file => path.relative(sourceRoot, path.resolve(file)).replaceAll('\\', '/')),
    changes: ['Remove the host speech and livestream overlay; retain game rendering and sound.'],
}, null, 2) + '\n');
console.log(`Imported modern viewer host (${bundle.length} bytes).`);
