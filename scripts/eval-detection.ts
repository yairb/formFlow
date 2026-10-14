/**
 * Measures field detection against the generated fixtures with ground truth and
 * prints precision / recall / kind accuracy at the two confidence cut-offs the app
 * uses (0.3: shown as suggestions, 0.6: not flagged as uncertain).
 *
 *   npm run detect:eval            # summary table
 *   npm run detect:eval -- --details
 */
import '../tests/helpers/setup';
import { buildFixtures } from '../tests/fixtures/forms';
import { runFixture, totals, type FixtureScore } from '../tests/detection/evaluate';

const details = process.argv.includes('--details');
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const fixtures = await buildFixtures();
  for (const cutoff of [0.3, 0.6]) {
    const scores: FixtureScore[] = [];
    for (const fx of fixtures) scores.push(await runFixture(fx, cutoff));
    console.log(`\nConfidence ≥ ${cutoff}`);
    console.log('fixture'.padEnd(24), 'truth', ' det', '  tp', '  fp', '  fn', ' kind', ' scanned');
    for (const s of scores) {
      console.log(s.name.padEnd(24), String(s.truth).padStart(5), String(s.detected).padStart(4), String(s.tp).padStart(4), String(s.fp).padStart(4), String(s.fn).padStart(4), String(s.kindCorrect).padStart(5), ` ${s.scannedPages.map((p) => p + 1).join(',') || '-'}`);
      if (details) {
        for (const m of s.misses) console.log('    miss ', m);
        for (const m of s.falsePositives) console.log('    false', m);
        for (const m of s.kindErrors) console.log('    kind ', m);
      }
    }
    const t = totals(scores);
    console.log(`TOTAL  precision ${pct(t.precision)} (${t.tp}/${t.detected})  recall ${pct(t.recall)} (${t.tp}/${t.truth})  kind accuracy ${pct(t.kindAccuracy)} (${t.kindCorrect}/${t.tp})`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
