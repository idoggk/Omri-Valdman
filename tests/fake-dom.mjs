// Minimal hand-written DOM, just enough for js/dom.js `h()` and the exam views. No dependencies.
class FakeNode {
  constructor() { this.parent = null; this.nodeType = 1; }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n.isRoot === true; }
}
export class FakeText extends FakeNode {
  constructor(text) { super(); this.nodeType = 3; this.data = String(text); }
  get textContent() { return this.data; }
}
export class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this._text = null;
    this.classList = {
      toggle: (c, on) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c);
        this.className = [...set].join(' ');
      },
    };
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'value') this.value = String(v);
    if (k === 'checked') this.checked = true;
    if (k === 'disabled') this.disabled = true;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(type, ev = {}) { (this.listeners[type] || []).forEach((fn) => fn({ preventDefault() {}, target: this, ...ev })); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() {}
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  replaceChildren(...kids) { this.children.forEach((c) => { c.parent = null; }); this.children = []; this.append(...kids); }
  set innerHTML(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._text ?? ''; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text ?? this.children.map((c) => c.textContent).join(''); }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk && c.walk(fn)); }
  all(pred) { const out = []; this.walk((n) => { if (pred(n)) out.push(n); }); return out; }
  querySelector(sel) { return this.all((n) => n.tagName === sel.toUpperCase())[0] || null; }
  byText(tag, text) { return this.all((n) => n.tagName === tag.toUpperCase() && n.textContent.includes(text))[0] || null; }
}

/** Installs document/location/localStorage/Date.now/timers stubs on globalThis. Returns a control object. */
export function installFakeDom() {
  const store = new Map();
  const clock = { now: 1_000_000 };
  const intervals = new Set();
  let nextId = 1;
  const root = new FakeElement('main');
  root.isRoot = true;
  globalThis.document = {
    title: '',
    createElement: (t) => new FakeElement(t),
    createTextNode: (t) => new FakeText(t),
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    readyState: 'complete',
    head: new FakeElement('head'),
    body: new FakeElement('body'),
  };
  globalThis.window = globalThis;
  globalThis.location = { hash: '#/exam/run', href: 'http://localhost/', protocol: 'http:', hostname: 'localhost' };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  globalThis.setInterval = (fn) => { const id = nextId++; intervals.add(id); return id; };
  globalThis.clearInterval = (id) => { intervals.delete(id); };
  const realNow = Date.now;
  Date.now = () => clock.now;
  return {
    root, clock, intervals, store,
    show(...kids) { root.replaceChildren(...kids.flat().filter(Boolean)); },
    restore() { Date.now = realNow; },
  };
}
