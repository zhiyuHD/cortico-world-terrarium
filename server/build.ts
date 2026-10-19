import { build } from 'esbuild';
import { copyFile, readFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const license = await readFile(new URL('../node_modules/ws/LICENSE', import.meta.url), 'utf8');
await build({
  absWorkingDir: root, entryPoints: ['server/index.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'dist/server.mjs',
  banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\n/*! Bundled ws license:\n${license}\n*/` },
});
await build({ absWorkingDir: root, entryPoints: ['webui/scene.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: 'dist/scene.js' });
await copyFile(new URL('./index.html', import.meta.url), new URL('../dist/index.html', import.meta.url));

await build({ absWorkingDir: root, entryPoints: ['server/console/client.ts'], bundle: true, external: ['/assets/*', './assets/*'], platform: 'browser', format: 'esm', target: 'es2022', outfile: 'dist/console/client.js' });
await copyFile(new URL('./console/index.html', import.meta.url), new URL('../dist/console/index.html', import.meta.url));
await cp(new URL('./console/assets', import.meta.url), new URL('../dist/console/assets', import.meta.url), { recursive: true });

for (const [entry, name] of [['release-cli.ts', 'release.mjs'], ['release-runner.ts', 'runner.mjs']]) {
  await build({ absWorkingDir: root, entryPoints: [`server/${entry}`], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: `dist/${name}` });
}
await copyFile(new URL('./migrate-flat.sh', import.meta.url), new URL('../dist/migrate-flat.sh', import.meta.url));
