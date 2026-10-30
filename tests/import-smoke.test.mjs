// Importing every module with stubbed browser globals catches ReferenceErrors / syntax errors at load time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.window.addEventListener = () => {};
globalThis.document.createElementNS = globalThis.document.createElement;
globalThis.document.documentElement = { setAttribute() {}, lang: '' };

const dir = new URL('../js/', import.meta.url);
for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  test(`js/${f} imports without throwing`, async () => {
    try {
      await import(new URL(f, dir));
    } catch (e) {
      assert.ok(!(e instanceof ReferenceError || e instanceof SyntaxError), `${f}: ${e && e.stack}`);
    }
  });
}
test('cleanup', () => dom.restore());
