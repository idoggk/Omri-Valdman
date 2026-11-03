// Consistency lint for topic tags and levels of the math pools (math.json, ladder-math.json, mathhard-*.json, logs-ex-*.json).
//  1. TOPIC TAGS: keyword rules (exponential, logarithm, radical, circle, trigonometry) look at the displayed statement
//     and equation text. An item that shows such a keyword must carry a topic that is allowed for it, and a radical
//     topic needs a radical in the text. (Lesson of the 2026-11-03 audit: exponential items tagged math-rad, circle and
//     trig items tagged math-par.)
//  2. LEVELS: items are grouped by a method signature taken from the equation text (pool, family, kind, equation or
//     inequality, number of logarithms / radicals / powers, nesting). A level that is more than 1 away from the median
//     level of its group (groups of 3 or more) is reported. Levels are never compared across pools because the scales differ.
// Ids are never touched by this tool: saved attempts and backups are keyed by id, a level or topic change does not break them.
// Usage: node tools/verify-levels.mjs   (add --groups to print every group)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

export const POOLS = {
  math: { files: ['math.json'], level: (e) => e.level, topic: (e) => e.topic },
  ladder: { files: ['ladder-math.json'], level: (e) => e.level, topic: (e) => e.topic },
  mathhard: {
    files: ['mathhard-radical.json', 'mathhard-exponent.json', 'mathhard-rational.json', 'mathhard-param.json', 'mathhard-circle.json'],
    level: (e) => e.tier, topic: (e) => `math-hard-${e.family}`,
  },
  logs: { files: ['logs-ex-1.json', 'logs-ex-2.json', 'logs-ex-3.json'], level: (e) => e.tier, topic: () => 'logs' },
};

export function loadPools() {
  const out = {};
  for (const [name, p] of Object.entries(POOLS)) {
    out[name] = p.files.flatMap((f) => {
      const d = readJson(f);
      return Array.isArray(d) ? d : d.stages.flatMap((s) => s.items);
    }).filter((e) => e && e.id);
  }
  return out;
}

/* ---------- text of an item as the student sees it ---------- */
const strip = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
export const textOf = (e) => strip([e.title, e.statement, e.ask, ...(e.eq || [])].join(' '));
const eqText = (e) => strip((e.eq || []).join(' ')) || strip(e.statement);

/* ---------- 1. topic keywords ---------- */
// keyword -> test on the item text, and the topics an item showing it may carry
export const KEYWORDS = [
  { id: 'exp', test: (t) => /\d\^\(?[^\s=)]*x/.test(t) || /\bא?י?־?שוויון מעריכי|משוואה מעריכית|משוואה מעריכית/.test(t),
    topics: ['math-pow', 'math-lg', 'math-par', 'math-ineq', 'logs', 'math-hard-exponent', 'math-hard-param'] },
  { id: 'log', test: (t) => /\blog_|\blg\b|\blog[₂₃₅]|לוגריתם/.test(t),
    topics: ['math-lg', 'math-par', 'math-ineq', 'math-pow', 'logs', 'math-hard-exponent', 'math-hard-param'] },
  { id: 'radical', test: (t) => /√|משוואת שורש|שורשים מקוננים/.test(t),
    topics: ['math-rad', 'math-par', 'math-ineq', 'math-3', 'math-hard-radical', 'math-hard-param', 'math-hard-rational'] },
  { id: 'circle', test: (t) => /מעגל/.test(t), topics: ['math-hard-circle', 'math-hard-param', 'math-3', 'math-4'] }, // math-3/4: a circle inside a multi-unknown system
  { id: 'trig', test: (t) => /\b(sin|cos|tan|cot)\b|\b(sin|cos|tan|cot)\s*\(|טריגונומט/.test(t), topics: ['trig'] },
];

export function topicErrors(pools) {
  const errors = [];
  for (const [name, list] of Object.entries(pools)) {
    for (const e of list) {
      const topic = POOLS[name].topic(e);
      const t = textOf(e);
      for (const k of KEYWORDS) {
        if (k.id === 'radical' && KEYWORDS[0].test(t)) continue; // an exponential equation may contain a root
        if (k.test(t) && !k.topics.includes(topic)) errors.push(`${e.id}: text shows "${k.id}" but topic is ${topic}`);
      }
      if (topic === 'math-rad' && !/√|שורש/.test(t)) errors.push(`${e.id}: topic math-rad but there is no radical in the text`);
    }
  }
  return errors;
}

/* ---------- 2. method signature and level spread ---------- */
const count = (s, re) => (s.match(re) || []).length;
// Logarithm exercises: a few explicit method classes (anything else is not compared)
function logsMethod(e, q) {
  const ineq = /[<>≤≥]/.test(q);
  const nLogs = count(q, /\blog_|\blg\b/g);
  const linArg = /\b(log_\S+|lg)\(\s*\d*x\s*[-+]/.test(q);
  if (/^A\s*=/.test(q)) return 'logs|evaluate';
  if (/^f\(x\)/.test(q)) return null; // domain questions
  if (/\bm\b/.test(q)) return 'logs|parameter';
  if ((e.eq || []).length > 1 || /\by\b/.test(q)) return 'logs|system';
  if (/\^/.test(q) || !linArg) return null;
  if (ineq) return nLogs >= 2 ? 'logs|ineq-two-logs' : null;
  return nLogs >= 2 ? 'logs|sum-or-difference' : 'logs|single-linear-argument';
}

export function methodOf(pool, e) {
  // linear systems are levelled by size and coefficients, not by method: no meaningful group
  if (['math-3', 'math-4'].includes(e.topic)) return null;
  const q = eqText(e);
  if (pool === 'logs') return logsMethod(e, q);
  const logs = count(q, /\blog_|\blg\b/g);
  const rads = count(q, /√/g);
  const pows = count(q, /\^/g);
  const ineq = /[<>≤≥]/.test(q);
  const nested = /√[^√]*√/.test(q) && /√\([^)]*√/.test(q);
  const lineArg = /\b(log_\S+|lg)\(\s*\d*x\s*[-+]/.test(q);
  const parts = [pool, e.family || e.topic || '', e.kind || '', e.derive || '', e.prop || '', /xy/.test(q.replace(/\s/g, '')) ? 'hyperbola' : '', ineq ? 'ineq' : 'eq', `L${Math.min(logs, 2)}`, `R${Math.min(rads, 3)}`, `P${pows ? 1 : 0}`, nested ? 'nested' : '', lineArg ? 'linarg' : ''];
  return parts.filter(Boolean).join('|');
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function groupItems(pools) {
  const groups = new Map();
  for (const [name, list] of Object.entries(pools)) {
    for (const e of list) {
      const lvl = POOLS[name].level(e);
      if (!Number.isFinite(lvl)) continue;
      const key = methodOf(name, e);
      if (key === null) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id: e.id, level: lvl });
    }
  }
  return groups;
}

export function levelErrors(pools, minGroup = 3) {
  const errors = [];
  for (const [key, items] of groupItems(pools)) {
    if (items.length < minGroup) continue;
    const med = median(items.map((x) => x.level));
    for (const x of items) if (Math.abs(x.level - med) > 1) errors.push(`${x.id}: level ${x.level} is more than 1 away from the median ${med} of method group "${key}"`);
  }
  return errors;
}

export function validate(pools = loadPools()) {
  const errors = [...topicErrors(pools), ...levelErrors(pools)];
  const ids = new Set();
  for (const list of Object.values(pools)) for (const e of list) { if (ids.has(e.id)) errors.push(`${e.id}: duplicate id`); ids.add(e.id); }
  return { errors, items: ids.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pools = loadPools();
  if (process.argv.includes('--groups')) {
    for (const [key, items] of groupItems(pools)) if (items.length >= 3) console.log(key, items.map((x) => `${x.id}:${x.level}`).join(' '));
  }
  const { errors, items } = validate(pools);
  console.log(`levels: ${items} items checked`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('OK: topic tags match their keywords and no level is more than 1 from its method median.');
}
