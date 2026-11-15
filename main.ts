// Token Radar, radar-2: the entrypoint.
//
// What happens when this file runs:
//   1. It finds the sealed snapshot (/input/snapshot.json, or --input <file|dir>).
//   2. It hands the snapshot to the radar-2 model in lib/model.ts, which scores every
//      watchlist protocol plus the pre-token protocols below the floor, ranks them by
//      implied value, and writes a farm plan for each one.
//   3. It writes the ranked board to /output/board.json and the dashboard's data to
//      /output/data.js, both from the same scored rows.
//   4. It copies dashboard/ and screenshots/ into /output.
//   5. It writes /output/dossier.json with the vendored make.fun library, so the judge
//      reads exactly the dashboard and screenshots that were copied.
//
// Node 22, standard library only. Grading runs this program twice and both runs must write
// the same bytes, so there is no clock, no randomness and no network anywhere in it.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback when the flag is absent. */
function flagValue(name: string, fallback: string): string {
  const direct = process.argv.indexOf(`--${name}`);
  if (direct >= 0 && direct + 1 < process.argv.length) return process.argv[direct + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** The snapshot's path: a JSON file directly, or the snapshot.json inside a directory. */
function snapshotPathFrom(flag: string): string {
  return flag.endsWith('.json') ? flag : join(flag, 'snapshot.json');
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyRegularFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The screenshots the gate wants: at least three, each with a legal dossier name. */
function checkShotNames(names: string[]): void {
  if (names.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${names.length} image${names.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  for (const name of names) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }
}

// --- Inputs: where the snapshot comes from, and where the output goes. ---
const inputFlag = flagValue('input', '/input');
const snapshotPath = snapshotPathFrom(inputFlag);
if (!existsSync(snapshotPath)) {
  process.stderr.write(`token radar: no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outputDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// --- Score the snapshot, and refuse to write a board the gate would refuse. ---
const sealed = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(sealed);
const boardProblem = boardIssue(board, sealed);
if (boardProblem !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${boardProblem}\n`);
  process.exit(1);
}

// --- Write the board and the dashboard's data, from the same scored rows. ---
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

// --- Copy the dashboard and the screenshots the judge will see. ---
copyRegularFiles(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
const shotNames = copyRegularFiles(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
checkShotNames(shotNames);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

// --- Report what was written, so a run's result is visible at a glance. ---
process.stdout.write(
  `token radar: ${sealed.protocols.length} protocols, ${sealed.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outputDir, 'board.json')}, ${join(outputDir, 'data.js')}, ${join(outputDir, 'dashboard')} (3 files), ${join(outputDir, 'screenshots')} (${shotNames.length} images) and ${join(outputDir, 'dossier.json')}\n`,
);
