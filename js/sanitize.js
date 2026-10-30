// Sanitizer for trusted-but-defensive inline SVG diagrams. No DOM.
// Removes scripts and other active content, on*= attributes, and non-local hrefs.

const BLOCKED_TAGS = new Set(['script', 'style', 'link', 'image', 'a', 'foreignobject', 'iframe', 'object', 'embed', 'animate', 'set', 'animatetransform', 'animatemotion', 'handler', 'listener']);
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
    if (value !== null && (URL_REF_RE.test(value) || /@import|expression\s*\(/i.test(value))) continue;
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
  s = s.replace(/<(foreignObject|iframe|object|embed|style)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
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

const ALLOWED_ELEMENTS = new Set(['svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'defs', 'marker', 'title', 'desc', 'lineargradient', 'radialgradient', 'stop', 'use', 'clippath', 'pattern']);
const URL_REF_RE = /url\s*\(\s*(?!["']?\s*#)/i;

/** Browser-only second pass: DOMParser + element/attribute allowlist (no-op without DOMParser). */
function allowlistDom(svg) {
  if (typeof DOMParser === 'undefined') return svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return svg;
  const walk = (el) => {
    for (const child of Array.from(el.children)) {
      if (!ALLOWED_ELEMENTS.has(child.localName.toLowerCase())) { child.remove(); continue; }
      walk(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      const v = attr.value;
      const isHref = n === 'href' || n.endsWith(':href');
      if (n.startsWith('on') || (isHref && !v.trim().startsWith('#')) || URL_REF_RE.test(v) || /@import|javascript:/i.test(v)) el.removeAttribute(attr.name);
    }
  };
  walk(root);
  return new XMLSerializer().serializeToString(root);
}

/** Full sanitizer: regex pass, then a DOM allowlist pass when a DOM is available. */
export function sanitizeSvgSafe(input) {
  const s = sanitizeSvg(input);
  return s ? allowlistDom(s) : '';
}
