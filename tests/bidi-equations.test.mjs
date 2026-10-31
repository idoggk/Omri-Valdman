import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { isolateFormulas, isolateFormulasHtml, ltrIsolate } from '../js/bidi.js';

installFakeDom();
const { h } = await import('../js/dom.js');
const LRI = '⁦';
const PDI = '⁩';

// the exact strings seen wrongly ordered on the iPhone (fading stage 1)
const CASES = [
  ['הנוסחה היא s(t) = 10t + 5t² בכל רגע.', 's(t) = 10t + 5t²', ' בכל רגע.'],
  ['נפתור: 10t + 5 = 55.', '10t + 5 = 55', '.'],
  ["לכן h = s(5) = 10·5 + 5·25 = 50 + 125 = 175 מ'.", "h = s(5) = 10·5 + 5·25 = 50 + 125 = 175 מ'", '.'],
  ['המרחק בשנייה האחרונה: s(t) − s(t − 1), ואז נציב.', 's(t) − s(t − 1)', ', ואז נציב.'],
  ['לפי הנוסחה 60² = 10² + 2·10·175 = 3600.', '60² = 10² + 2·10·175 = 3600', '.'],
  ['המהירות v = 20 מ/ש, ולכן ממשיכים.', 'v = 20 מ/ש', ', ולכן ממשיכים.'],
  ['גובה המצוק: h = ½·g·T² = 5·9 = 45 מטר.', 'h = ½·g·T² = 5·9 = 45 מטר', '.'],
  ["v₀² = v² − v_y² = 2500 − 900 = 1600, ולכן.", "v₀² = v² − v_y² = 2500 − 900 = 1600", ", ולכן."],
  ["ולכן v₀ = 40 מ'/ש.", "v₀ = 40 מ'/ש", "."],
  ["רכיב אנכי בפגיעה: v_y = g·T = 30 מ'/ש.", "v_y = g·T = 30 מ'/ש", "."],
  ['h = 45 · v0 = 40', 'h = 45 · v0 = 40', ''],
  ['הרכיב האנכי של המהירות בפגיעה הוא g·T.', 'g·T', '.'],
  ['האם a = b = c = d?', 'a = b = c = d', '?'],
];

test('each equation is one LTR isolate; trailing punctuation stays outside, unit stays inside', () => {
  for (const [src, run, tail] of CASES) {
    const out = isolateFormulas(src);
    assert.ok(out.includes(LRI + run + PDI), `${src} -> ${out}`);
    assert.ok(out.endsWith(PDI + tail), `${src} -> ${out}`);
    assert.equal(out.split(LRI).length, 2, `one isolate only: ${out}`);
  }
});

test('idempotent, pure Hebrew and plain numbers untouched', () => {
  for (const [src] of CASES) {
    const once = isolateFormulas(src);
    assert.equal(isolateFormulas(once), once);
    assert.equal(isolateFormulasHtml(isolateFormulasHtml(src)), isolateFormulasHtml(src));
  }
  assert.equal(isolateFormulas('טקסט עברי בלבד, בלי נוסחאות.'), 'טקסט עברי בלבד, בלי נוסחאות.');
  assert.equal(isolateFormulas('תוצאה 175 מ\' וגם 3 · נפתרו'), 'תוצאה 175 מ\' וגם 3 · נפתרו');
  assert.equal(isolateFormulas(ltrIsolate('x = 1')), ltrIsolate('x = 1'));
});

test('html: sub/sup stay inside the run, tags and entities untouched, no injection', () => {
  const out = isolateFormulasHtml('<p>אם v<sub>0</sub> = 10 + t<sup>2</sup>, אז x &lt; 3.</p>');
  assert.ok(out.includes(LRI + 'v<sub>0</sub> = 10 + t<sup>2</sup>' + PDI + ', אז'), out);
  assert.ok(out.includes('&lt;'));
  assert.equal(out.replace(/[⁦⁩]/g, '').replace(/<[^>]*>/g, '').includes('<'), false);
  assert.equal(isolateFormulasHtml('<b onclick="x=1">עברית</b>'), '<b onclick="x=1">עברית</b>');
});

test('render path: h() text children and html/rawhtml are isolated', () => {
  const el = h('p', {}, CASES[2][0]);
  assert.ok(el.textContent.includes(LRI + CASES[2][1] + PDI + '.'));
  const raw = h('li', { rawhtml: '<span>s(t) = 10t + 5t²</span>.' });
  assert.ok(raw.innerHTML.includes('<span>' + LRI + 's(t) = 10t + 5t²' + PDI + '</span>.'));
  const html = h('li', { html: 'נפתור 10t + 5 = 55.' });
  assert.ok(html.innerHTML.includes(LRI + '10t + 5 = 55' + PDI + '.'));
});

function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

test('data: no equation containing "=" is left unisolated after rendering', () => {
  const files = ['examples', 'fading', 'ladder', 'checkpoints', 'methods', 'drills', 'findmistake', 'edgecases', 'reverse', 'skills', 'physics', 'math', 'formulas'];
  const bad = [];
  let seen = 0;
  for (const f of files) {
    const p = new URL(`../data/${f}.json`, import.meta.url);
    if (!existsSync(p)) continue;
    for (const s of strings(JSON.parse(readFileSync(p, 'utf8')))) {
      if (!s.includes('=')) continue;
      seen++;
      const left = isolateFormulasHtml(s)
        .replace(/⁦[^⁩]*⁩/g, '') // isolated runs
        .replace(/<svg[\s\S]*?<\/svg>/g, '')
        .replace(/<(\w+)[^>]*\bdir="ltr"[^>]*>.*?<\/\1>/g, '') // data already marks some runs dir=ltr
        .replace(/<[^>]*>/g, '').replace(/&#?\w+;/g, '');
      if (/[A-Za-zα-ωΔ0-9²³)°]\s*=\s*[A-Za-zα-ωΔ0-9(−-]/.test(left)) bad.push(`${f}: ${left.slice(0, 120)}`);
    }
  }
  assert.ok(seen > 50, 'scanned equations: ' + seen);
  assert.deepEqual(bad.slice(0, 10), []);
});

test('html: literal v_y and v0 become subscripts inside the isolate', () => {
  const out = isolateFormulasHtml('<li>v_y = g·T, v0 = 40</li>');
  assert.ok(out.includes(LRI + 'v<sub>y</sub> = g·T, v<sub>0</sub> = 40' + PDI), out);
  assert.equal(isolateFormulasHtml(out), out);
});
