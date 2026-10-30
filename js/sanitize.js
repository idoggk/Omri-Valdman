// Sanitizer for trusted-but-defensive inline SVG diagrams. No DOM.
// Removes scripts and other active content, on*= attributes, and non-local hrefs.

const BLOCKED_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'animate', 'set', 'animatetransform', 'animatemotion', 'handler', 'listener']);
const TAG_RE = /<(\/?)([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR_RE = /([^\s=\/"'<>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function cleanAttrs(raw) {
  let out = '';
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = m[1];
    const lower = name.toLowerCase();
    const value = m[2] === undefined ? null : m[2].replace(/^["']|["']$/g, '');
    if (lower.startsWith('on')) continue;
    if (lower === 'href' || lower.endsWith(':href')) {
      if (value === null || !value.trim().startsWith('#')) continue; // only in-document refs
    }
    if (value !== null && /(javascript|vbscript)\s*:/i.test(value.replace(/[\s\u0000-\u001f]/g, ''))) continue;
    if (lower === 'style' && value !== null && /url\s*\(|expression\s*\(|@import/i.test(value)) continue;
    out += value === null ? ` ${name}` : ` ${name}="${value.replace(/"/g, '&quot;')}"`;
  }
  return out;
}

/** Returns a safe SVG string, or '' when the input is not an <svg> document fragment. */
export function sanitizeSvg(input) {
  if (typeof input !== 'string') return '';
  let s = input.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, '');
  // drop <script>…</script> including content; an unclosed script drops everything after it
  s = s.replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, '');
  s = s.replace(/<(foreignObject|iframe|object|embed)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
  s = s.replace(TAG_RE, (all, slash, name, attrs) => {
    if (BLOCKED_TAGS.has(name.toLowerCase())) return '';
    if (slash) return `</${name}>`;
    const selfClose = /\/\s*$/.test(attrs);
    const body = cleanAttrs(selfClose ? attrs.replace(/\/\s*$/, '') : attrs);
    return `<${name}${body}${selfClose ? '/' : ''}>`;
  });
  s = s.trim();
  if (s.replace(TAG_RE, '').includes('<')) return ''; // unterminated / malformed tag
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg\s*>$/i.test(s)) return '';
  return s;
}
