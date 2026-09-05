import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const module = await import('./proxy-owner.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
function check(details) {
  assert.equal(typeof module?.proxyOwnerMatches, 'function', 'proxy ownership verifier must exist');
  return module.proxyOwnerMatches(details);
}

async function ownedListener(t, markerSuffix = '') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'academic proxy owner '));
  const script = path.join(directory, 'owned listener.mjs');
  const marker = randomUUID();
  await fs.writeFile(script, `import net from 'node:net';
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `);
  const child = spawn(process.execPath, [script, `--academic-proxy-owner=${marker}${markerSuffix}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('listener startup timed out')), 3000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout.once('data', chunk => { clearTimeout(timeout); resolve(Number(String(chunk).trim())); });
  });
  assert.ok(Number.isInteger(port) && port > 0);
  return { pid: child.pid, port, marker, script };
}

test('matching process marker, script path with spaces and listener PID can be reused', async t => {
  const owner = await ownedListener(t);
  assert.equal(await check(owner), true);
});

test('a live unrelated PID cannot pass an old ownership record', async t => {
  const owner = await ownedListener(t);
  assert.equal(await check({ ...owner, pid: process.pid }), false);
});

test('a process with the right marker cannot claim another process listening port', async t => {
  const owner = await ownedListener(t);
  const other = await ownedListener(t);
  assert.equal(await check({ ...owner, port: other.port }), false);
});

test('changed marker or script identity refuses reuse', async t => {
  const owner = await ownedListener(t);
  assert.equal(await check({ ...owner, marker: randomUUID() }), false);
  assert.equal(await check({ ...owner, script: `${owner.script}.other` }), false);
});

test('the marker must be an entire argument rather than a string prefix', async t => {
  const owner = await ownedListener(t, '-extra');
  assert.equal(await check(owner), false);
});

test('invalid numeric identifiers and marker data fail closed', async () => {
  const details = { pid: process.pid, port: 3457, marker: randomUUID(), script: path.resolve('scripts/cdp-proxy.mjs') };
  for (const replacement of [{ pid: 0 }, { pid: -1 }, { pid: '1; echo unsafe' }, { port: 0 },
    { port: 65536 }, { port: '3457' }, { marker: 'not-a-uuid' }, { script: 'relative.mjs' }]) {
    assert.equal(await check({ ...details, ...replacement }), false);
  }
});

test('missing or malformed ownership records fail closed', async () => {
  for (const details of [undefined, null, {}, 'old-record']) assert.equal(await check(details), false);
});

test('missing operating-system tools refuse reuse without making network requests', async t => {
  const owner = await ownedListener(t);
  const originalPath = process.env.PATH;
  process.env.PATH = path.dirname(owner.script);
  try { assert.equal(await check(owner), false); }
  finally { process.env.PATH = originalPath; }
});
