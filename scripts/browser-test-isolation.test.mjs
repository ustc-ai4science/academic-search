import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// An unrelated healthy endpoint must never stand in for the code under test.
// The occupied-port path exits before Chrome discovery, so this is fully offline.
test('shell smoke refuses an older healthy proxy and never operates its targets', { timeout: 5000 }, async t => {
  const paths = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', connected: true, pid: process.pid, instance_id: 'old-instance' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const child = spawn('bash', [fileURLToPath(new URL('./self-test.sh', import.meta.url))], {
    env: { ...process.env, CDP_PROXY_PORT: String(server.address().port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(exitCode, 1, output);
  assert.match(output, /refusing to test an existing instance/);
  assert.equal(paths.length, 0, 'occupied proxy must never be probed, even through /health');
});
