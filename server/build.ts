import { build } from 'esbuild';
import { copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const license = await readFile(new URL('../node_modules/ws/LICENSE', import.meta.url), 'utf8');
await build({
  absWorkingDir: root, entryPoints: ['server/index.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'dist/server.mjs',
  banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\n/*! Bundled ws license:\n${license}\n*/` },
});
await build({ absWorkingDir: root, entryPoints: ['webui/scene.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: 'dist/scene.js' });
await copyFile(new URL('./index.html', import.meta.url), new URL('../dist/index.html', import.meta.url));
