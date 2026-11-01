import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { analyze, templateOf } from '../tools/analyze-feedback.mjs';

const FIXTURE = new URL('./fixtures/feedback-sample.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TOOL = new URL('../tools/analyze-feedback.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

test('templateOf strips numeric suffix', () => {
  assert.equal(templateOf('phys-vertical-007'), 'phys-vertical');
  assert.equal(templateOf('math-3-001:v2'), 'math-3');
});

test('analyze finds the expected candidates', () => {
  const a = analyze(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  assert.equal(a.records, 7);
  assert.deepEqual(a.misleveled.map((x) => x.exerciseId), ['phys-vertical-001']);
  assert.deepEqual(a.repair.map((x) => x.exerciseId).sort(), ['phys-vertical-001', 'phys-vertical-002']);
  assert.deepEqual(a.promote.map((x) => x.exerciseId), ['math-3-001']);
  assert.deepEqual(a.confidentWrong.map((x) => x.exerciseId), ['math-3-002']);
  const pv = a.groups.find((g) => g.name === 'phys-vertical/phys-vertical');
  assert.equal(pv.avgDifficulty, 9);
  assert.equal(a.tags.find((t) => t.tag === 'time').count, 2);
  assert.ok(a.targets.length <= 5 && a.targets[0].template === 'phys-vertical');
});

test('analyze tolerates garbage input', () => {
  assert.equal(analyze(null).records, 0);
  assert.equal(analyze({ records: 5 }).targets.length, 0);
});

test('CLI prints a report and writes a suggestions-only proposal next to the input', () => {
  const dir = mkdtempSync(join(dirname(FIXTURE), 'run-'));
  try {
    const input = join(dir, 'export.json');
    copyFileSync(FIXTURE, input);
    const r = spawnSync(process.execPath, [TOOL, input], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /# דוח משוב/);
    assert.match(r.stdout, /phys-vertical-001/);
    const out = join(dir, 'content-overrides-proposal.json');
    assert.ok(existsSync(out));
    const p = JSON.parse(readFileSync(out, 'utf8'));
    assert.ok(p.suggestions.length > 0 && p.nextContentTargets.length > 0);
    for (const s of p.suggestions) assert.deepEqual(Object.keys(s).sort(), ['exerciseId', 'reason', 'suggestedAction']);
    assert.equal(readFileSync(input, 'utf8'), readFileSync(FIXTURE, 'utf8'));
    assert.equal(spawnSync(process.execPath, [TOOL, join(dir, 'missing.json')], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
