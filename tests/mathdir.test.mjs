import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const M = await import('../js/mathdir.js');
const T = await import('../js/trig-ui.js');
const { LESSONS, PROOFS } = await import('../js/trig-data.js');

const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show };
const MATHY = /[=]|\b(?:sin|cos|tan)\(/;
const HEBREW = /[\u0590-\u05ff]/;

/** Every element carrying math-looking text with no Hebrew in it must sit inside a dir=ltr element. */
function unprotected(root) {
  const bad = [];
  const inLtr = (n) => { for (let p = n; p; p = p.parent) if (p.attrs && p.attrs.dir === 'ltr') return true; return false; };
  root.walk((n) => {
    const own = n.tagName && (n._text != null ? n._text : n.children.filter((c) => c.nodeType === 3).map((c) => c.data).join(''));
    const text = String(own || '').replace(/[⁦⁩]/g, '');
    if (n.tagName && n.tagName !== 'BUTTON' && MATHY.test(text) && !HEBREW.test(text) && !inLtr(n)) bad.push(text);
  });
  return bad;
}

test('mathBlock / mathInline / mathButton always carry dir=ltr', () => {
  assert.equal(M.mathBlock('a = b').attrs.dir, 'ltr');
  assert.match(M.mathBlock('a = b', 'x').className, /math-ltr x/);
  assert.equal(M.mathInline('a = b').attrs.dir, 'ltr');
  const b = M.mathButton('-2', { 'aria-label': 'x' });
  assert.equal(b.attrs.dir, 'ltr');
  assert.equal(b.attrs['aria-label'], 'x');
});

test('orderBlankOptions sorts plain numbers ascending, keeps other options as given', () => {
  assert.deepEqual(M.orderBlankOptions(['2', '-1', '-2', '1']), ['-2', '-1', '1', '2']);
  assert.deepEqual(M.orderBlankOptions(['2', '−1']), ['−1', '2']);
  assert.deepEqual(M.orderBlankOptions(['-', '+', '- 2', '+ 2']), ['-', '+', '- 2', '+ 2']);
  assert.deepEqual(M.orderBlankOptions([{ o: '3' }, { o: '1' }], (e) => e.o), [{ o: '1' }, { o: '3' }]);
});

test('trig fill drill: blank is visible, whole template is in an ltr block, options are labelled and ordered', () => {
  const f10 = { id: 'f10', kind: 'fill', template: 'cos(a) - cos(b) = ? sin((a+b)/2)sin((a-b)/2)', options: ['-2', '2', '-1', '1'], ans: 0 };
  const blk = M.mathBlock(f10.template.replace('?', '___'));
  assert.equal(blk.attrs.dir, 'ltr');
  assert.match(blk.textContent + blk.innerHTML, /cos\(a\) - cos\(b\) = ___ sin/);
});

test('every trig screen: math text sits inside dir=ltr elements (hub, lessons, cards, drill, proofs)', () => {
  T.viewTrigRoute(ctx, undefined);
  assert.deepEqual(unprotected(dom.root), []);
  for (const l of LESSONS) {
    T.viewTrigRoute(ctx, 'learn', l.id);
    assert.deepEqual(unprotected(dom.root), [], `lesson ${l.id}`);
  }
  T.viewTrigRoute(ctx, 'cards');
  assert.deepEqual(unprotected(dom.root), []);
  for (let round = 0; round < 3; round++) {
    T.viewTrigRoute(ctx, 'drill');
    for (let i = 0; i < 12; i++) {
      assert.deepEqual(unprotected(dom.root), [], 'drill item');
      const choices = dom.root.all((n) => n.tagName === 'BUTTON' && n.attrs['aria-label'] && /^במקום החסר/.test(n.attrs['aria-label']));
      if (choices.length) {
        assert.ok(choices.every((c) => c.attrs.dir === 'ltr'), 'blank choices are ltr');
        const nums = choices.map((c) => c.textContent);
        if (nums.every((s) => /^-?\d+$/.test(s))) assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
        choices[0].click();
      } else {
        const wrongBtns = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === 'זו השגויה');
        if (!wrongBtns.length) break;
        wrongBtns[0].click();
      }
      assert.deepEqual(unprotected(dom.root), [], 'drill feedback');
      const next = dom.root.all((n) => n.tagName === 'BUTTON' && /הבא|לסיום/.test(n.textContent))[0];
      if (!next) break;
      next.click();
    }
  }
  for (const p of PROOFS) {
    T.viewTrigRoute(ctx, 'proof', p.id);
    assert.deepEqual(unprotected(dom.root), [], `proof ${p.id}`);
    for (const b of dom.root.all((n) => n.tagName === 'BUTTON' && n.attrs.dir === 'ltr')) assert.equal(b.attrs.dir, 'ltr');
  }
});

// ---- static audit of all screens that print math: the patterns that caused the clipped-line bug ----
const files = readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js'));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8')]));

test('static: an element styled direction:ltr also has dir=ltr (attribute) or comes from the shared helper', () => {
  const bad = [];
  for (const [f, s] of Object.entries(src)) {
    s.split('\n').forEach((line, i) => {
      if (/direction:\s*ltr/.test(line) && !/dir:\s*'ltr'|mathButton|mathBlock|mathInline/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('static: no element is both a nowrap eq-block display and a steps container (nested clipping scroller)', () => {
  const bad = [];
  for (const [f, s] of Object.entries(src)) {
    s.split('\n').forEach((line, i) => {
      if (/h\('div',\s*\{\s*class:\s*(?:cls|'[^']*eq-block[^']*'|`[^`]*eq-block[^`]*`)[^}]*\bsteps\b/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('static: every h() element that is a math display (eq-block / cp-eqs line) carries dir=ltr', () => {
  const bad = [];
  for (const [f, s] of Object.entries(src)) {
    if (f === 'dom.js') continue;
    s.split('\n').forEach((line, i) => {
      if (/class:\s*'eq-block'/.test(line) && !/dir:\s*'ltr'/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('css: math containers never use overflow:hidden and may scroll', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  for (const sel of ['.eq-block', '.math-ltr']) {
    const m = css.match(new RegExp(`^${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm'));
    assert.ok(m, sel);
    assert.ok(!/overflow(-x)?:\s*hidden/.test(m[1]), `${sel} must not clip`);
    assert.match(m[1], /overflow-x:\s*auto/);
    assert.match(m[1], /direction:\s*ltr/);
  }
  assert.ok(!/\.eq-block\s*\{[^}]*white-space:\s*nowrap/.test(css), 'eq-block wraps');
});
