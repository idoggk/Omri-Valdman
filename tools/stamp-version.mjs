// Build stamp: hashes every file in sw.js PRECACHE and writes the result into sw.js as BUILD_HASH.
//   node tools/stamp-version.mjs          write the stamp
//   node tools/stamp-version.mjs --check  exit 1 when the stamp does not match the files
// It bumps nothing: after the stamp changes, raise CACHE_VERSION (sw.js), APP_VERSION (js/pwa.js) and the
// version assertion in tests/sw.test.mjs yourself (see README, "עדכון גרסה").
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEXT = /\.(js|json|css|html|webmanifest)$/;
const STAMP_RE = /^const BUILD_HASH = '([0-9a-f]*)';.*$/m;

export function precacheFiles(sw) {
  const list = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1];
  return [...list.matchAll(/'([^']+)'/g)].map((m) => (m[1] === './' ? 'index.html' : m[1]));
}

/** sha256 (first 16 hex chars) over the path and content of every PRECACHE file, in list order. */
export function computeHash(root = ROOT) {
  const files = precacheFiles(readFileSync(root + 'sw.js', 'utf8'));
  const h = createHash('sha256');
  for (const f of files) {
    let buf = readFileSync(root + f);
    if (TEXT.test(f)) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n')); // same hash on every checkout
    h.update(f + '\0');
    h.update(buf);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

export function stampedHash(sw) {
  const m = STAMP_RE.exec(sw);
  return m ? m[1] : null;
}

function main() {
  const swPath = ROOT + 'sw.js';
  const sw = readFileSync(swPath, 'utf8');
  const fresh = computeHash();
  const have = stampedHash(sw);
  if (process.argv.includes('--check')) {
    if (have === fresh) { console.log('stamp ok: ' + fresh); return; }
    console.error(`BUILD_HASH is ${have} but the precached files hash to ${fresh}. ` +
      'Run: node tools/stamp-version.mjs, then bump CACHE_VERSION (sw.js), APP_VERSION (js/pwa.js) and tests/sw.test.mjs.');
    process.exitCode = 1;
    return;
  }
  const line = `const BUILD_HASH = '${fresh}'; // written by tools/stamp-version.mjs; do not edit by hand`;
  let next = have === null ? sw.replace(/^(const CACHE_NAME = .*)$/m, `$1\n${line}`) : sw.replace(STAMP_RE, line);
  if (sw.includes('\r\n')) next = next.replace(/\r?\n/g, '\r\n'); // keep the file's own line endings
  if (next !== sw) writeFileSync(swPath, next);
  console.log((have === fresh ? 'unchanged: ' : 'stamped: ') + fresh);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
