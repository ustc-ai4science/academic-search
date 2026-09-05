import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { buildElementActionExpression, buildReadPageExpression, validatePressKey } from './browser-page.mjs';

// Execute the real HTTP router and CDP request code with an in-memory CDP transport.
// Only browser discovery is substituted: these tests never connect to real Chrome.
async function fixture(t, { connectAtStart = true, socketBehavior = 'open' } = {}) {
  const source = fs.readFileSync(new URL('./cdp-proxy.mjs', import.meta.url), 'utf8')
    .replace(/^#!.*\n/, '').replace(/^import .*;$/gm, '').replace(/^main\(\);$/m, '');
  const commands = [];
  const socketURLs = [];
  let prepareCalls = 0;
  let clicked = 0;
  let scrolled = 0;
  let filesSet = 0;
  let ready = 'complete';
  let droppedEvaluate = false;
  let closeDuringEvaluate = false;
  let navigationError = false;
  let noHistory = false;
  let backDelay = 0;
  let lastActionElement = null;
  let hitTarget;
  let stealFocusTarget;
  let coordinateRace;
  let coordinateEvaluations = 0;
  let pressedTarget = null;
  const dispatchedEvents = [];
  const documentListeners = new Map();
  const selectors = new Map();
  function element(id, visible = true, tag = 'BUTTON') {
    const attributes = new Map();
    return { nodeType: 1, tagName: tag, id, textContent: id, className: '', type: tag === 'INPUT' ? 'file' : '',
      childNodes: [], disabled: false, inert: false, hidden: !visible, readOnly: false, value: '',
      selectionStart: 0, selectionEnd: 0, parentElement: null,
      getAttribute(name) { return name === 'type' ? this.type : attributes.get(name) ?? null; },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      hasAttribute(name) { return attributes.has(name); },
      matches(selector) {
        if (selector === '[') throw new SyntaxError('Invalid CSS selector');
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        if (selector.startsWith('.')) return String(this.className || '').split(/\s+/).includes(selector.slice(1));
        return this.tagName === selector.toUpperCase();
      },
      scrollIntoView() { scrolled++; lastActionElement = this; }, click() { clicked++; },
      contains(candidate) { return candidate === this; },
      focus() { pageDocument.activeElement = this; },
      dispatchEvent(event) {
        dispatchedEvents.push(event.type);
        const dispatched = dispatchDocumentEvent(event.type, this, { inputType: event.inputType, data: event.data });
        if (dispatched.defaultPrevented) event.preventDefault?.();
        return !dispatched.defaultPrevented;
      },
      setRangeText(text, start, end) {
        this.value = this.value.slice(0, start) + text + this.value.slice(end);
        this.selectionStart = this.selectionEnd = start + text.length;
      },
      getClientRects() { return visible ? [{}] : []; },
      getBoundingClientRect() { return { x: 0, y: 0, width: visible ? 40 : 0, height: visible ? 20 : 0 }; },
      isConnected: true };
  }
  selectors.set('.duplicate', [element('first'), element('second')]);
  selectors.set('.files', [element('file-a', true, 'INPUT'), element('file-b', true, 'INPUT')]);
  selectors.set('#unique', [element('unique')]);
  selectors.set('#upload', [element('upload', false, 'INPUT')]);
  selectors.set('.hidden', [element('hidden', false)]);
  const querySelectorAll = (selector) => {
    if (selector === '[') throw new SyntaxError('Invalid CSS selector');
    return selectors.get(selector) || [];
  };
  const dispatchDocumentEvent = (type, target, properties = {}) => {
    let immediateStopped = false;
    const event = { type, target, cancelable: true, defaultPrevented: false, ...properties,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { immediateStopped = true; },
      stopPropagation() {} };
    for (const listener of documentListeners.get(type) || []) {
      listener(event);
      if (immediateStopped) break;
    }
    return event;
  };
  const pageDocument = { querySelectorAll, querySelector: selector => querySelectorAll(selector)[0] || null,
    get readyState() { return ready; }, title: 'offline fixture', activeElement: null,
    elementFromPoint() { return hitTarget === undefined ? lastActionElement : hitTarget; },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener); documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      documentListeners.set(type, listeners.filter(candidate => candidate !== listener));
    } };
  const page = vm.createContext({
    document: pageDocument,
    getComputedStyle: el => ({ display: el.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1',
      pointerEvents: el.pointerEvents || 'auto' }),
    history: { back() {} }, location: { href: 'file:///fixture.html' }, URL, Event, setTimeout, clearTimeout,
  });
  class FakeWebSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor(url) {
      super(); socketURLs.push(url);
      if (socketBehavior === 'open') queueMicrotask(() => this.dispatchEvent(new Event('open')));
      else if (socketBehavior === 'close') queueMicrotask(() => { this.readyState = 3; this.dispatchEvent(new Event('close')); });
      else this.readyState = 0;
    }
    close() { this.readyState = 3; queueMicrotask(() => this.dispatchEvent(new Event('close'))); }
    send(serialized) {
      const msg = JSON.parse(serialized);
      commands.push(msg);
      if (closeDuringEvaluate && msg.method === 'Runtime.evaluate') {
        queueMicrotask(() => { this.readyState = 3; this.dispatchEvent(new Event('close')); });
        return;
      }
      if (droppedEvaluate && msg.method === 'Runtime.evaluate') return;
      queueMicrotask(() => {
        let result = {};
        if (msg.method === 'Target.attachToTarget') result = { sessionId: 'session-fixture' };
        if (msg.method === 'Target.createTarget') result = { targetId: 'target-fixture' };
        if (msg.method === 'Page.navigate') result = navigationError ? { errorText: 'net::ERR_FAILED' } : { frameId: 'frame-fixture', loaderId: 'loader-new' };
        if (msg.method === 'Page.getFrameTree') result = { frameTree: { frame: { id: 'main-frame' } } };
        if (msg.method === 'Page.navigateToHistoryEntry') setTimeout(() => {
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method: 'Page.frameNavigated', sessionId: 'session-fixture', params: { frame: { id: 'main-frame' } } }) }));
        }, backDelay);
        if (msg.method === 'Page.getNavigationHistory') result = { currentIndex: noHistory ? 0 : 1, entries: [{ id: 1 }, { id: 2 }] };
        if (msg.method === 'Runtime.evaluate') {
          try {
            const value = vm.runInContext(msg.params.expression, page);
            result = { result: { value } };
            if (value?.focus_verified && stealFocusTarget) {
              pageDocument.activeElement = stealFocusTarget;
              stealFocusTarget = null;
            }
            if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
              coordinateEvaluations++;
              if (coordinateRace === 'occlude-after-first' && coordinateEvaluations === 1) hitTarget = element('overlay');
              if (coordinateRace === 'move-after-first' && coordinateEvaluations === 1 && lastActionElement) {
                lastActionElement.getBoundingClientRect = () => ({ x: 20, y: 0, width: 40, height: 20 });
              }
              if (coordinateRace === 'replace-after-first' && coordinateEvaluations === 1) {
                const replacement = element('racy-target');
                selectors.set('#racy-target', [replacement]);
                hitTarget = replacement;
              }
              if (coordinateRace === 'occlude-after-second' && coordinateEvaluations === 2) hitTarget = element('overlay');
            }
          }
          catch (error) { result = { exceptionDetails: { text: 'Uncaught', exception: { description: error.message } } }; }
        }
        if (msg.method === 'Input.insertText') {
          const beforeInput = dispatchDocumentEvent('beforeinput', pageDocument.activeElement,
            { inputType: 'insertText', data: msg.params.text });
          const target = pageDocument.activeElement;
          if (!beforeInput.defaultPrevented && target && typeof target.value === 'string') {
            const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
            const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
            target.value = target.value.slice(0, start) + msg.params.text + target.value.slice(end);
            target.selectionStart = target.selectionEnd = start + msg.params.text.length;
            target.dispatchEvent(new Event('input'));
          }
        }
        if (msg.method === 'Input.dispatchMouseEvent') {
          const target = pageDocument.elementFromPoint(msg.params.x, msg.params.y);
          if (msg.params.type === 'mousePressed') {
            pressedTarget = target;
            dispatchDocumentEvent('mousedown', target, { clientX: msg.params.x, clientY: msg.params.y });
          }
          if (msg.params.type === 'mouseReleased') {
            dispatchDocumentEvent('mouseup', target, { clientX: msg.params.x, clientY: msg.params.y });
            if (target && target === pressedTarget) {
              const clickEvent = dispatchDocumentEvent('click', target, { clientX: msg.params.x, clientY: msg.params.y });
              if (!clickEvent.defaultPrevented) target.click?.();
            }
            pressedTarget = null;
          }
        }
        if (msg.method === 'DOM.getDocument') result = { root: { nodeId: 1 } };
        if (msg.method === 'DOM.querySelector') result = { nodeId: querySelectorAll(msg.params.selector).length ? 2 : 0 };
        if (msg.method === 'DOM.querySelectorAll') result = { nodeIds: querySelectorAll(msg.params.selector).map((_, i) => i + 2) };
        if (msg.method === 'DOM.describeNode') result = { node: { nodeName: 'INPUT', attributes: ['type', 'file'] } };
        if (msg.method === 'DOM.setFileInputFiles') filesSet++;
        Promise.resolve(result.result?.value).then(value => {
          if (result.result) result.result.value = value;
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: msg.id, result }) }));
        });
      });
    }
  }
  const context = vm.createContext({ http, URL, fs, path, os, net, randomUUID, WebSocket: FakeWebSocket,
    buildElementActionExpression, buildReadPageExpression, validatePressKey,
    browserConfigFromEnv: () => ({mode:'endpoint',endpoint:'http://127.0.0.1:9334',profile_dir:null,start_timeout_ms:80,connect_timeout_ms:40}),
    ensureBrowser: async () => { prepareCalls++; return {mode:'endpoint',endpoint:'http://127.0.0.1:9334',profile_dir:null,webSocketDebuggerUrl:'ws://127.0.0.1:9334/devtools/browser/fake'}; },
    console: { log() {}, error() {} }, process: { env: { CDP_PROXY_PORT: '0' }, pid: process.pid, on() {} },
    setTimeout, setInterval, clearTimeout, clearInterval, Buffer, performance });
  const server = await vm.runInContext(`(async () => { ${source}\n
    if (${connectAtStart}) await connect();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server;
  })()`, context);
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { commands, selectors, element, socketURLs, prepareCalls: () => prepareCalls, set ready(value) { ready = value; },
    set droppedEvaluate(value) { droppedEvaluate = value; }, set closeDuringEvaluate(value) { closeDuringEvaluate = value; }, set navigationError(value) { navigationError = value; },
    set noHistory(value) { noHistory = value; }, set backDelay(value) { backDelay = value; },
    set hitTarget(value) { hitTarget = value; },
    set stealFocusTarget(value) { stealFocusTarget = value; },
    set coordinateRace(value) { coordinateRace = value; },
    addEarlyBeforeInput(listener) {
      const listeners = documentListeners.get('beforeinput') || [];
      listeners.unshift(listener); documentListeners.set('beforeinput', listeners);
    },
    dispatchedEvents, pageDocument,
    mutations: () => ({ clicked, scrolled, filesSet }),
    async requestChunkedOversize(endpoint) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const req = http.request(base + endpoint, { method: 'POST', headers: { 'transfer-encoding': 'chunked' } }, response => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { body += chunk; });
          response.on('end', () => {
            if (settled) return;
            settled = true; clearTimeout(timer); req.end();
            resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) });
          });
        });
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true; req.destroy(); reject(new Error('oversized chunked request did not receive an immediate response'));
        }, 500);
        req.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
        req.write(Buffer.alloc(1024 * 1024 + 1, 120));
      });
    },
    async requestDeclaredOversize(endpoint) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const req = http.request(base + endpoint, { method: 'POST', headers: { 'content-length': 1024 * 1024 + 1 } }, response => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { body += chunk; });
          response.on('end', () => {
            if (settled) return;
            settled = true; clearTimeout(timer); req.destroy();
            resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) });
          });
        });
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true; req.destroy(); reject(new Error('declared oversized request did not receive an immediate response'));
        }, 500);
        req.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
        req.flushHeaders();
      });
    },
    async request(endpoint, body) {
      const response = await fetch(base + endpoint, { method: body === undefined ? 'GET' : 'POST',
        body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
  };
}

const conditions = [
  { state: 'blocked', selector: '.challenge', visible: true },
  { state: 'empty', selector: '.empty', visible: true },
  { state: 'results_ready', selector: '.results', visible: true },
];

test('wait awaits asynchronous results without clicking, scrolling or mutating DOM', async t => {
  const f = await fixture(t);
  setTimeout(() => f.selectors.set('.results', [f.element('result')]), 40);
  const result = await f.request('/wait?target=fixture', { conditions, timeout_ms: 300, poll_ms: 10 });
  assert.equal(result.status, 200);
  assert.equal(result.body.state, 'results_ready');
  assert.equal(result.body.matched, true);
  assert.deepEqual(f.mutations(), { clicked: 0, scrolled: 0, filesSet: 0 });
});
for (const state of ['blocked', 'empty']) {
  test(`wait distinguishes ${state} from results`, async t => {
    const f = await fixture(t);
    f.selectors.set(state === 'blocked' ? '.challenge' : '.empty', [f.element(state)]);
    f.selectors.set('.results', [f.element('stale-result')]);
    const result = await f.request('/wait?target=fixture', { conditions, timeout_ms: 100, poll_ms: 10 });
    assert.equal(result.body.state, state);
  });
}
test('wait timeout is bounded and reports latest selector diagnostics', async t => {
  const f = await fixture(t);
  const started = performance.now();
  const result = await f.request('/wait?target=fixture', { conditions, timeout_ms: 50, poll_ms: 10 });
  assert.equal(result.status, 408);
  assert.equal(result.body.code, 'WAIT_TIMEOUT');
  assert.equal(result.body.state, 'timeout');
  assert.equal(result.body.diagnostics[0].match_count, 0);
  assert.ok(performance.now() - started < 1000);
});
test('wait visibility defaults true; explicit false allows hidden existing elements', async t => {
  const f = await fixture(t);
  const first = await f.request('/wait?target=fixture', { conditions: [{ state: 'results_ready', selector: '.hidden' }], timeout_ms: 30, poll_ms: 10 });
  assert.equal(first.body.state, 'timeout');
  const second = await f.request('/wait?target=fixture', { conditions: [{ state: 'results_ready', selector: '.hidden', visible: false }], timeout_ms: 30, poll_ms: 10 });
  assert.equal(second.body.state, 'results_ready');
});
for (const endpoint of ['click', 'clickAt', 'setFiles']) {
  test(`${endpoint} rejects ambiguous selectors before performing an action`, async t => {
    const f = await fixture(t);
    const body = endpoint === 'setFiles' ? { selector: '.files', files: ['/tmp/fixture.txt'] } : '.duplicate';
    const result = await f.request(`/${endpoint}?target=fixture`, body);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'SELECTOR_AMBIGUOUS');
    assert.equal(result.body.match_count, 2);
    assert.equal(result.body.candidates.length, 2);
    assert.deepEqual(f.mutations(), { clicked: 0, scrolled: 0, filesSet: 0 });
    assert.equal(f.commands.some(c => c.method === 'Input.dispatchMouseEvent'), false);
  });
}
for (const selector of ['#missing', '[']) {
  test(`click provides structured diagnostics for ${selector}`, async t => {
    const f = await fixture(t);
    const result = await f.request('/click?target=fixture', selector);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, selector === '[' ? 'INVALID_SELECTOR' : 'ELEMENT_NOT_FOUND');
    assert.equal(result.body.selector, selector);
  });
}
for (const endpoint of ['click', 'clickAt']) {
  test(`${endpoint} rejects GET before parsing a selector`, async t => {
    const result = await (await fixture(t)).request(`/${endpoint}?target=fixture`);
    assert.equal(result.status, 405);
    assert.equal(result.body.code, 'METHOD_NOT_ALLOWED');
  });
}
test('unique selectors preserve click, clickAt and hidden file input behavior', async t => {
  const f = await fixture(t);
  for (const endpoint of ['click', 'clickAt']) {
    const result = (await f.request(`/${endpoint}?target=fixture`, '#unique')).body;
    assert.equal(result.clicked, true);
    assert.equal(result.status, 'dispatched');
    assert.equal(result.outcome_verified, false);
    if (endpoint === 'clickAt') assert.equal(result.dispatch_target_verified, true);
  }
  assert.equal((await f.request('/setFiles?target=fixture', { selector: '#upload', files: ['/tmp/a.txt'] })).body.success, true);
});

for (const [name, configure, expected] of [
  ['disabled', element => { element.disabled = true; }, 'ELEMENT_DISABLED'],
  ['aria-disabled', element => { element.setAttribute('aria-disabled', 'true'); }, 'ELEMENT_DISABLED'],
  ['inert', element => { element.inert = true; }, 'ELEMENT_INERT'],
  ['hidden', element => { element.hidden = true; element.getClientRects = () => []; }, 'ELEMENT_NOT_VISIBLE'],
  ['pointer-disabled', element => { element.pointerEvents = 'none'; }, 'POINTER_EVENTS_DISABLED'],
  ['center-occluded', (_element, fixture) => { fixture.hitTarget = { id: 'overlay' }; }, 'ELEMENT_OCCLUDED'],
]) {
  for (const endpoint of ['click', 'clickAt']) {
    test(`${endpoint} rejects ${name} targets without dispatching the action`, async t => {
      const f = await fixture(t);
      const target = f.element('action-target');
      configure(target, f);
      f.selectors.set('#action-target', [target]);
      const result = await f.request(`/${endpoint}?target=fixture`, '#action-target');
      assert.equal(result.status, 400);
      assert.equal(result.body.code, expected);
      assert.equal(f.commands.some(command => command.method === 'Input.dispatchMouseEvent'), false);
    });
  }
}

test('fill, insertText, press and handleJsDialog expose dispatch evidence', async t => {
  const f = await fixture(t);
  const input = f.element('name', true, 'INPUT');
  input.type = 'text';
  f.selectors.set('#name', [input]);
  const fill = await f.request('/fill?target=fixture', { selector: '#name', text: 'Ada' });
  assert.equal(fill.status, 200);
  assert.equal(fill.body.immediate_value_verified, true);
  assert.equal(fill.body.status, 'dispatched');
  assert.equal(fill.body.outcome_verified, false);
  assert.deepEqual(f.dispatchedEvents, ['input', 'change']);

  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  const insert = await f.request('/insertText?target=fixture', { selector: '#name', text: ' Lovelace' });
  assert.equal(insert.body.focus_verified, true);
  assert.equal(insert.body.insert_target_verified, true);
  assert.equal(insert.body.status, 'dispatched');
  assert.equal(insert.body.outcome_verified, false);
  assert.equal(insert.body.insertion_method, 'exact_target_dom_edit');
  assert.equal(insert.body.keyboard_semantics, false);
  assert.equal(input.value, 'Ada Lovelace');
  assert.equal(f.commands.some(command => command.method === 'Input.insertText'), false);

  const buttonInsert = await f.request('/insertText?target=fixture', { selector: '#unique', text: 'unsafe' });
  assert.equal(buttonInsert.status, 400);
  assert.equal(buttonInsert.body.code, 'INVALID_ELEMENT');
  const readOnly = f.element('readonly', true, 'INPUT');
  readOnly.type = 'text';
  readOnly.readOnly = true;
  f.selectors.set('#readonly', [readOnly]);
  const readOnlyInsert = await f.request('/insertText?target=fixture', { selector: '#readonly', text: 'unsafe' });
  assert.equal(readOnlyInsert.status, 400);
  assert.equal(readOnlyInsert.body.code, 'ELEMENT_READONLY');

  for (const key of ['Enter', '学']) {
    const pressed = await f.request('/press?target=fixture', { key });
    assert.equal(pressed.body.status, 'dispatched');
    assert.equal(pressed.body.outcome_verified, false);
  }
  const invalid = await f.request('/press?target=fixture', { key: 'Ctrl+Enter' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'INVALID_ARGUMENT');

  const dialog = await f.request('/handleJsDialog?target=fixture', { accept: true, prompt_text: 'confirmed' });
  assert.equal(dialog.body.status, 'dispatched');
  assert.equal(dialog.body.outcome_verified, false);
  assert.equal(f.commands.some(command => command.method === 'Page.handleJavaScriptDialog' &&
    command.params.accept === true && command.params.promptText === 'confirmed'), true);
});

test('insertText finishes the exact-target edit before a microtask can steal focus', async t => {
  const f = await fixture(t);
  const intended = f.element('intended', true, 'INPUT');
  intended.type = 'text'; intended.value = 'first'; intended.selectionStart = intended.selectionEnd = 5;
  const other = f.element('other', true, 'INPUT');
  other.type = 'text'; other.value = 'second'; other.selectionStart = other.selectionEnd = 6;
  f.selectors.set('#intended', [intended]);
  f.selectors.set('#other', [other]);
  f.stealFocusTarget = other;

  const result = await f.request('/insertText?target=fixture', { selector: '#intended', text: '-unsafe' });
  assert.equal(result.status, 200);
  assert.equal(result.body.insertion_method, 'exact_target_dom_edit');
  assert.equal(result.body.keyboard_semantics, false);
  assert.equal(result.body.insert_target_verified, true);
  assert.equal(intended.value, 'first-unsafe');
  assert.equal(other.value, 'second');
  assert.equal(f.commands.some(command => command.method === 'Input.insertText'), false);
});

test('insertText aborts if an earlier capture listener synchronously moves focus', async t => {
  const f = await fixture(t);
  const intended = f.element('intended', true, 'INPUT');
  intended.type = 'text'; intended.value = 'first'; intended.selectionStart = intended.selectionEnd = 5;
  const other = f.element('other', true, 'INPUT');
  other.type = 'text'; other.value = 'second'; other.selectionStart = other.selectionEnd = 6;
  f.selectors.set('#intended', [intended]);
  f.addEarlyBeforeInput(event => {
    f.pageDocument.activeElement = other;
    event.stopImmediatePropagation();
  });
  const result = await f.request('/insertText?target=fixture', { selector: '#intended', text: '-unsafe' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'FOCUS_LOST');
  assert.equal(result.body.insert_target_verified, false);
  assert.equal(intended.value, 'first');
  assert.equal(other.value, 'second');
});

test('insertText respects a canceled beforeinput without editing', async t => {
  const f = await fixture(t);
  const intended = f.element('intended', true, 'INPUT');
  intended.type = 'text'; intended.value = 'first'; intended.selectionStart = intended.selectionEnd = 5;
  f.selectors.set('#intended', [intended]);
  f.addEarlyBeforeInput(event => event.preventDefault());
  const result = await f.request('/insertText?target=fixture', { selector: '#intended', text: '-canceled' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'INPUT_CANCELED');
  assert.equal(result.body.insert_target_verified, false);
  assert.equal(intended.value, 'first');
});

for (const [race, expected] of [
  ['occlude-after-first', 'ELEMENT_OCCLUDED'],
  ['move-after-first', 'ELEMENT_CHANGED'],
  ['replace-after-first', 'ELEMENT_CHANGED'],
]) {
  test(`clickAt refuses dispatch after ${race}`, async t => {
    const f = await fixture(t);
    const target = f.element('racy-target');
    f.selectors.set('#racy-target', [target]);
    f.coordinateRace = race;
    const result = await f.request('/clickAt?target=fixture', '#racy-target');
    assert.equal(result.status, 409);
    assert.equal(result.body.code, expected);
    assert.equal(result.body.dispatch_target_verified, false);
    assert.equal(f.commands.some(command => command.method === 'Input.dispatchMouseEvent'), false);
    assert.equal(f.mutations().clicked, 0);
  });
}

test('clickAt capture guard blocks a target change after final preflight', async t => {
  const f = await fixture(t);
  const target = f.element('racy-target');
  f.selectors.set('#racy-target', [target]);
  f.coordinateRace = 'occlude-after-second';
  const result = await f.request('/clickAt?target=fixture', '#racy-target');
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'ELEMENT_OCCLUDED');
  assert.equal(result.body.dispatch_target_verified, false);
  assert.equal(f.mutations().clicked, 0);
});

test('request bodies over one MiB preserve HTTP 413 through every JSON route', async t => {
  const f = await fixture(t);
  for (const endpoint of [
    '/eval?target=fixture', '/fill?target=fixture', '/readPage?target=fixture',
    '/wait?target=fixture', '/setFiles?target=fixture',
  ]) {
    const result = await f.requestDeclaredOversize(endpoint);
    assert.equal(result.status, 413, endpoint);
    assert.equal(result.body.code, 'PAYLOAD_TOO_LARGE', endpoint);
    assert.equal(result.body.max_bytes, 1024 * 1024, endpoint);
    assert.equal(result.headers.connection, 'close', endpoint);
  }
  assert.equal(f.commands.some(command => command.method === 'Runtime.evaluate'), false);
});

test('a chunked oversized body receives JSON 413 before the client finishes sending', async t => {
  const f = await fixture(t);
  const result = await f.requestChunkedOversize('/fill?target=fixture');
  assert.equal(result.status, 413);
  assert.equal(result.body.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(result.body.max_bytes, 1024 * 1024);
  assert.equal(result.headers.connection, 'close');
});

for (const [endpoint, body] of [
  ['/fill?target=fixture', { selector: '#unique', text: 'x', extra: true }],
  ['/insertText?target=fixture', { selector: '#unique', text: 1 }],
  ['/press?target=fixture', { key: 'Enter', extra: true }],
  ['/handleJsDialog?target=fixture', { accept: 'yes' }],
]) {
  test(`${endpoint} rejects ambiguous request bodies`, async t => {
    const result = await (await fixture(t)).request(endpoint, body);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'INVALID_ARGUMENT');
  });
}
test('readPage exposes bounded page evidence for one explicit visible region', async t => {
  const f = await fixture(t);
  const append = (parent, ...children) => {
    parent.childNodes.push(...children);
    for (const child of children) child.parentElement = parent;
  };
  const meta = (name, content) => {
    const element = f.element(`meta-${name}-${content}`, true, 'META');
    element.setAttribute('name', name);
    element.setAttribute('content', content);
    return element;
  };
  const head = f.element('fixture-head', true, 'HEAD');
  append(head,
    meta('citation_title', 'Readable heading'),
    meta('citation_author', 'Ada Lovelace'),
    meta('citation_author', 'Ada Lovelace'),
    meta('citation_author', 'Grace Hopper'));
  const heading = f.element('heading', true, 'H1');
  heading.childNodes = [{ nodeType: 3, nodeValue: 'Readable heading', parentElement: heading }];
  const link = f.element('source', true, 'A');
  link.childNodes = [{ nodeType: 3, nodeValue: 'Source', parentElement: link }];
  link.getAttribute = name => name === 'href' ? 'https://example.test/source' : null;
  link.hasAttribute = name => name === 'href';
  const root = f.element('read-root', true, 'ARTICLE');
  append(root, { nodeType: 3, nodeValue: 'Readable article content', parentElement: root }, heading, link);
  const body = f.element('fixture-body', true, 'BODY');
  append(body, root);
  const html = f.element('fixture-html', true, 'HTML');
  append(html, head, body);
  f.pageDocument.head = head;
  f.pageDocument.body = body;
  f.pageDocument.documentElement = html;
  f.selectors.set('#read-root', [root]);
  const result = await f.request('/readPage?target=fixture', { selector: '#read-root', max_chars: 100, max_links: 10 });
  assert.equal(result.status, 200);
  assert.equal(result.body.text, 'Readable article content\nReadable heading\nSource');
  assert.deepEqual(result.body.headings, [{ level: 1, text: 'Readable heading' }]);
  assert.deepEqual(result.body.links, [{ text: 'Source', url: 'https://example.test/source' }]);
  assert.deepEqual(result.body.citation_meta, {
    citation_title: ['Readable heading'], citation_author: ['Ada Lovelace', 'Grace Hopper'],
  });
  assert.equal(result.body.truncated.citation_meta, false);
  assert.deepEqual(result.body.extraction, { method: 'selector', selector: '#read-root', heuristic: true,
    scope: 'current_frame_light_dom', candidate_scan_truncated: false });
});
for (const endpoint of ['/new?url=file:///fixture', '/navigate?target=fixture&url=file:///fixture', '/back?target=fixture']) {
  test(`${endpoint} exposes load completion`, async t => {
    const f = await fixture(t);
    const result = await f.request(endpoint);
    assert.equal(result.status, 200);
    assert.equal(result.body.load_status, 'complete');
  });
}
test('new about:blank exposes load status', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/new')).body.load_status, 'complete');
});
test('navigate reports CDP errorText as navigation failure', async t => {
  const f = await fixture(t);
  f.navigationError = true;
  const result = await f.request('/navigate?target=fixture&url=file:///fixture');
  assert.equal(result.body.load_status, 'error');
  assert.equal(result.body.code, 'NAVIGATION_FAILED');
});
test('health identifies the exact test process and bound ephemeral port', async t => {
  const f = await fixture(t);
  const result = await f.request('/health');
  assert.equal(result.body.pid, process.pid);
  assert.ok(result.body.port > 0);
  assert.equal(typeof result.body.instance_id, 'string');
});
test('eval retains asynchronous Promise support', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/eval?target=fixture', 'Promise.resolve({answer:42})')).body, { value: { answer: 42 } });
});

test('navigation bounds incomplete document waits and exposes timeout', async t => {
  const f = await fixture(t);
  f.ready = 'loading';
  const started = performance.now();
  const result = await f.request('/navigate?target=fixture&url=file:///fixture&timeout_ms=40');
  assert.equal(result.body.load_status, 'timeout');
  assert.ok(performance.now() - started < 1000);
});
test('wait caps an unresponsive CDP evaluation at its deadline', async t => {
  const f = await fixture(t);
  f.droppedEvaluate = true;
  const started = performance.now();
  const result = await f.request('/wait?target=fixture', { conditions, timeout_ms: 40, poll_ms: 10 });
  assert.equal(result.body.code, 'WAIT_TIMEOUT');
  assert.ok(performance.now() - started < 1000);
});
for (const body of [null, {}, { conditions: [] }, { conditions, timeout_ms: -1 }, { conditions, poll_ms: 0 },
  { conditions: [{ state: 'results_ready', selector: '.results', visible: 'false' }] },
  { conditions: [{ state: 'arbitrary_guess', selector: '.results' }] }]) {
  test(`wait validates request schema: ${JSON.stringify(body)}`, async t => {
    const f = await fixture(t);
    const result = await f.request('/wait?target=fixture', body);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'INVALID_ARGUMENT');
  });
}
test('wait rejects malformed selectors with diagnostic code', async t => {
  const f = await fixture(t);
  const result = await f.request('/wait?target=fixture', { conditions: [{ state: 'results_ready', selector: '[' }], timeout_ms: 40 });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'INVALID_SELECTOR');
});

test('back waits for the new document rather than reporting the previous complete document', async t => {
  const f = await fixture(t);
  f.backDelay = 40;
  const started = performance.now();
  const result = await f.request('/back?target=fixture&timeout_ms=1000');
  assert.equal(result.body.load_status, 'complete');
  assert.ok(performance.now() - started >= 30, 'old complete document must not satisfy back load');
});

test('new reports navigation failure without losing the created target for cleanup', async t => {
  const f = await fixture(t);
  f.navigationError = true;
  const result = await f.request('/new?url=file:///fixture');
  assert.equal(result.body.targetId, 'target-fixture');
  assert.equal(result.body.load_status, 'error');
  assert.equal(result.body.code, 'NAVIGATION_FAILED');
});

test('wait reports a closed WebSocket as disconnection, not a business-state timeout', async t => {
  const f = await fixture(t);
  f.closeDuringEvaluate = true;
  const result = await f.request('/wait?target=fixture', { conditions, timeout_ms: 80, poll_ms: 10 });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'CDP_DISCONNECTED');
  assert.equal(result.body.state, undefined, 'transport failure is not a page-state outcome');
});

test('health is read-only when the browser has never connected', async t => {
  const f = await fixture(t, {connectAtStart:false});
  const health = (await f.request('/health')).body;
  assert.equal(health.connected, false);
  assert.equal(f.socketURLs.length, 0, 'health must not open a browser WebSocket');
  assert.equal(f.prepareCalls(), 0, 'health must not start or inspect a browser');
  assert.equal(health.version, '1.4.0');
  assert.deepEqual(health.browser, {mode:'endpoint',endpoint:'http://127.0.0.1:9334',profile_dir:null});
});
test('browser handshake has a bounded deadline', {timeout:500}, async t => {
  const f = await fixture(t, {connectAtStart:false,socketBehavior:'never'});
  const response = await f.request('/targets');
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'CDP_CONNECT_TIMEOUT');
});
test('browser close before handshake rejects instead of hanging readiness', {timeout:500}, async t => {
  const f = await fixture(t, {connectAtStart:false,socketBehavior:'close'});
  const response = await f.request('/targets');
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'CDP_DISCONNECTED');
});
