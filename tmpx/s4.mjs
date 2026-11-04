import { readFileSync } from 'node:fs';
const J = (f) => JSON.parse(readFileSync('data/' + f, 'utf8'));
const t = (x) => Array.isArray(x) ? 'arr' + x.length : typeof x === 'object' ? 'obj:' + Object.keys(x).slice(0,6) : typeof x;
console.log(t(J('fading.json').examples), t(J('notes.json').questions), t(J('derive-math.json').tasks), t(J('booklet.json').questions), t(J('checkpoints.json').items));
const f = J('fading.json').examples; console.log(Object.keys(f), JSON.stringify(f).slice(0,300));
console.log(JSON.stringify(J('derive-math.json').tasks).slice(0,200));
console.log(JSON.stringify(J('notes.json').questions).slice(0,200));
