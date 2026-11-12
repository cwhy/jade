// SPDX-License-Identifier: MPL-2.0
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'artifacts/site');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(path.join(root, 'site'), output, { recursive: true });
const imports = {};
// Explicit export map, with no dependency on a CDN, bundler or npm registry.
for (const directory of readdirSync(path.join(root, 'packages'))) {
  if (directory === 'testkit') continue;
  const source = path.join(root, 'packages', directory);
  const manifest = JSON.parse(readFileSync(path.join(source, 'package.json')));
  cpSync(path.join(source, 'src'), path.join(output, 'modules', directory, 'src'), { recursive: true });
  cpSync(path.join(source, 'LICENSE'), path.join(output, 'modules', directory, 'LICENSE'));
  for (const [entry, target] of Object.entries(manifest.exports))
    imports[manifest.name + entry.slice(1)] = './modules/' + directory + '/' + target.replace(/^\.\//, '');
}
const html = readFileSync(path.join(output, 'index.html'), 'utf8');
writeFileSync(path.join(output, 'index.html'), html.replace('<!-- IMPORT_MAP -->', `<script type="importmap">${JSON.stringify({ imports })}</script>`));
writeFileSync(path.join(output, '.nojekyll'), '');
cpSync(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
console.log('Built GitHub Pages site: artifacts/site');
