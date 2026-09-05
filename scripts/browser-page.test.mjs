import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { buildElementActionExpression, buildReadPageExpression, validatePressKey } from './browser-page.mjs';

class FakeText {
  constructor(value) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.parentElement = null;
  }
}

class FakeElement {
  constructor(tagName, attributes = {}, children = []) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes).map(([name, value]) => [name, String(value)]));
    this.hidden = attributes.hidden !== undefined;
    this.style = { display: attributes.display || 'block', visibility: attributes.visibility || 'visible',
      opacity: attributes.opacity || '1', pointerEvents: attributes.pointerEvents || 'auto' };
    this.childNodes = [];
    this.parentElement = null;
    for (const child of children) this.append(child);
  }
  append(child) {
    const node = typeof child === 'string' ? new FakeText(child) : child;
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  get href() { return this.getAttribute('href') || ''; }
  get textContent() { return this.childNodes.map(node => node.nodeType === 3 ? node.nodeValue : node.textContent).join(''); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  matches(selector) { return matchSelector(this, selector); }
  getClientRects() { return this.hidden || this.style.display === 'none' ? [] : [{}]; }
  getBoundingClientRect() {
    const visible = this.getClientRects().length > 0;
    return { x: 0, y: 0, width: visible ? 600 : 0, height: visible ? 100 : 0 };
  }
  querySelectorAll(selector) {
    const matches = selector.split(',').map(value => value.trim()).filter(Boolean);
    const result = [];
    const visit = element => {
      for (const child of element.children) {
        if (matches.some(part => matchSelector(child, part))) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
}

function matchSelector(element, selector) {
  if (selector === '[') throw new SyntaxError('Invalid CSS selector');
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
  if (selector === '[role="main"]') return element.getAttribute('role') === 'main';
  if (selector === '[role="heading"]') return element.getAttribute('role') === 'heading';
  if (selector === 'a[href]') return element.tagName === 'A' && element.hasAttribute('href');
  if (selector === 'meta[name]') return element.tagName === 'META' && element.hasAttribute('name');
  if (selector === 'meta[name^="citation_"]') {
    return element.tagName === 'META' && (element.getAttribute('name') || '').toLowerCase().startsWith('citation_');
  }
  return element.tagName === selector.toUpperCase();
}

function pageFixture() {
  const article = new FakeElement('article', { id: 'paper' }, [
    new FakeElement('h1', {}, ['Reliable Paper Reading']),
    new FakeElement('p', {}, ['Evidence-rich article text. '.repeat(8)]),
    new FakeElement('a', { href: '/paper' }, ['Primary source']),
    new FakeElement('a', { href: 'https://example.test/paper' }, ['Duplicate source']),
    new FakeElement('a', { href: 'mailto:author@example.test' }, ['Email']),
    new FakeElement('form', {}, ['Search form must be excluded']),
    new FakeElement('aside', {}, ['Sidebar must be excluded']),
    new FakeElement('p', { opacity: '0' }, ['Transparent text must be excluded']),
  ]);
  const body = new FakeElement('body', {}, [
    new FakeElement('nav', {}, ['Navigation must be excluded']),
    new FakeElement('div', { id: 'hidden', display: 'none' }, ['Hidden must be excluded']),
    article,
    new FakeElement('article', { class: 'duplicate-region' }, ['One']),
    new FakeElement('article', { class: 'duplicate-region' }, ['Two']),
  ]);
  const head = new FakeElement('head', {}, [
    new FakeElement('meta', { name: 'citation_title', content: 'Reliable Paper Reading' }),
    new FakeElement('meta', { name: 'citation_title', content: 'Reliable Paper Reading' }),
    new FakeElement('meta', { name: 'citation_author', content: 'Ada Lovelace' }),
    new FakeElement('meta', { name: 'citation_author', content: 'Ada Lovelace' }),
    new FakeElement('meta', { name: 'citation_author', content: 'Grace Hopper' }),
    new FakeElement('meta', { name: 'citation_doi', content: ' 10.1000/example ' }),
    new FakeElement('meta', { name: 'citation_pdf_url', content: '' }),
    new FakeElement('meta', { name: '', content: 'ignored' }),
    new FakeElement('meta', { name: 'dc.title', content: 'ignored' }),
  ]);
  const html = new FakeElement('html', { lang: 'en' }, [head, body]);
  const document = {
    title: 'Fixture title', head, body, documentElement: html,
    querySelectorAll(selector) {
      if (selector === '[') throw new SyntaxError('Invalid CSS selector');
      return body.querySelectorAll(selector);
    },
  };
  return { document, article };
}

function read(options = {}) {
  const { document } = pageFixture();
  const result = vm.runInNewContext(buildReadPageExpression(options), {
    document,
    location: { href: 'https://example.test/search' },
    getComputedStyle: element => element.style,
    URL,
  });
  return JSON.parse(JSON.stringify(result));
}

function extraction(method, selector, candidateScanTruncated = false) {
  return { method, selector, heuristic: true, scope: 'current_frame_light_dom',
    candidate_scan_truncated: candidateScanTruncated };
}

function truncation(overrides = {}) {
  return { title: false, url: false, lang: false, text: false, headings: false, links: false,
    citation_meta: false, extraction_selector: false, ...overrides };
}

test('automatic extraction prefers article content and omits page chrome', () => {
  const page = read();
  assert.equal(page.title, 'Fixture title');
  assert.equal(page.url, 'https://example.test/search');
  assert.equal(page.lang, 'en');
  assert.deepEqual(page.extraction, extraction('semantic', '#paper'));
  assert.match(page.text, /Evidence-rich article text/);
  for (const excluded of ['Navigation must be excluded', 'Hidden must be excluded',
    'Search form must be excluded', 'Sidebar must be excluded', 'Transparent text must be excluded']) {
    assert.doesNotMatch(page.text, new RegExp(excluded));
  }
  assert.deepEqual(page.headings, [{ level: 1, text: 'Reliable Paper Reading' }]);
  assert.deepEqual(page.links, [{ text: 'Primary source', url: 'https://example.test/paper' }]);
  assert.deepEqual(page.truncated, truncation());
});

test('automatic extraction falls back to body when semantic regions have no visible text', () => {
  const emptyMain = new FakeElement('main');
  const body = new FakeElement('body', {}, [emptyMain, new FakeElement('p', {}, ['Body fallback evidence'])]);
  const html = new FakeElement('html', { lang: 'en' }, [body]);
  const document = { title: 'Fallback', head: new FakeElement('head'), body, documentElement: html,
    querySelectorAll: selector => body.querySelectorAll(selector) };
  const evaluated = vm.runInNewContext(buildReadPageExpression(), {
    document, location: { href: 'https://example.test/fallback' }, getComputedStyle: element => element.style, URL,
  });
  const page = JSON.parse(JSON.stringify(evaluated));
  assert.deepEqual(page.extraction, extraction('body', 'body'));
  assert.equal(page.text, 'Body fallback evidence');
});

for (const [name, configure] of [
  ['hidden body', ({ body }) => { body.hidden = true; }],
  ['aria-hidden html', ({ html }) => { html.attributes.set('aria-hidden', 'true'); }],
  ['transparent html', ({ html }) => { html.style.opacity = '0'; }],
]) {
  test(`body fallback rejects a ${name}`, () => {
    const body = new FakeElement('body', {}, [new FakeElement('p', {}, ['Must not be returned'])]);
    const head = new FakeElement('head');
    const html = new FakeElement('html', {}, [head, body]);
    configure({ body, html });
    const document = { title: 'Hidden fallback', head, body, documentElement: html, querySelectorAll: () => [] };
    const result = JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression(), {
      document, location: { href: 'https://example.test/hidden' }, getComputedStyle: element => element.style, URL,
    })));
    assert.equal(result.code, 'ELEMENT_NOT_VISIBLE');
    assert.equal(result.selector, 'body');
  });
}

test('automatic extraction uses finite DOM traversal without selector materialization', () => {
  const article = new FakeElement('article', { id: 'finite' }, [
    new FakeElement('h1', {}, ['Finite traversal']),
    new FakeElement('p', {}, ['Bounded article evidence']),
    new FakeElement('a', { href: '/finite' }, ['Finite link']),
  ]);
  const body = new FakeElement('body', {}, [article]);
  const head = new FakeElement('head', {}, [
    new FakeElement('meta', { name: 'citation_title', content: 'Finite traversal' }),
  ]);
  const html = new FakeElement('html', {}, [head, body]);
  const rejectSelectorMaterialization = () => { throw new Error('querySelectorAll must not be used by automatic extraction'); };
  article.querySelectorAll = rejectSelectorMaterialization;
  head.querySelectorAll = rejectSelectorMaterialization;
  body.querySelectorAll = rejectSelectorMaterialization;
  const document = { title: 'Finite', head, body, documentElement: html,
    querySelectorAll: rejectSelectorMaterialization };
  const page = JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression(), {
    document, location: { href: 'https://example.test/finite' }, getComputedStyle: element => element.style, URL,
  })));
  assert.deepEqual(page.extraction, extraction('semantic', '#finite'));
  assert.equal(page.text, 'Finite traversal\nBounded article evidence\nFinite link');
  assert.deepEqual(page.headings, [{ level: 1, text: 'Finite traversal' }]);
  assert.deepEqual(page.links, [{ text: 'Finite link', url: 'https://example.test/finite' }]);
  assert.deepEqual(page.citation_meta, { citation_title: ['Finite traversal'] });
});

test('top-level strings and extraction diagnostics are bounded before processing', () => {
  const hugeId = 'i'.repeat(10000);
  const hugeClass = 'content ' + 'c'.repeat(10000);
  const article = new FakeElement('article', { id: hugeId, class: hugeClass }, ['Bounded identity']);
  const body = new FakeElement('body', {}, [article]);
  const head = new FakeElement('head');
  const html = new FakeElement('html', { lang: 'l'.repeat(10000) }, [head, body]);
  const document = { title: 't'.repeat(10000), head, body, documentElement: html,
    querySelectorAll: selector => body.querySelectorAll(selector) };
  const page = JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression(), {
    document, location: { href: `https://example.test/${'u'.repeat(20000)}` },
    getComputedStyle: element => element.style, URL,
  })));
  assert.ok(page.title.length <= 4096);
  assert.ok(page.url.length <= 8192);
  assert.ok(page.lang.length <= 256);
  assert.ok(page.extraction.selector.length <= 257);
  assert.deepEqual(page.truncated, truncation({ title: true, url: true, lang: true, extraction_selector: true }));
});

test('semantic class diagnostics keep complete bounded tokens and report truncation', () => {
  const region = new FakeElement('div', { class: `content ${'c'.repeat(10000)}` }, ['Bounded class evidence']);
  const body = new FakeElement('body', {}, [region]);
  const head = new FakeElement('head');
  const html = new FakeElement('html', {}, [head, body]);
  const document = { title: 'Class boundary', head, body, documentElement: html };
  const page = JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression(), {
    document, location: { href: 'https://example.test/class' }, getComputedStyle: element => element.style, URL,
  })));
  assert.deepEqual(page.extraction, extraction('semantic', 'div.content'));
  assert.equal(page.truncated.extraction_selector, true);
});

test('selector extraction validates uniqueness and reports independent truncation', () => {
  const page = read({ selector: '#paper', max_chars: 40, max_links: 1 });
  assert.deepEqual(page.extraction, extraction('selector', '#paper'));
  assert.equal(page.text.length, 40);
  assert.deepEqual(page.truncated, truncation({ text: true }));
  assert.equal(read({ selector: '.duplicate-region' }).code, 'SELECTOR_AMBIGUOUS');
  assert.equal(read({ selector: '#hidden' }).code, 'ELEMENT_NOT_VISIBLE');
  assert.equal(read({ selector: '#missing' }).code, 'ELEMENT_NOT_FOUND');
  assert.equal(read({ selector: '[' }).code, 'INVALID_SELECTOR');
});

test('headings and links have independent bounded outputs', () => {
  const { document, article } = pageFixture();
  for (let index = 0; index < 101; index++) article.append(new FakeElement('h2', {}, [`Heading ${index}`]));
  article.append(new FakeElement('a', { href: '/second' }, ['Second source']));
  const evaluated = vm.runInNewContext(buildReadPageExpression({ selector: '#paper', max_chars: 5000, max_links: 1 }), {
    document, location: { href: 'https://example.test/search' }, getComputedStyle: element => element.style, URL,
  });
  const page = JSON.parse(JSON.stringify(evaluated));
  assert.equal(page.headings.length, 100);
  assert.equal(page.links.length, 1);
  assert.deepEqual(page.truncated, truncation({ headings: true, links: true }));
});

test('citation metadata is normalized, bounded independently, and still read with a selector', () => {
  const complete = read({ selector: '#paper' });
  assert.deepEqual(complete.citation_meta, {
    citation_title: ['Reliable Paper Reading'],
    citation_author: ['Ada Lovelace', 'Grace Hopper'],
    citation_doi: ['10.1000/example'],
  });
  assert.equal(complete.truncated.citation_meta, false);

  const bounded = read({ selector: '#paper', max_citation_meta: 3 });
  assert.deepEqual(bounded.citation_meta, {
    citation_title: ['Reliable Paper Reading'],
    citation_author: ['Ada Lovelace', 'Grace Hopper'],
  });
  assert.equal(bounded.truncated.citation_meta, true);
});

test('explicit and automatic extraction reject content beneath ignored or hidden ancestors', () => {
  const navContent = new FakeElement('div', { id: 'nav-content', class: 'content' }, ['Navigation descendant must not be read']);
  const hiddenArticle = new FakeElement('article', { id: 'hidden-article' }, ['ARIA-hidden descendant must not be read']);
  const body = new FakeElement('body', {}, [
    new FakeElement('nav', {}, [navContent]),
    new FakeElement('div', { 'aria-hidden': 'true' }, [hiddenArticle]),
    new FakeElement('p', {}, ['Visible body fallback']),
  ]);
  const head = new FakeElement('head');
  const html = new FakeElement('html', {}, [head, body]);
  const document = { title: 'Ancestor boundaries', head, body, documentElement: html,
    querySelectorAll: selector => body.querySelectorAll(selector) };
  const run = options => JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression(options), {
    document, location: { href: 'https://example.test/ancestors' }, getComputedStyle: element => element.style, URL,
  })));

  assert.equal(run({ selector: '#nav-content' }).code, 'ELEMENT_NOT_VISIBLE');
  assert.equal(run({ selector: '#hidden-article' }).code, 'ELEMENT_NOT_VISIBLE');
  const automatic = run();
  assert.deepEqual(automatic.extraction, extraction('body', 'body'));
  assert.equal(automatic.text, 'Visible body fallback');
});

test('read-page work and individual metadata items stay bounded', () => {
  const { document, article } = pageFixture();
  const longText = 'x'.repeat(20000);
  article.append(new FakeElement('h2', {}, [longText]));
  article.append(new FakeElement('a', { href: '/long-link' }, [longText]));
  document.head.append(new FakeElement('meta', { name: 'citation_abstract', content: longText }));

  const page = JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression({
    selector: '#paper', max_chars: 1000, max_links: 100, max_citation_meta: 100,
  }), { document, location: { href: 'https://example.test/search' }, getComputedStyle: element => element.style, URL })));
  assert.ok(page.headings.at(-1).text.length <= 4096);
  assert.ok(page.links.at(-1).text.length <= 4096);
  assert.ok(page.citation_meta.citation_abstract[0].length <= 4096);
  assert.equal(page.truncated.headings, true);
  assert.equal(page.truncated.links, true);
  assert.equal(page.truncated.citation_meta, true);
});

test('read-page candidate and collection scans stop at bounded lookahead', () => {
  const selected = new FakeElement('article', { id: 'candidate-0' }, [
    new FakeElement('p', {}, ['Selected candidate has substantially more evidence than its peers.']),
    ...Array.from({ length: 101 }, (_, index) => new FakeElement('h2', {}, [`Heading ${index}`])),
    ...Array.from({ length: 3 }, (_, index) => new FakeElement('a', { href: `/link-${index}` }, [`Link ${index}`])),
  ]);
  const candidates = [selected, ...Array.from({ length: 200 }, (_, index) =>
    new FakeElement('article', { id: `candidate-${index + 1}` }, ['Candidate']))];
  const body = new FakeElement('body', {}, candidates);
  const head = new FakeElement('head', {}, Array.from({ length: 3 }, (_, index) =>
    new FakeElement('meta', { name: 'citation_author', content: `Author ${index}` })));
  const html = new FakeElement('html', {}, [head, body]);
  const document = { title: 'Bounded scans', head, body, documentElement: html,
    querySelectorAll() { throw new Error('automatic extraction must not materialize selector matches'); } };
  const page = JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression({
    max_chars: 1000, max_links: 2, max_citation_meta: 2,
  }), { document, location: { href: 'https://example.test/bounded' }, getComputedStyle: element => element.style, URL })));

  assert.equal(page.extraction.selector, '#candidate-0');
  assert.equal(page.headings.length, 100);
  assert.equal(page.links.length, 2);
  assert.deepEqual(page.citation_meta, { citation_author: ['Author 0', 'Author 1'] });
  assert.equal(page.extraction.candidate_scan_truncated, true);
  assert.equal(page.truncated.headings, true);
  assert.equal(page.truncated.links, true);
  assert.equal(page.truncated.citation_meta, true);
});

test('automatic extraction reports every affected limit on an oversized DOM', () => {
  const filler = new FakeText('');
  const body = new FakeElement('body');
  filler.parentElement = body;
  body.childNodes = new Proxy({ length: 60000 }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (/^\d+$/.test(String(property))) return filler;
      return target[property];
    },
  });
  const head = new FakeElement('head');
  const html = new FakeElement('html', {}, [head, body]);
  const document = { title: 'Oversized DOM', head, body, documentElement: html };
  const page = JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression(), {
    document, location: { href: 'https://example.test/large-dom' }, getComputedStyle: element => element.style, URL,
  })));
  assert.equal(page.extraction.candidate_scan_truncated, true);
  assert.deepEqual(page.truncated, truncation({ text: true, headings: true, links: true }));
});

test('explicit selector uniqueness stops after the second match', () => {
  const elements = Array.from({ length: 500 }, (_, index) =>
    new FakeElement('article', { id: `match-${index}`, class: 'many' }, ['Match']));
  let matchCalls = 0;
  for (const element of elements) {
    element.matches = selector => { matchCalls++; return matchSelector(element, selector); };
  }
  const body = new FakeElement('body', {}, elements);
  const head = new FakeElement('head');
  const html = new FakeElement('html', {}, [head, body]);
  const document = { title: 'Bounded selector', head, body, documentElement: html,
    querySelectorAll() { throw new Error('readPage must not materialize selector matches'); } };
  const result = JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression({ selector: '.many' }), {
    document, location: { href: 'https://example.test/many' }, getComputedStyle: element => element.style, URL,
  })));
  assert.equal(result.code, 'SELECTOR_AMBIGUOUS');
  assert.equal(result.match_count, 2);
  assert.equal(result.match_count_truncated, true);
  assert.equal(matchCalls, 2);
});

test('explicit selector refuses to infer uniqueness after its DOM scan budget', () => {
  const filler = new FakeText('');
  const body = new FakeElement('body');
  body.childNodes = new Proxy({ length: 50001 }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (/^\d+$/.test(String(property))) return filler;
      return target[property];
    },
  });
  const head = new FakeElement('head');
  const html = new FakeElement('html', {}, [head, body]);
  const document = { title: 'Bounded selector', head, body, documentElement: html,
    querySelectorAll() { throw new Error('readPage must not materialize selector matches'); } };
  const result = JSON.parse(JSON.stringify(vm.runInNewContext(buildReadPageExpression({ selector: '.missing' }), {
    document, location: { href: 'https://example.test/many' }, getComputedStyle: element => element.style, URL,
  })));
  assert.equal(result.code, 'SELECTOR_SCAN_LIMIT');
  assert.equal(result.selector_scan_truncated, true);
  assert.equal(result.match_count, 0);
});

test('read-page options reject unknown and out-of-range values before evaluation', () => {
  assert.throws(() => buildReadPageExpression({ extra: true }), error => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => buildReadPageExpression({ selector: '', max_chars: 0 }), error => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => buildReadPageExpression({ max_links: 1001 }), error => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => buildReadPageExpression({ max_citation_meta: 0 }), error => error.code === 'INVALID_ARGUMENT');
  assert.doesNotThrow(() => buildReadPageExpression({ max_citation_meta: 1 }));
  assert.doesNotThrow(() => buildReadPageExpression({ max_citation_meta: 1000 }));
  assert.throws(() => buildReadPageExpression({ max_citation_meta: 1001 }), error => error.code === 'INVALID_ARGUMENT');
});

function actionFixture(overrides = {}) {
  const events = [];
  let clicked = 0;
  let nativeSetCalls = 0;
  class InputElement {
    get value() { return this._value || ''; }
    set value(value) { nativeSetCalls++; this._value = String(value); }
  }
  const attributes = new Map(Object.entries(overrides.attributes || {}));
  const element = overrides.input ? new InputElement() : {};
  Object.assign(element, {
    nodeType: 1, tagName: overrides.tagName || (overrides.input ? 'INPUT' : 'BUTTON'), id: 'target', className: '',
    hidden: false, disabled: false, inert: false, readOnly: false, isConnected: true,
    getAttribute(name) { return attributes.get(name) ?? (name === 'type' && overrides.input ? overrides.type || 'text' : null); },
    hasAttribute(name) { return attributes.has(name); },
    getClientRects() { return this.hidden || overrides.zeroSize ? [] : [{}]; },
    getBoundingClientRect() {
      return { x: 10, y: 20, width: this.hidden || overrides.zeroSize ? 0 : 80,
        height: this.hidden || overrides.zeroSize ? 0 : 20 };
    },
    scrollIntoView() {},
    click() { clicked++; },
    contains(candidate) { return candidate === this; },
    dispatchEvent(event) { events.push(event.type); return true; },
  }, overrides.properties || {});
  const parentAttributes = new Map(Object.entries(overrides.parentAttributes || {}));
  const parent = overrides.parent ? {
    nodeType: 1, tagName: 'DIV', id: 'parent', className: '', parentElement: null,
    hidden: false, inert: false,
    style: { display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto', ...(overrides.parentStyle || {}) },
    getAttribute(name) { return parentAttributes.get(name) ?? null; },
    hasAttribute(name) { return parentAttributes.has(name); },
  } : null;
  element.parentElement = parent;
  const document = {
    activeElement: null,
    querySelectorAll(selector) {
      if (selector === '[') throw new SyntaxError('Invalid CSS selector');
      if (selector === '.duplicate') return [element, { ...element }];
      return selector === '#target' ? [element] : [];
    },
    elementFromPoint() { return overrides.occluded ? { id: 'overlay' } : element; },
  };
  element.focus = () => { if (!overrides.focusFails) document.activeElement = element; };
  const context = {
    document,
    getComputedStyle: candidate => candidate.style || ({ display: element.hidden ? 'none' : 'block', visibility: 'visible',
      opacity: '1', pointerEvents: overrides.pointerEvents || 'auto' }),
    Event,
    HTMLInputElement: InputElement,
  };
  return {
    element, events, clicked: () => clicked, nativeSetCalls: () => nativeSetCalls,
    run(action, text) {
      const expression = buildElementActionExpression({ selector: '#target', action, ...(text === undefined ? {} : { text }) });
      return JSON.parse(JSON.stringify(vm.runInNewContext(expression, context)));
    },
  };
}

for (const [name, overrides, expected] of [
  ['disabled', { properties: { disabled: true } }, 'ELEMENT_DISABLED'],
  ['disabled-attribute', { attributes: { disabled: '' } }, 'ELEMENT_DISABLED'],
  ['native-disabled', { properties: { matches: selector => selector === ':disabled' } }, 'ELEMENT_DISABLED'],
  ['aria-disabled', { attributes: { 'aria-disabled': 'true' } }, 'ELEMENT_DISABLED'],
  ['inert', { properties: { inert: true } }, 'ELEMENT_INERT'],
  ['hidden', { properties: { hidden: true } }, 'ELEMENT_NOT_VISIBLE'],
  ['zero-size', { zeroSize: true }, 'ELEMENT_NOT_VISIBLE'],
  ['pointer-disabled', { pointerEvents: 'none' }, 'POINTER_EVENTS_DISABLED'],
  ['center-occluded', { occluded: true }, 'ELEMENT_OCCLUDED'],
]) {
  test(`pointer inspection rejects ${name} targets before dispatch`, () => {
    const fixture = actionFixture(overrides);
    const result = fixture.run('click');
    assert.equal(result.code, expected);
    assert.equal(fixture.clicked(), 0);
  });
}

test('click dispatch evidence does not claim a website outcome', () => {
  const fixture = actionFixture();
  const result = fixture.run('click');
  assert.equal(result.clicked, true);
  assert.equal(result.status, 'dispatched');
  assert.equal(result.outcome_verified, false);
  assert.equal(fixture.clicked(), 1);
});

test('fill uses the native setter, dispatches input and change, and verifies the immediate value', () => {
  const fixture = actionFixture({ input: true });
  const result = fixture.run('fill', 'Ada Lovelace');
  assert.equal(fixture.element.value, 'Ada Lovelace');
  assert.equal(fixture.nativeSetCalls(), 1);
  assert.deepEqual(fixture.events, ['input', 'change']);
  assert.equal(result.status, 'dispatched');
  assert.equal(result.outcome_verified, false);
  assert.equal(result.immediate_value_verified, true);
});

for (const [name, overrides] of [
  ['hidden ancestor', { parent: true, parentAttributes: { hidden: '' } }],
  ['aria-hidden ancestor', { parent: true, parentAttributes: { 'aria-hidden': 'true' } }],
  ['display-none ancestor', { parent: true, parentStyle: { display: 'none' } }],
  ['visibility-hidden ancestor', { parent: true, parentStyle: { visibility: 'hidden' } }],
  ['transparent ancestor', { parent: true, parentStyle: { opacity: '0' } }],
  ['negative-opacity ancestor', { parent: true, parentStyle: { opacity: '-0.1' } }],
]) {
  test(`click and fill reject a ${name} without mutating the target`, () => {
    const click = actionFixture(overrides);
    assert.equal(click.run('click').code, 'ELEMENT_NOT_VISIBLE');
    assert.equal(click.clicked(), 0);

    const fill = actionFixture({ ...overrides, input: true });
    assert.equal(fill.run('fill', 'wrong target').code, 'ELEMENT_NOT_VISIBLE');
    assert.equal(fill.element.value, '');
    assert.deepEqual(fill.events, []);
  });
}

test('insertText performs a synchronous exact-target edit on text controls', () => {
  const input = actionFixture({ input: true });
  const inserted = input.run('insertText', 'Ada');
  assert.equal(input.element.value, 'Ada');
  assert.deepEqual(input.events, ['beforeinput', 'input']);
  assert.equal(inserted.insert_target_verified, true);
  assert.equal(inserted.insertion_method, 'exact_target_dom_edit');
  assert.equal(inserted.keyboard_semantics, false);

  const textarea = actionFixture({ tagName: 'TEXTAREA' });
  assert.equal(textarea.run('insertText', 'Grace').insert_target_verified, true);
  assert.equal(textarea.element.value, 'Grace');

  const email = actionFixture({ input: true, type: 'email', properties: {
    selectionStart: null, selectionEnd: null,
    setRangeText() { throw new Error('selection API unavailable for this text-like input'); },
  } });
  assert.equal(email.run('insertText', 'ada@example.test').insert_target_verified, true);
  assert.equal(email.element.value, 'ada@example.test');

  const failed = actionFixture({ input: true, focusFails: true }).run('insertText', 'unsafe');
  assert.equal(failed.code, 'FOCUS_FAILED');
  assert.equal(failed.focus_verified, false);
});

for (const [name, fixture, expected] of [
  ['button', {}, 'INVALID_ELEMENT'],
  ['file input', { input: true, type: 'file' }, 'INVALID_ELEMENT'],
  ['checkbox', { input: true, type: 'checkbox' }, 'INVALID_ELEMENT'],
  ['read-only input', { input: true, properties: { readOnly: true } }, 'ELEMENT_READONLY'],
]) {
  test(`insertText rejects ${name}`, () => {
    assert.equal(actionFixture(fixture).run('insertText', 'unsafe').code, expected);
  });
}

test('press accepts bounded named keys or one Unicode character', () => {
  assert.deepEqual(validatePressKey('Enter'), { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  assert.deepEqual(validatePressKey('Backspace'), { key: 'Backspace', code: 'Backspace',
    windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  assert.deepEqual(validatePressKey('学'), { key: '学', text: '学' });
  assert.throws(() => validatePressKey('Ctrl+Enter'), error => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => validatePressKey(''), error => error.code === 'INVALID_ARGUMENT');
});
