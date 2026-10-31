// Splits a solution step into Hebrew sentence lines and display-equation blocks. No DOM.
// Input: plain text or the HTML subset used in data (<sub>, <sup>, <span dir="ltr">, <br>); output values are
// HTML fragments (& < > escaped). Equation detection is the one in bidi.js (isolateFormulas).
import { isolateFormulas } from './bidi.js';

const LRI = '⁦';
const PDI = '⁩';
const SUBSUP = { '<sub>': '', '</sub>': '', '<sup>': '', '</sup>': '' };
const SUBSUP_BACK = Object.fromEntries(Object.entries(SUBSUP).map(([tag, ch]) => [ch, tag]));
const ENT_BASE = 0xe100;
const EQ_RE = /[=≤≥<>]/;
const AFTER_EQ = /^[\s.,;:!?⟵⟶←→–—]+/; // punctuation that trailed the previous equation
const BEFORE_EQ = /[\s⟵⟶←→–—]+$/;
const OTHER_TAG = /<(?!\/?(?:sub|sup|span)\b)\/?[A-Za-z]/i;
const LTR_SPAN = /<span\s+dir\s*=\s*["']?ltr["']?\s*>((?:[^<]|<\/?su[bp]>)*?)<\/span>/gi;

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function splitLine(src) {
  const whole = [{ kind: 'text', value: src }];
  if (!src.trim()) return [];
  if (OTHER_TAG.test(src)) return whole; // unknown markup: never cut it apart
  let t = src.replace(LTR_SPAN, (_, inner) => LRI + inner + PDI);
  if (/<\/?span\b/i.test(t)) return whole;
  const stash = [];
  t = t.replace(/<\/?su[bp]>/gi, (m) => SUBSUP[m.toLowerCase()])
    .replace(/&(lt|gt|amp|nbsp);|&#?\w+;/g, (m, name) => {
      if (name) return { lt: '<', gt: '>', amp: '&', nbsp: ' ' }[name];
      stash.push(m);
      return String.fromCharCode(ENT_BASE + stash.length - 1);
    });
  const finish = (s) => escape(s.replace(/[⁦⁩]/g, ''))
    .replace(/[-]/g, (c) => SUBSUP_BACK[c])
    .replace(/[-]/g, (c) => stash[c.charCodeAt(0) - ENT_BASE]);

  const parts = isolateFormulas(t).split(/(⁦[^⁩]*⁩)/);
  const isRun = (p, i) => i % 2 === 1;
  if (!parts.some((p, i) => isRun(p, i) && EQ_RE.test(p))) return whole;

  const out = [];
  let buf = '';
  const flush = (beforeEq) => {
    let s = buf;
    buf = '';
    if (out.length && out[out.length - 1].kind === 'eq') s = s.replace(AFTER_EQ, '');
    if (beforeEq) s = s.replace(BEFORE_EQ, '');
    s = s.trim();
    if (s) out.push({ kind: 'text', value: finish(s) });
  };
  parts.forEach((p, i) => {
    if (isRun(p, i) && EQ_RE.test(p)) {
      flush(true);
      out.push({ kind: 'eq', value: finish(p.trim()) });
    } else buf += p;
  });
  flush(false);
  return out;
}

/** Splits one step into [{kind:'text'|'eq', value}] (see the header comment). Idempotent on its own values. */
export function splitStep(step) {
  return String(step ?? '').split(/<br\s*\/?>/i).flatMap(splitLine);
}

const SUB_VAR = /([A-Za-zα-ω])_([A-Za-z0-9]+)/g;
const SUB_DIGIT = /(?<![A-Za-z0-9α-ω])([A-Za-zα-ω])(\d)(?![\dA-Za-z.])/g;
const HE_UNIT = /[א-ת][א-ת'׳"״/²³]*/g;

/** Display markup for one equation value (HTML in, HTML out): v_y / v0 get subscripts, Hebrew units a bdi dir=rtl. */
export function eqHtml(value) {
  return String(value).split(/(<[^>]*>|&#?\w+;)/).map((part, i) => {
    if (i % 2) return part;
    return part.replace(SUB_VAR, '$1<sub>$2</sub>').replace(SUB_DIGIT, '$1<sub>$2</sub>')
      .replace(HE_UNIT, (m) => `<bdi dir="rtl">${m}</bdi>`);
  }).join('');
}
