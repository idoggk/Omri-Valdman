// Prints how many equation display blocks of data/*.json convert to TeX (and render in the vendored KaTeX) vs fall back to text.
// Usage: node tools/mathtex-report.mjs [--list]   (--list prints the fallback strings)
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { splitStep } from '../js/eqblocks.js';
import { plainToParts } from '../js/mathtex.js';

const root = new URL('../', import.meta.url);

export function loadKatexNode() {
  try { return createRequire(import.meta.url)('../vendor/katex/katex.min.js'); } catch { return null; }
}

/** Every distinct equation-block value the splitter produces from any string in data/*.json, with its file. */
export function collectEquations() {
  const found = new Map();
  for (const name of readdirSync(new URL('data/', root)).filter((n) => n.endsWith('.json')).sort()) {
    const walk = (o) => {
      if (typeof o === 'string') {
        for (const b of splitStep(o)) if (b.kind === 'eq' && !found.has(b.value)) found.set(b.value, name);
      } else if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    };
    walk(JSON.parse(readFileSync(new URL('data/' + name, root), 'utf8')));
  }
  return found;
}

/** { total, converted, withHebrew, fallbacks: [[value, file]] } using KaTeX (if given) to validate. */
export function scanEquations(katex) {
  const validate = katex ? (tex) => { try { katex.renderToString(tex, { throwOnError: true, strict: 'ignore' }); return true; } catch { return false; } } : undefined;
  const stats = { total: 0, converted: 0, withHebrew: 0, fallbacks: [] };
  const perFile = {};
  for (const [value, file] of collectEquations()) {
    stats.total++;
    const row = (perFile[file] ??= { total: 0, converted: 0, fallback: 0 });
    row.total++;
    const parts = plainToParts(value, { validate });
    if (parts) {
      stats.converted++;
      row.converted++;
      if (parts.some((p) => p.kind === 'he')) stats.withHebrew++;
    } else { stats.fallbacks.push([value, file]); row.fallback++; }
  }
  return { ...stats, perFile };
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const katex = loadKatexNode();
  const r = scanEquations(katex);
  console.log(`KaTeX validation: ${katex ? 'on (vendored ' + katex.version + ')' : 'OFF (library not found)'}`);
  console.log('file'.padEnd(24) + 'total'.padStart(7) + 'converted'.padStart(11) + 'fallback'.padStart(10));
  for (const [file, s] of Object.entries(r.perFile)) console.log(file.padEnd(24) + String(s.total).padStart(7) + String(s.converted).padStart(11) + String(s.fallback).padStart(10));
  console.log('TOTAL'.padEnd(24) + String(r.total).padStart(7) + String(r.converted).padStart(11) + String(r.fallbacks.length).padStart(10));
  console.log(`converted ${(100 * r.converted / r.total).toFixed(1)}% (${r.withHebrew} with Hebrew unit/word parts), fallback ${(100 * r.fallbacks.length / r.total).toFixed(1)}%`);
  if (process.argv.includes('--list')) for (const [v, f] of r.fallbacks) console.log(`  [${f}] ${v}`);
}
