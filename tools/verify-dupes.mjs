// Duplicate lint for every question bank (data/*.json plus the banks that live in js/*-data.js).
//  1. IDS: no id may appear twice across all banks (blind / pressure / recovery attempts reuse these ids, so a clash would mix their history).
//     Ladder entries that only say { ref: '<id>' } are references, not banks, and are skipped.
//  2. STATEMENTS: no two items may show the same normalised statement (tags, spaces, minus/times signs, superscripts folded).
//  3. EQUATIONS: an equation of a RESERVED bank (data/transfer.json, data/booklet.json, data/recovery-hard.json: questions the learner must
//     meet unseen) must not appear in any practice bank, otherwise "unseen" is not true.
// Benign overlaps are listed with a reason in tools/dupes-allow.json (type 'id' | 'stmt' | 'eq' | 'pair'; see that file). Exit code 1 on any
// problem that is not allowed, or on an allowlist entry that no longer matches anything (so the list cannot rot).
// Usage: node tools/verify-dupes.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = process.env.VERIFY_DUPES_ROOT ? path.resolve(process.env.VERIFY_DUPES_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RESERVED_FILES = ['transfer', 'booklet', 'recovery-hard'];

/** [file, accessor(json) -> items]. */
const DATA_BANKS = [
  ...['math', 'physics', 'multipart', 'recover', 'recovery-hard', 'transfer', 'writing', 'findmistake', 'examples', 'logs-ex-1', 'logs-ex-2', 'logs-ex-3',
    'mathhard-circle', 'mathhard-exponent', 'mathhard-param', 'mathhard-radical', 'mathhard-rational'].map((f) => [f, (d) => d]),
  ['ladder', (d) => d.stages.flatMap((s) => s.items)],
  ['ladder-math', (d) => d.stages.flatMap((s) => s.items)],
  ...['checkpoints', 'edgecases', 'methods', 'reverse'].map((f) => [f, (d) => d.items]),
  ['booklet', (d) => d.questions],
  ['notes', (d) => d.questions],
  ['derive-math', (d) => d.tasks],
  ['derive-physics', (d) => d.tasks],
];
/** [module in js/, export name] for banks written as JS. */
const JS_BANKS = [['trig-data.js', 'PROOFS'], ['units-data.js', 'QUESTIONS'], ['counter-data.js', 'TASKS']];

const tags = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const SUP = { '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 };
/** Folds the typography variants of an expression so that equal maths compares equal. */
export function normalizeMath(s) {
  return tags(s).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => '^' + SUP[c]).replace(/[−–—‑]/g, '-').replace(/[×·⋅]/g, '*').replace(/√/g, 'sqrt')
    .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=').replace(/\s+/g, '').toLowerCase();
}
export const normalizeText = (s) => tags(s).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => '^' + SUP[c]).replace(/[−–—‑]/g, '-').replace(/[×·⋅]/g, '*').replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const isEquation = (n) => n.length >= 6 && /[=<>]|<=|>=/.test(n) && /[a-z]/.test(n);
const STMT_FIELDS = ['statement', 'stem', 'prompt', 'problem', 'html', 'ask'];

function equationsOf(e) {
  const out = new Set();
  const add = (s) => { const n = normalizeMath(s); if (isEquation(n)) out.add(n); };
  for (const k of ['eq', 'equations']) if (Array.isArray(e[k])) for (const x of e[k]) if (typeof x === 'string') add(x);
  for (const f of STMT_FIELDS) {
    if (typeof e[f] !== 'string') continue;
    for (const m of e[f].matchAll(/<span dir="ltr">([\s\S]*?)<\/span>/g)) add(m[1]);
  }
  return [...out];
}

/** Every item of every bank as { id, bank, reserved, stmt, eqs }. `root` is the repo root (tests pass a fixture directory). */
export async function collectItems(root = ROOT) {
  const items = [];
  const push = (bank, e) => {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || (e.ref && Object.keys(e).length <= 2)) return;
    const stmt = normalizeText(STMT_FIELDS.map((f) => (typeof e[f] === 'string' ? e[f] : '')).join(' ') + ' ' + (Array.isArray(e.eq) ? e.eq.join(' ') : ''));
    items.push({ id: e.id, bank, reserved: RESERVED_FILES.includes(bank), stmt, eqs: equationsOf(e) });
  };
  for (const [file, get] of DATA_BANKS) {
    const p = path.join(root, 'data', file + '.json');
    if (!existsSync(p)) continue;
    for (const e of get(JSON.parse(readFileSync(p, 'utf8')))) push(file, e);
  }
  for (const [mod, name] of JS_BANKS) {
    const p = path.join(root, 'js', mod);
    if (!existsSync(p)) continue;
    const list = (await import(pathToFileURL(p).href))[name];
    for (const e of Array.isArray(list) ? list : []) push(mod.replace(/\.js$/, ''), e);
  }
  return items;
}

/** Problems as { type, key, detail, ids }. */
export function findProblems(items) {
  const out = [];
  const byId = new Map();
  for (const it of items) (byId.get(it.id) || byId.set(it.id, []).get(it.id)).push(it);
  for (const [id, list] of byId) if (list.length > 1) out.push({ type: 'id', key: id, ids: [id], detail: `id "${id}" used ${list.length} times: ${list.map((x) => x.bank).join(', ')}` });
  const byStmt = new Map();
  for (const it of items) if (it.stmt.length >= 20) (byStmt.get(it.stmt) || byStmt.set(it.stmt, []).get(it.stmt)).push(it);
  for (const [stmt, list] of byStmt) {
    const ids = [...new Set(list.map((x) => x.id))];
    if (ids.length > 1) out.push({ type: 'stmt', key: ids.sort().join('|'), ids, detail: `same statement in ${ids.join(', ')}: "${stmt.slice(0, 60)}"` });
  }
  const practice = new Map();
  for (const it of items) if (!it.reserved) for (const q of it.eqs) (practice.get(q) || practice.set(q, []).get(q)).push(it);
  for (const it of items) {
    if (!it.reserved) continue;
    for (const q of it.eqs) for (const other of practice.get(q) || []) {
      const ids = [it.id, other.id].sort();
      out.push({ type: 'eq', key: q, pair: ids.join('|'), ids, detail: `reserved ${it.id} (${it.bank}) shares the equation "${q}" with practice ${other.id} (${other.bank})` });
    }
  }
  return out;
}

/** Splits problems by the allowlist: { bad, allowed, stale }. An entry { type, key } allows a problem; for 'eq' it can also be { type: 'pair', key: 'idA|idB' }. */
export function applyAllow(problems, allow) {
  const used = new Set();
  const bad = [];
  const allowed = [];
  const matches = (a, p) => (a.type === p.type && a.key === p.key) || (a.type === 'pair' && p.type === 'eq' && a.key === p.pair);
  for (const p of problems) {
    const idx = allow.findIndex((a) => matches(a, p));
    if (idx >= 0) { used.add(idx); allowed.push(p); } else bad.push(p);
  }
  return { bad, allowed, stale: allow.filter((a, i) => !used.has(i)) };
}

export function loadAllow(root = ROOT) {
  const p = path.join(root, 'tools', 'dupes-allow.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).allow || [] : [];
}

export async function check(root = ROOT) {
  const items = await collectItems(root);
  return { items, ...applyAllow(findProblems(items), loadAllow(root)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await check();
  for (const p of r.bad) console.error('DUPLICATE ' + p.type + ': ' + p.detail + (p.pair ? `   (allow with { "type": "pair", "key": "${p.pair}" })` : ''));
  for (const a of r.stale) console.error('STALE allowlist entry (matches nothing): ' + JSON.stringify(a));
  console.log(`verify-dupes: ${r.items.length} items, ${r.allowed.length} allowed overlaps, ${r.bad.length} problems, ${r.stale.length} stale allowlist entries`);
  process.exit(r.bad.length || r.stale.length ? 1 : 0);
}
