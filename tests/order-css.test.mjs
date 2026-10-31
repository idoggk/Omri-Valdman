import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('styles.css defines the order-* classes', () => {
  for (const c of ['.order-list', '.order-step', '.order-step.selected', '.order-step.right', '.order-step.wrong',
    '.order-pick', '.order-move', '.order-mark', '.order-pick:focus-visible']) {
    assert.ok(css.includes(c), `missing ${c}`);
  }
  assert.match(css, /\.order-pick\s*\{[^}]*min-height:\s*48px/);
});
