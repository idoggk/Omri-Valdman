#!/usr/bin/env node
// Offline analyzer for the JSON exported from the app's feedback screen (js/feedback.js buildExport).
// Usage: node tools/analyze-feedback.mjs <export.json> [--out <dir>]
// Prints a short Markdown report and writes content-overrides-proposal.json next to the input.
// Suggestions only: it never reads or modifies answers or app data. Not part of the shipped app.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROPOSAL_FILE = 'content-overrides-proposal.json';
const TAG_LABELS = {
  understand: 'להבין את השאלה', method: 'לבחור שיטה', start: 'להתחיל', algebra: 'אלגברה / מניפולציה', calc: 'חישובים',
  signs: 'סימנים', quartic: 'משוואות רביעיות', diagram: 'שרטוט / דיאגרמה', formula: 'נוסחה שלא זוכר',
  units: 'יחידות / צירים', time: 'עניין הזמן', long: 'ארוך מדי', other: 'אחר',
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const round1 = (n) => Math.round(n * 10) / 10;
const avg = (xs) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

/** Skill = topic; template = exercise id without its trailing number / variant suffix (phys-vertical-007 -> phys-vertical). */
export function templateOf(id) {
  return String(id).replace(/[:#@].*$/, '').replace(/[-_]?\d+$/, '') || String(id);
}

/** Tolerant normalisation: any missing field gets a safe default; records without id or rating are dropped. */
export function normalize(raw) {
  const list = isObj(raw) && Array.isArray(raw.records) ? raw.records : Array.isArray(raw) ? raw : [];
  const out = [];
  list.forEach((r, i) => {
    if (!isObj(r) || typeof r.exerciseId !== 'string' || !r.exerciseId) return;
    const rating = Number(r.rating);
    if (r.rating == null || r.rating === '' || !Number.isFinite(rating)) return;
    const conf = r.confident ?? r.confidence;
    out.push({
      exerciseId: r.exerciseId,
      topic: typeof r.topic === 'string' && r.topic ? r.topic : 'unknown',
      template: templateOf(r.exerciseId),
      rating: Math.min(10, Math.max(1, Math.round(rating))),
      tags: Array.isArray(r.hardTags) ? [...new Set(r.hardTags.filter((t) => typeof t === 'string'))] : [],
      correct: typeof r.correct === 'boolean' ? r.correct : null,
      hints: Number.isFinite(r.hintsUsed) ? r.hintsUsed : 0,
      solutionViewed: r.solutionViewed === true,
      confident: typeof conf === 'boolean' ? conf : null,
      ts: Number.isFinite(r.ts) ? r.ts : 0,
      order: i,
    });
  });
  return out.sort((a, b) => a.ts - b.ts || a.order - b.order);
}

const groupBy = (xs, key) => {
  const g = new Map();
  for (const x of xs) { const k = key(x); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
  return g;
};

export function analyze(raw) {
  const recs = normalize(raw);
  const byExercise = groupBy(recs, (r) => r.exerciseId);

  const groups = [...groupBy(recs, (r) => `${r.topic}/${r.template}`)].map(([name, rs]) => {
    const tagCount = {};
    for (const r of rs) for (const t of r.tags) tagCount[t] = (tagCount[t] || 0) + 1;
    const wrong = rs.filter((r) => r.correct === false).length;
    return {
      name, topic: rs[0].topic, template: rs[0].template, count: rs.length, avgDifficulty: avg(rs.map((r) => r.rating)),
      wrongShare: pct(wrong, rs.length), tagCount,
    };
  }).sort((a, b) => b.avgDifficulty - a.avgDifficulty || a.name.localeCompare(b.name));

  const tagTotals = {};
  for (const r of recs) for (const t of r.tags) tagTotals[t] = (tagTotals[t] || 0) + 1;
  const tags = Object.keys(tagTotals).map((tag) => ({ tag, count: tagTotals[tag], share: pct(tagTotals[tag], recs.length) }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  const misleveled = [], repair = [], promote = [], confidentWrong = [];
  for (const [id, rs] of byExercise) {
    const topic = rs[rs.length - 1].topic;
    const high = rs.filter((r) => r.rating >= 9).length;
    if (high >= 2) misleveled.push({ exerciseId: id, topic, ratings: rs.map((r) => r.rating), reason: `דורג 9-10 ${high} פעמים` });
    const hardWrong = rs.filter((r) => r.rating >= 8 && r.correct === false);
    if (hardWrong.length) repair.push({ exerciseId: id, topic, ratings: hardWrong.map((r) => r.rating), reason: 'קושי 8-10 וגם תשובה שגויה' });
    const easyRight = rs.filter((r) => r.rating <= 3 && r.correct === true);
    if (easyRight.length >= 2) promote.push({ exerciseId: id, topic, ratings: easyRight.map((r) => r.rating), reason: 'קושי 1-3 ונכון פעמיים' });
    const cw = rs.filter((r) => r.correct === false && r.confident === true);
    if (cw.length) confidentWrong.push({ exerciseId: id, topic, count: cw.length, reason: 'בטוח/ה אבל טעה/תה' });
  }
  // The export has no explicit confidence; records may carry `confident`. Without it, "rated easy (<=3) yet wrong" is the proxy.
  const proxy = recs.some((r) => r.confident !== null) ? [] : [...byExercise]
    .map(([id, rs]) => ({ id, rs: rs.filter((r) => r.correct === false && r.rating <= 3) }))
    .filter((x) => x.rs.length)
    .map((x) => ({ exerciseId: x.id, topic: x.rs[0].topic, count: x.rs.length, reason: 'דורג קל (1-3) אבל נענה לא נכון (קירוב לביטחון-שגוי)' }));
  const cwAll = confidentWrong.concat(proxy);

  // Next content targets: score per skill/template from difficulty, wrong share, repair/misleveled hits, tag pressure.
  const flagged = new Map();
  const bump = (list, w) => list.forEach((x) => flagged.set(`${x.topic}/${templateOf(x.exerciseId)}`, (flagged.get(`${x.topic}/${templateOf(x.exerciseId)}`) || 0) + w));
  bump(repair, 2); bump(misleveled, 1); bump(cwAll, 2);
  const targets = groups.map((g) => {
    const tagTop = Object.entries(g.tagCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const score = round1(g.avgDifficulty + g.wrongShare / 20 + (flagged.get(g.name) || 0));
    const why = [`קושי ממוצע ${g.avgDifficulty}`, `${g.wrongShare}% שגויות`];
    if (flagged.get(g.name)) why.push('יש תרגילים מסומנים');
    if (tagTop) why.push(`תג מוביל: ${TAG_LABELS[tagTop[0]] || tagTop[0]}`);
    return { skill: g.topic, template: g.template, score, reason: why.join('; '), suggestedAction: 'להוסיף סט הכנה קצר ואז תרגיל חוזר בווריאציה' };
  }).sort((a, b) => b.score - a.score || a.template.localeCompare(b.template)).slice(0, 5);

  return {
    records: recs.length, avgDifficulty: avg(recs.map((r) => r.rating)), groups, tags,
    misleveled, repair, promote, confidentWrong: cwAll, targets,
  };
}

/** Suggestions only: ids, reason, suggested action. No answers, no content. */
export function buildProposal(a) {
  const s = (list, action) => list.map((x) => ({ exerciseId: x.exerciseId, reason: x.reason, suggestedAction: action }));
  return {
    note: 'Suggestions only. Review by hand; this file never changes answers or app data.',
    suggestions: [
      ...s(a.misleveled, 'check the stated level; consider raising the level or splitting the exercise'),
      ...s(a.repair, 'add a short prerequisite mini-set, then retry; revisit in 3-7 days with a variant'),
      ...s(a.promote, 'promote: offer a harder variant or the next ladder stage'),
      ...s(a.confidentWrong, 'misconception review: show the common mistake and a contrast example'),
    ],
    nextContentTargets: a.targets.map((t) => ({ skill: t.skill, template: t.template, reason: t.reason, suggestedAction: t.suggestedAction })),
  };
}

const row = (cells) => `| ${cells.join(' | ')} |`;
const idList = (list, extra) => (list.length ? list.map((x) => `- \`${x.exerciseId}\` (${x.topic}) ${extra(x)}`).join('\n') : '- אין');

export function renderReport(a) {
  const L = [`# דוח משוב`, '', `${a.records} דירוגים, קושי ממוצע ${a.avgDifficulty}/10`, ''];
  L.push('## קושי לפי מיומנות / תבנית', '', row(['מיומנות/תבנית', 'דירוגים', 'קושי ממוצע', '% שגוי']), row(['---', '---', '---', '---']));
  for (const g of a.groups) L.push(row([g.name, g.count, g.avgDifficulty, `${g.wrongShare}%`]));
  L.push('', '## תגי קושי (מתוך כל הדירוגים)', '');
  L.push(a.tags.length ? a.tags.map((t) => `- ${t.tag} (${TAG_LABELS[t.tag] || t.tag}): ${t.share}% (${t.count})`).join('\n') : '- אין');
  L.push('', '## אולי רמה לא נכונה (9-10 שוב ושוב)', '', idList(a.misleveled, (x) => x.ratings.join(',')));
  L.push('', '## מועמדים לתיקון (קושי 8-10 + שגוי)', '', idList(a.repair, (x) => x.ratings.join(',')));
  L.push('', '## מועמדים לקידום (קושי 1-3, נכון פעמיים)', '', idList(a.promote, (x) => x.ratings.join(',')));
  L.push('', '## בטוח אבל שגוי', '', idList(a.confidentWrong, (x) => `x${x.count}: ${x.reason}`));
  L.push('', '## 5 יעדי תוכן מומלצים הבאים', '');
  L.push(a.targets.length ? a.targets.map((t, i) => `${i + 1}. ${t.skill}/${t.template} (ציון ${t.score}): ${t.reason}`).join('\n') : '- אין נתונים');
  return L.join('\n') + '\n';
}

function main(argv) {
  const args = argv.slice(2);
  const oi = args.indexOf('--out');
  const outDir = oi >= 0 ? args.splice(oi, 2)[1] : null;
  const input = args[0];
  if (!input) { console.error('Usage: node tools/analyze-feedback.mjs <export.json> [--out <dir>]'); return 2; }
  let raw;
  try { raw = JSON.parse(readFileSync(input, 'utf8')); } catch (e) { console.error(`Cannot read ${input}: ${e.message}`); return 1; }
  const a = analyze(raw);
  const out = join(outDir ? resolve(outDir) : dirname(resolve(input)), PROPOSAL_FILE);
  writeFileSync(out, JSON.stringify(buildProposal(a), null, 2) + '\n');
  process.stdout.write(renderReport(a));
  console.error(`Wrote ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
