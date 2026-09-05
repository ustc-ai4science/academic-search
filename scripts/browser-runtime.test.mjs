import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { EventEmitter } from 'node:events';

const runtime = await import('./browser-runtime.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
function api() {
  assert.ok(runtime?.browserConfigFromEnv && runtime?.ensureBrowser, 'explicit/dedicated browser runtime must exist');
  return runtime;
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'academic-browser-runtime-'));
  const profile = path.join(dir, 'profile');
  await fs.mkdir(profile);
  const executable = path.join(dir, 'fake-chrome');
  await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  let wsPath = '/devtools/browser/runtime-fixture';
  let remoteWs = false;
  let responseStatus = 200;
  let wrongPort = false;
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    res.statusCode = responseStatus;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ Browser: 'Chrome/fixture', webSocketDebuggerUrl: remoteWs
      ? 'ws://example.com:9222/devtools/browser/remote'
      : `ws://127.0.0.1:${wrongPort ? 1 : server.address().port}${wsPath}` }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(dir, { recursive: true, force: true });
  });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const config = api().browserConfigFromEnv({ ACADEMIC_CHROME_PROFILE: profile,
    ACADEMIC_CHROME_EXECUTABLE: executable, ACADEMIC_CHROME_START_TIMEOUT_MS: '200' }, dir);
  return { dir, profile, executable, endpoint, config, requests,
    set remoteWs(value) { remoteWs = value; }, set responseStatus(value) { responseStatus = value; },
    set wrongPort(value) { wrongPort = value; },
    async activePort() { await fs.writeFile(path.join(profile, 'DevToolsActivePort'), `${server.address().port}\n${wsPath}\n`); },
    async nextBrowser() { wsPath = '/devtools/browser/next-browser'; await this.activePort(); },
  };
}
function child() { const process = new EventEmitter(); process.unref = () => {}; return process; }

test('default config describes a dedicated profile without starting or discovering Chrome', () => {
  const c = api().browserConfigFromEnv({}, '/test-home');
  assert.equal(c.mode, 'managed');
  assert.equal(c.profile_dir, '/test-home/.local/share/academic-search/chrome-profile');
  assert.equal(c.endpoint, null);
  assert.equal(c.executable, null);
  assert.equal(c.start_timeout_ms, 15000);
  assert.equal(c.connect_timeout_ms, 5000);
});
test('explicit endpoint config disables managed profile and validates loopback', () => {
  const c = api().browserConfigFromEnv({ ACADEMIC_CHROME_ENDPOINT: 'http://127.0.0.1:9334/' });
  assert.equal(c.mode, 'endpoint');
  assert.equal(c.endpoint, 'http://127.0.0.1:9334');
  assert.equal(c.profile_dir, null);
  for (const endpoint of ['http://example.com:9334', 'file:///tmp/browser', 'http://user:pass@127.0.0.1:9334']) {
    assert.throws(() => api().browserConfigFromEnv({ ACADEMIC_CHROME_ENDPOINT: endpoint }), { code: 'BROWSER_CONFIG_INVALID' });
  }
});
test('explicit endpoint resolves metadata and never launches Chrome', async t => {
  const f = await fixture(t);
  const c = api().browserConfigFromEnv({ ACADEMIC_CHROME_ENDPOINT: f.endpoint });
  const result = await api().ensureBrowser(c, { spawnImpl() { assert.fail('explicit mode must not spawn'); } });
  assert.equal(result.endpoint, f.endpoint);
  assert.equal(result.launched, false);
  assert.equal(result.webSocketDebuggerUrl, f.endpoint.replace('http:', 'ws:') + '/devtools/browser/runtime-fixture');
  assert.deepEqual(f.requests, ['/json/version']);
});
test('explicit endpoint rejects remote WebSocket metadata without any fallback', async t => {
  const f = await fixture(t);
  f.remoteWs = true;
  const c = api().browserConfigFromEnv({ ACADEMIC_CHROME_ENDPOINT: f.endpoint });
  await assert.rejects(api().ensureBrowser(c, { spawnImpl() { assert.fail('must not fall back'); } }), { code: 'BROWSER_ENDPOINT_INVALID' });
  assert.deepEqual(f.requests, ['/json/version']);
});
test('managed mode reuses only its own matching DevToolsActivePort and refreshes browser UUID', async t => {
  const f = await fixture(t);
  await f.activePort();
  const noSpawn = { spawnImpl() { assert.fail('live owned profile must be reused'); } };
  assert.equal((await api().ensureBrowser(f.config, noSpawn)).endpoint, f.endpoint);
  await f.nextBrowser();
  assert.match((await api().ensureBrowser(f.config, noSpawn)).webSocketDebuggerUrl, /next-browser$/);
});
test('managed startup uses explicit dedicated user-data-dir and port zero', async t => {
  const f = await fixture(t);
  let invocation;
  const result = await api().ensureBrowser(f.config, { spawnImpl(executable, args, options) {
    invocation = { executable, args, options };
    void f.activePort();
    return child();
  } });
  assert.equal(result.launched, true);
  assert.equal(invocation.executable, f.executable);
  assert.ok(invocation.args.includes('--user-data-dir=' + await fs.realpath(f.profile)));
  assert.ok(invocation.args.includes('--remote-debugging-port=0'));
  assert.ok(invocation.args.includes('--remote-debugging-address=127.0.0.1'));
  assert.equal(result.endpoint, f.endpoint);
});
test('concurrent managed startup launches a profile once', async t => {
  const f = await fixture(t);
  let spawned = 0;
  const dependencies = { spawnImpl() { spawned++; setTimeout(() => { void f.activePort(); }, 20); return child(); } };
  await Promise.all([api().ensureBrowser(f.config, dependencies), api().ensureBrowser(f.config, dependencies)]);
  assert.equal(spawned, 1);
});
test('managed startup timeout does not scan or attach another Chrome', async t => {
  const f = await fixture(t);
  const started = performance.now();
  await assert.rejects(api().ensureBrowser({ ...f.config, start_timeout_ms: 35 }, { spawnImpl() { return child(); } }), { code: 'BROWSER_START_TIMEOUT' });
  assert.ok(performance.now() - started < 500);
  assert.deepEqual(f.requests, []);
});
test('managed mode rejects a daily Chrome data directory before launch', async t => {
  const f = await fixture(t);
  const daily = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  await assert.rejects(api().ensureBrowser({ ...f.config, profile_dir: daily }, { spawnImpl() { assert.fail('daily profile cannot launch'); } }), { code: 'BROWSER_PROFILE_UNSAFE' });
});

test('unavailable explicit endpoint fails without launching a managed fallback', async t => {
  const f = await fixture(t);
  f.responseStatus = 503;
  const config = api().browserConfigFromEnv({ACADEMIC_CHROME_ENDPOINT:f.endpoint});
  await assert.rejects(api().ensureBrowser(config, {spawnImpl() {assert.fail('no fallback launch');}}), {code:'BROWSER_ENDPOINT_UNAVAILABLE'});
  assert.deepEqual(f.requests, ['/json/version']);
});
test('explicit endpoint rejects a loopback WebSocket on a different port', async t => {
  const f = await fixture(t);
  f.wrongPort = true;
  const config = api().browserConfigFromEnv({ACADEMIC_CHROME_ENDPOINT:f.endpoint});
  await assert.rejects(api().ensureBrowser(config), {code:'BROWSER_ENDPOINT_INVALID'});
});
test('stale profile browser UUID cannot reuse a different browser at the same port', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.profile, 'DevToolsActivePort'), new URL(f.endpoint).port + '\n/devtools/browser/stale-browser\n');
  let launches = 0;
  const result = await api().ensureBrowser(f.config, {spawnImpl() { launches++; void f.activePort(); return child(); }});
  assert.equal(launches, 1);
  assert.equal(result.launched, true);
  assert.match(result.webSocketDebuggerUrl, /runtime-fixture$/);
});
