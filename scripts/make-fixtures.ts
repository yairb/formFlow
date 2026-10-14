/**
 * Writes the detection fixtures (and their ground truth) to tests/fixtures/out/ so
 * they can be opened in FormFlow by hand or used by the e2e tests.
 *
 *   npm run fixtures
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildFixtures } from '../tests/fixtures/forms';

const outDir = fileURLToPath(new URL('../tests/fixtures/out/', import.meta.url));

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const fx of await buildFixtures()) {
    await writeFile(`${outDir}${fx.name}.pdf`, fx.bytes);
    await writeFile(`${outDir}${fx.name}.truth.json`, JSON.stringify({ description: fx.description, nativeLabels: fx.nativeLabels ?? [], truth: fx.truth }, null, 2));
    console.log(`${fx.name}.pdf  (${fx.truth.length} fields) — ${fx.description}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
