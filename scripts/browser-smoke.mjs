#!/usr/bin/env node
// Local-only browser checks. Every target is created and closed by this process.
import assert from 'node:assert/strict';
import http from 'node:http';

const [base, expectedPid] = process.argv.slice(2);
if (!base || !expectedPid) throw new Error('usage: node browser-smoke.mjs PROXY_URL EXPECTED_PID');
const targets = new Set();
const fixtureServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.write('<!doctype html><title>Slow local fixture</title><body>loading');
  // Keep the response incomplete until cleanup: machine/browser latency must not
  // make a fixed-delay fixture finish before the proxy has attached.
  res.on('error', () => {});
});
async function request(endpoint, body) {
  const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(20000),
    method: body === undefined ? 'GET' : 'POST',
    body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function create(url, timeout = 15000) {
  const result = await request(`/new?url=${encodeURIComponent(url)}&timeout_ms=${timeout}`);
  assert.equal(typeof result.body.targetId, 'string', JSON.stringify(result.body));
  targets.add(result.body.targetId);
  return result;
}
try {
  const health = (await request('/health')).body;
  assert.equal(health.pid, Number(expectedPid), 'smoke must use its own newly started proxy');
  assert.ok(health.instance_id);
  assert.equal(health.connected, true);
  const html = `<!doctype html><html><head><title>Academic Search browser fixture</title></head><body>
    <button class="duplicate" onclick="window.clicks++">Cite A</button>
    <button class="duplicate" onclick="window.clicks++">Cite B</button>
    <input class="uploads" type="file"><input class="uploads" type="file">
    <main id="results" hidden>Delayed result</main><p id="empty" hidden>No results</p>
    <p id="challenge" hidden>Verification required</p>
    <script>window.clicks=0;window.mutations=0;
      new MutationObserver(list=>window.mutations+=list.length).observe(document.body,{subtree:true,attributes:true,childList:true});
    </script></body></html>`;
  const created = await create('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  assert.equal(created.body.load_status, 'complete');
  const target = created.body.targetId;
  const endpoint = name => `/${name}?target=${target}`;
  const conditions = [
    { state: 'blocked', selector: '#challenge' },
    { state: 'empty', selector: '#empty' },
    { state: 'results_ready', selector: '#results' },
  ];
  assert.deepEqual((await request(endpoint('eval'), 'Promise.resolve({answer:42})')).body, { value: { answer: 42 } });
  for (const name of ['click', 'clickAt', 'setFiles']) {
    const body = name === 'setFiles' ? { selector: '.uploads', files: ['/tmp/not-uploaded.txt'] } : '.duplicate';
    const result = await request(endpoint(name), body);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'SELECTOR_AMBIGUOUS');
    assert.equal(result.body.match_count, 2);
  }
  assert.equal((await request(endpoint('eval'), 'window.clicks')).body.value, 0);
  const before = (await request(endpoint('eval'), '({mutations:window.mutations,scrollY})')).body.value;
  const timeout = await request(endpoint('wait'), { conditions, timeout_ms: 80, poll_ms: 10 });
  assert.equal(timeout.status, 408);
  assert.equal(timeout.body.state, 'timeout');
  assert.deepEqual((await request(endpoint('eval'), '({mutations:window.mutations,scrollY})')).body.value, before);
  await request(endpoint('eval'), 'setTimeout(() => document.querySelector("#results").hidden=false, 100); true');
  assert.equal((await request(endpoint('wait'), { conditions, timeout_ms: 2000, poll_ms: 20 })).body.state, 'results_ready');
  await request(endpoint('eval'), 'document.querySelector("#empty").hidden=false');
  assert.equal((await request(endpoint('wait'), { conditions })).body.state, 'empty');
  await request(endpoint('eval'), 'document.querySelector("#challenge").hidden=false');
  assert.equal((await request(endpoint('wait'), { conditions })).body.state, 'blocked');
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const slowUrl = `http://127.0.0.1:${fixtureServer.address().port}/slow`;
  const slow = await create(slowUrl, 40);
  assert.equal(slow.body.load_status, 'timeout');
  console.log('PASS: local browser wait, ambiguity, Promise, load-timeout and no-mutation fixtures');
} finally {
  for (const target of targets) await request(`/close?target=${target}`).catch(() => {});
  if (fixtureServer.listening) await new Promise(resolve => { fixtureServer.close(resolve); fixtureServer.closeAllConnections(); });
}
