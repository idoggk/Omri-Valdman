import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg } from '../js/sanitize.js';
import { isolateRanges, ltrIsolate } from '../js/bidi.js';

const OK = '<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="100" y2="50" stroke="currentColor"/><text x="5" y="20">h = 20</text></svg>';
const FORCES = '<svg viewBox="0 0 60 60"><defs><marker id="a"><path d="M0 0L5 2.5L0 5z"/></marker></defs><circle cx="30" cy="30" r="8" fill="none" stroke="currentColor"/><use href="#a"/></svg>';

test('clean svg is unchanged', () => {
  assert.equal(sanitizeSvg(OK), OK);
  assert.equal(sanitizeSvg(FORCES), FORCES);
});

test('script elements and content are removed', () => {
  const out = sanitizeSvg('<svg><script>alert(1)</script><circle r="2"/></svg>');
  assert.equal(out, '<svg><circle r="2"/></svg>');
  assert.ok(!/script|alert/i.test(sanitizeSvg('<svg><script>alert(1)</svg>') || ''));
});

test('on* attributes are removed (any quoting)', () => {
  const out = sanitizeSvg(`<svg onload="alert(1)"><circle onclick='x()' ONMOUSEOVER=y() r="2"/></svg>`);
  assert.ok(!/on\w+\s*=/i.test(out));
  assert.ok(out.includes('r="2"'));
});

test('javascript: and external hrefs are removed, local refs kept', () => {
  const out = sanitizeSvg('<svg><a href="javascript:alert(1)"><text>x</text></a><a xlink:href=" JaVa\nscript:alert(1)">y</a><use href="https://evil/x.svg#a"/><use href="#ok"/></svg>');
  assert.ok(!/javascript/i.test(out));
  assert.ok(!/evil/.test(out));
  assert.ok(out.includes('href="#ok"'));
});

test('foreignObject, iframe, animate and malformed tags are removed', () => {
  assert.ok(!/foreignobject|iframe|animate/i.test(sanitizeSvg('<svg><foreignObject><div>hi</div></foreignObject><iframe src="x"></iframe><animate attributeName="href" values="javascript:alert(1)"/><rect/></svg>')));
  assert.equal(sanitizeSvg('<svg onload=alert(1)'), '');
});

test('non-svg input yields empty string', () => {
  assert.equal(sanitizeSvg('<img src=x onerror=alert(1)>'), '');
  assert.equal(sanitizeSvg(null), '');
  assert.equal(sanitizeSvg(''), '');
});

test('bidi: ranges are isolated, plain numbers untouched', () => {
  assert.equal(isolateRanges('3–5 יח״ל'), ltrIsolate('3–5') + ' יח״ל');
  assert.equal(isolateRanges('טווח 10-12.5 מ׳'), 'טווח ' + ltrIsolate('10-12.5') + ' מ׳');
  assert.equal(isolateRanges('תרגיל 3 מתוך 5'), 'תרגיל 3 מתוך 5');
  assert.equal(isolateRanges(isolateRanges('3–5')), ltrIsolate('3–5'));
});
