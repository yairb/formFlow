// Copies the pdf.js runtime data (CMaps, standard fonts, wasm decoders, ICC profiles)
// into public/pdfjs so the app can load them locally — never from a CDN.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgDir = dirname(require.resolve('pdfjs-dist/package.json'));
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const outDir = join(root, 'public', 'pdfjs');
const stamp = join(outDir, '.version');

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) process.exit(0);

mkdirSync(outDir, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(join(pkgDir, dir), join(outDir, dir), { recursive: true });
}
writeFileSync(stamp, version);
console.log(`Copied pdf.js ${version} assets to public/pdfjs`);
