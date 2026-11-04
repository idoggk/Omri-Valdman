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

const MANIFEST_RE = /^\/\/ BEGIN PRECACHE_HASHES[^\n]*\n[\s\S]*?^\/\/ END PRECACHE_HASHES[^\n]*$/m;

/** path -> sha256 (first 32 hex chars) of each precached file; text files are hashed with LF endings. sw.js verifies copied entries against it. */
export function computeManifest(root = ROOT) {
  const files = precacheFiles(readFileSync(root + 'sw.js', 'utf8'));
  const out = {};
  for (const f of [...new Set(files)]) {
    let buf = readFileSync(root + f);
    if (TEXT.test(f)) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'));
    out[f] = createHash('sha256').update(buf).digest('hex').slice(0, 32);
  }
  return out;
}

export function manifestBlock(manifest) {
  const rows = Object.entries(manifest).map(([f, h]) => `  '${f}': '${h}',`);
  return ['// BEGIN PRECACHE_HASHES (written by tools/stamp-version.mjs; do not edit by hand)',
    'const PRECACHE_HASHES = {', ...rows, '};', '// END PRECACHE_HASHES'].join('\n');
}

/** The manifest block currently embedded in sw.js (LF-normalized), or null. */
export function stampedManifestBlock(sw) {
  const m = MANIFEST_RE.exec(sw.replace(/\r\n/g, '\n'));
  return m ? m[0] : null;
}

function main() {
  const swPath = ROOT + 'sw.js';
  const sw = readFileSync(swPath, 'utf8');
  const fresh = computeHash();
  const have = stampedHash(sw);
  const block = manifestBlock(computeManifest());
  const blockOk = stampedManifestBlock(sw) === block;
  if (process.argv.includes('--check')) {
    if (have === fresh && blockOk) { console.log('stamp ok: ' + fresh); return; }
    console.error(`BUILD_HASH is ${have} but the precached files hash to ${fresh}` + (blockOk ? '' : ' (PRECACHE_HASHES is also stale)') + '. ' +
      'Run: node tools/stamp-version.mjs, then bump CACHE_VERSION (sw.js), APP_VERSION (js/pwa.js) and tests/sw.test.mjs.');
    process.exitCode = 1;
    return;
  }
  const line = `const BUILD_HASH = '${fresh}'; // written by tools/stamp-version.mjs; do not edit by hand`;
  const crlf = sw.includes('\r\n');
  let next = sw.replace(/\r\n/g, '\n');
  next = have === null ? next.replace(/^(const CACHE_NAME = .*)$/m, `$1\n${line}`) : next.replace(STAMP_RE, line);
  next = MANIFEST_RE.test(next) ? next.replace(MANIFEST_RE, () => block) : next.replace(/^(const PRECACHE = \[[\s\S]*?\];)$/m, (m) => `${m}\n\n${block}`);
  if (crlf) next = next.replace(/\n/g, '\r\n'); // keep the file's own line endings
  if (next !== sw) writeFileSync(swPath, next);
  console.log((have === fresh && blockOk ? 'unchanged: ' : 'stamped: ') + fresh);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
