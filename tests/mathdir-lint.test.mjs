// Lint: a js/*-ui.js module must not write math-looking text (operators, ^, sqrt, Greek letters, equations) into the
// RTL page as a plain string; it goes through mathdir.js (mathInline / mathBlock / mathButton) or a local ltr wrapper
// so the bidi algorithm cannot reorder or clip it. Existing exceptions live in tests/mathdir-allowlist.json, each with a
// justification. Target: zero new entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const JS = new URL('../js/', import.meta.url);
const ALLOW = JSON.parse(readFileSync(new URL('./mathdir-allowlist.json', import.meta.url), 'utf8'));

// A string/template literal that looks like math.
const MATHY = [
  /\^/, /√|sqrt\s*\(/i, /[α-ωΑ-Ω]/, /π/,
  /[A-Za-z0-9)\]]\s[=+*/<>≤≥-]\s[A-Za-z0-9(√-]/, // spaced operator between two operands: "a + b", "x = 3"
  /\b(sin|cos|tan|log|ln)\s*\(/i,
  /\d\/\d/,
];
// Evidence on the same line that the text is wrapped for LTR display.
const WRAPPED = /mathInline|mathBlock|mathButton|\bcode\(|\bltr\(|\beq\(|\bline\(|\bmathLine\(|\bpara\(|dir:\s*'ltr'|dir="ltr"|math-ltr|math-inline|steps:|isolate|\bfmt\w*\(/;
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\\n]|\\.)*)`/g;
const IGNORE_LINE = /^\s*(\/\/|\*|\/\*|import\b|export \* from)/;
const NOT_TEXT = /^(#\/|\/|https?:|[\w-]+:\s*[\w.%-]+;?$|\.|[\w-]+$)/; // routes, urls, css, ids

export function findViolations(file, src) {
  const out = [];
  src.split('\n').forEach((raw, i) => {
    if (IGNORE_LINE.test(raw)) return;
    if (/\b(aria-label|class|style|href|id|type|role|key)\s*[:=]/.test(raw) && !/h\(/.test(raw)) return;
    for (const m of raw.matchAll(LITERAL)) {
      const full = m[1] ?? m[2] ?? m[3];
      if (!full || NOT_TEXT.test(full)) continue;
      const text = full.replace(/\$\{[^}]*\}/g, '·'); // interpolated code is not displayed math
      if (/^[^א-ת]*$/.test(text) && /^[\s·%:.,()/\d-]*$/.test(text)) continue;
      if (!/[א-ת]/.test(text) && !/[A-Za-z]/.test(text)) continue;
      if (!MATHY.some((re) => re.test(text))) continue;
      if (WRAPPED.test(raw)) continue;
      out.push({ file, line: i + 1, text: text.slice(0, 60).trim() });
    }
  });
  return out;
}

const files = readdirSync(JS).filter((f) => f.endsWith('-ui.js')).sort();

test('lint: scans every js/*-ui.js module', () => {
  assert.ok(files.length > 30, `expected the UI modules, got ${files.length}`);
});

test('lint: no unwrapped math text in js/*-ui.js outside the allowlist', () => {
  const allowed = new Set(ALLOW.entries.map((e) => `${e.file}|${e.text}`));
  const bad = [];
  for (const f of files) {
    for (const v of findViolations(f, readFileSync(join(JS.pathname.replace(/^\/(\w:)/, '$1'), f), 'utf8'))) {
      if (!allowed.has(`${v.file}|${v.text}`)) bad.push(`${v.file}:${v.line}  ${v.text}`);
    }
  }
  assert.deepEqual(bad, [], 'wrap with mathInline/mathBlock (js/mathdir.js) or add a justified entry to tests/mathdir-allowlist.json');
});

test('lint: allowlist entries are justified and still needed', () => {
  const live = new Set();
  for (const f of files) for (const v of findViolations(f, readFileSync(join(JS.pathname.replace(/^\/(\w:)/, '$1'), f), 'utf8'))) live.add(`${v.file}|${v.text}`);
  for (const e of ALLOW.entries) {
    assert.ok(e.why && e.why.length > 10, `${e.file}: ${e.text} needs a justification`);
    assert.ok(live.has(`${e.file}|${e.text}`), `stale allowlist entry ${e.file}: ${e.text}`);
  }
});

test('lint: detects an unwrapped equation and accepts a wrapped one', () => {
  assert.equal(findViolations('x-ui.js', "h('p', {}, 'פתרו: x^2 + 3x = 0')").length, 1);
  assert.equal(findViolations('x-ui.js', "h('p', {}, mathInline('x^2 + 3x = 0'))").length, 0);
  assert.equal(findViolations('x-ui.js', "location.hash = '#/trig/cards'").length, 0);
});
