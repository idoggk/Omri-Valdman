import { readFileSync, readdirSync } from 'node:fs';
const ids = new Map();
const walk = (v, file, path) => {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, file, path + '[]'));
  else if (v && typeof v === 'object') {
    if (typeof v.id === 'string') { (ids.get(v.id) || ids.set(v.id, []).get(v.id)).push(file + ':' + path); }
    for (const [k, x] of Object.entries(v)) if (x && typeof x === 'object') walk(x, file, path + '.' + k);
  }
};
for (const f of readdirSync('data')) { if (!f.endsWith('.json')) continue; const d = JSON.parse(readFileSync('data/' + f, 'utf8')); console.log(f, Array.isArray(d) ? 'array ' + d.length : Object.keys(d).join(',')); walk(d, f, ''); }
let n = 0; for (const [id, w] of ids) if (w.length > 1) { n++; if (n < 40) console.log(id, w.join(' | ')); }
console.log('dups', n);
