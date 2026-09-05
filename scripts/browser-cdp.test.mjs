import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

// Execute the real HTTP router and CDP request code with an in-memory CDP transport.
// Only browser discovery is substituted: these tests never connect to real Chrome.
async function fixture(t) {
  const source = fs.readFileSync(new URL('./cdp-proxy.mjs', import.meta.url), 'utf8')
    .replace(/^#!.*\n/, '').replace(/^import .*;$/gm, '').replace(/^main\(\);$/m, '');
  const commands = [];
  let clicked = 0;
  let scrolled = 0;
  let filesSet = 0;
  let ready = 'complete';
  let droppedEvaluate = false;
  let closeDuringEvaluate = false;
  let navigationError = false;
  let noHistory = false;
  let backDelay = 0;
  const selectors = new Map();
  function element(id, visible = true, tag = 'BUTTON') {
    return { tagName: tag, id, textContent: id, className: '', type: tag === 'INPUT' ? 'file' : '',
      getAttribute(name) { return name === 'type' ? this.type : null; },
      scrollIntoView() { scrolled++; }, click() { clicked++; },
      getClientRects() { return visible ? [{}] : []; },
      getBoundingClientRect() { return { x: 0, y: 0, width: visible ? 40 : 0, height: visible ? 20 : 0 }; },
      hidden: !visible, isConnected: true };
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
  const page = vm.createContext({
    document: { querySelectorAll, querySelector: selector => querySelectorAll(selector)[0] || null,
      get readyState() { return ready; }, title: 'offline fixture' },
    getComputedStyle: el => ({ display: el.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
    history: { back() {} }, location: { href: 'file:///fixture.html' }, setTimeout, clearTimeout,
  });
  class FakeWebSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
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
          try { result = { result: { value: vm.runInContext(msg.params.expression, page) } }; }
          catch (error) { result = { exceptionDetails: { text: 'Uncaught', exception: { description: error.message } } }; }
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
    console: { log() {}, error() {} }, process: { env: { CDP_PROXY_PORT: '0' }, pid: process.pid, on() {} },
    setTimeout, setInterval, clearTimeout, clearInterval, Buffer, performance });
  const server = await vm.runInContext(`(async () => { ${source}\n
    discoverChromePort = async () => ({port: 9222, wsPath: '/fake'});
    await connect();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server;
  })()`, context);
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { commands, selectors, element, set ready(value) { ready = value; },
    set droppedEvaluate(value) { droppedEvaluate = value; }, set closeDuringEvaluate(value) { closeDuringEvaluate = value; }, set navigationError(value) { navigationError = value; },
    set noHistory(value) { noHistory = value; }, set backDelay(value) { backDelay = value; },
    mutations: () => ({ clicked, scrolled, filesSet }),
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
test('unique selectors preserve click, clickAt and hidden file input behavior', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/click?target=fixture', '#unique')).body.clicked, true);
  assert.equal((await f.request('/clickAt?target=fixture', '#unique')).body.clicked, true);
  assert.equal((await f.request('/setFiles?target=fixture', { selector: '#upload', files: ['/tmp/a.txt'] })).body.success, true);
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
