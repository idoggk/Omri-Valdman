// Static import graph of js/*.js (used by tests: how many modules does a root pull in at load time).
// Only static `import ... from` and `export ... from` count; dynamic import() is a lazy edge.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STATIC = /^\s*(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

export function staticImports(rel) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const dir = dirname(rel);
  return [...src.matchAll(STATIC)].map((m) => m[1]).filter((s) => s.startsWith('.'))
    .map((s) => normalize(join(dir, s)).replace(/\\/g, '/'));
}

/** All modules reachable from `root` through static imports, root included. */
export function reachable(root) {
  const seen = new Set();
  const walk = (f) => { if (seen.has(f)) return; seen.add(f); staticImports(f).forEach(walk); };
  walk(root);
  return seen;
}

/** Longest static import chain length from root (cycle-safe). */
export function depth(root) {
  const memo = new Map();
  const d = (f, stack) => {
    if (memo.has(f)) return memo.get(f);
    if (stack.has(f)) return 0;
    stack.add(f);
    const v = 1 + Math.max(0, ...staticImports(f).map((x) => d(x, stack)));
    stack.delete(f);
    memo.set(f, v);
    return v;
  };
  return d(root, new Set());
}
