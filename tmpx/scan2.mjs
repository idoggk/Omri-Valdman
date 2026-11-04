import { readFileSync } from 'node:fs';
const J = (f) => JSON.parse(readFileSync('data/' + f, 'utf8'));
const B = {};
const arr = (f) => J(f);
for (const f of ['math','physics','multipart','recover','recovery-hard','transfer','writing','findmistake','examples','logs-ex-1','logs-ex-2','logs-ex-3','mathhard-circle','mathhard-exponent','mathhard-param','mathhard-radical','mathhard-rational']) B[f] = arr(f + '.json');
B['ladder'] = J('ladder.json').stages.flatMap(s=>s.items); B['ladder-math'] = J('ladder-math.json').stages.flatMap(s=>s.items);
for (const f of ['checkpoints','edgecases','methods','reverse']) B[f] = J(f+'.json').items;
B.fading = J('fading.json').examples; B.booklet = J('booklet.json').questions; B.notes = J('notes.json').questions; B['derive-math']=J('derive-math.json').tasks; B['derive-physics']=J('derive-physics.json').tasks;
const seen = new Map();
for (const [f, l] of Object.entries(B)) { console.log(f, l.length, Object.keys(l[0]).join(',').slice(0,150)); for (const e of l) { if (!e.id) { console.log('NOID', f, JSON.stringify(e).slice(0,80)); continue;} (seen.get(e.id) || seen.set(e.id, []).get(e.id)).push(f); } }
for (const [id, w] of seen) if (w.length > 1) console.log('DUP', id, w.join(','));
