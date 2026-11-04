import { readFileSync } from 'node:fs';
const J = (f) => JSON.parse(readFileSync('data/' + f, 'utf8'));
const show = (x) => console.log(JSON.stringify(x).slice(0, 700));
show(J('math.json')[3]); show(J('math.json')[40]); show(J('transfer.json')[0]); show(J('transfer.json')[20]); show(J('booklet.json').questions[0]); show(J('booklet.json').meta); show(J('recovery-hard.json')[0]); show(J('mathhard-radical.json')[0]); show(J('physics.json')[0].statement); show(J('multipart.json')[0].parts[0]);show(J('fading.json').examples[0]); show(J('notes.json').questions[0]);show(J('derive-math.json').tasks[0]); show(J('logs-ex-1.json')[0].eq)
