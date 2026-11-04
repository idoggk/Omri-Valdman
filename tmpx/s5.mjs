import { readFileSync } from 'node:fs';
const J = (f) => JSON.parse(readFileSync('data/' + f, 'utf8'));
const b = J('booklet.json').questions.find(q=>q.id==='bk-p4'); console.log(JSON.stringify({stem:b.stem,eq:b.eq,parts:b.parts.map(p=>p.ask)}).slice(0,700));
console.log(J('physics.json').find(q=>q.id==='phys-vertical-040').statement);
console.log(JSON.stringify(J('notes.json').questions.filter(q=>/\^x\s*\+\s*4|=\s*-/.test((q.eq||[]).join(' ')))).slice(0,400));
