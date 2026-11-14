// Token Launch Radar — the entrypoint (Node 22+, standard library only).
//
// Reads the sealed snapshot, ranks every pre-token protocol with the model in
// lib/radar.ts, and writes the whole hand-in: the ranked board, the
// dashboard's data, the page itself, the screenshots, and the dossier the
// judge reads. Run it as the grader does:
//
//   node main.ts --input <snapshot.json|directory> --output <directory>
//
// With no flags it reads /input/snapshot.json and writes /output; outside the
// grader's container MAKEFUN_OUTPUT_DIR stands in for /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program never touches the network and never writes outside its output
// directory. Every file it hands in is built from the snapshot at run time.

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPayload, payloadScript, readSnapshot, validateBoard } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap and the scorer's caps, from the competition's rules. */
const DOSSIER_TEXT_BYTES = 65_536;
const SHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASH_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value after `--name <value>` or `--name=<value>`, else the fallback. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const glued = argv.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputFlag = flagValue('input', '/input');
const snapshotPath = inputFlag.endsWith('.json') ? inputFlag : nodePath.join(inputFlag, 'snapshot.json');
if (!nodeFs.existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = readSnapshot(nodeFs.readFileSync(snapshotPath, 'utf8'));
const { board, payload } = buildPayload(snap);
const problem = validateBoard(board, snap);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

nodeFs.mkdirSync(outDir, { recursive: true });
nodeFs.writeFileSync(nodePath.join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
nodeFs.writeFileSync(nodePath.join(outDir, 'data.js'), payloadScript(payload));

/** Copy one directory's regular files into `to`, skipping dot-names; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!nodeFs.existsSync(from)) return [];
  nodeFs.mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of nodeFs.readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = nodePath.join(from, name);
    if (!nodeFs.statSync(path).isFile()) continue;
    nodeFs.copyFileSync(path, nodePath.join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(nodePath.join(repoRoot, 'dashboard'), nodePath.join(outDir, 'dashboard'));
if (dashFiles.length < 3 || !dashFiles.includes('index.html')) {
  fail(`dashboard/ holds ${dashFiles.length} files: hand in index.html with its .css and .js`);
}
const shots = copyDir(nodePath.join(repoRoot, 'screenshots'), nodePath.join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
nodeFs.writeFileSync(
  nodePath.join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_BYTES, screenshots: SHOT_LIMIT, dashboard: DASH_LIMIT }),
);

const early = payload.meta.early_rows;
process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows scored (${early} early, ${payload.meta.live_rows} live set aside)\n` +
    `token radar: anchor multiple ${payload.meta.anchor_multiple} from the snapshot's own live tokens\n` +
    `token radar: wrote ${nodePath.join(outDir, 'board.json')}, ${nodePath.join(outDir, 'data.js')}, ${nodePath.join(outDir, 'dashboard')} (${dashFiles.length} files), ${nodePath.join(outDir, 'screenshots')} (${shots.length} images) and ${nodePath.join(outDir, 'dossier.json')}\n`,
);
