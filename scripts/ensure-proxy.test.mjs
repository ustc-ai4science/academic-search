import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const staleState of [false, true]) {
  test(`bootstrap never contacts an unknown occupied proxy (stale state: ${staleState})`, async t => {
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push(req.url);
      res.end('{"status":"ok","connected":true}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academic-proxy-bootstrap-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const port = server.address().port;
    if (staleState) fs.writeFileSync(path.join(dir, `proxy-${port}.json`), JSON.stringify({
      version: '1.2.0', pid: process.pid, port, instance_id: 'old', script: '/old/cdp-proxy.mjs',
    }));
    const child = spawn(process.execPath, [fileURLToPath(new URL('./ensure-proxy.mjs', import.meta.url))], {
      env: { ...process.env, CDP_PROXY_PORT: String(port), ACADEMIC_PROXY_STATE_DIR: dir,
        ACADEMIC_CHROME_ENDPOINT: 'http://127.0.0.1:9334' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(exit, 1);
    assert.match(output, /PROXY_PORT_IN_USE/);
    assert.deepEqual(requests, [], 'even an old /health request can trigger the Chrome consent dialog');
  });
}
