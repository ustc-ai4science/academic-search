import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { buildManifest, downloadManifest } from './oa-pdf-download.mjs';

const exec = promisify(execFile);
const scriptPath = fileURLToPath(new URL('./oa-pdf-download.mjs', import.meta.url));
const fixtureDir = fileURLToPath(new URL('./fixtures/pdf/', import.meta.url));
const validPdf = await fs.readFile(path.join(fixtureDir, 'valid.pdf'));
const corruptPdf = await fs.readFile(path.join(fixtureDir, 'corrupt-page-tree.pdf'));
let server;
let baseUrl;
let pdfinfoAvailable = false;
try { execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' }); pdfinfoAvailable = true; } catch {}

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/valid' }); res.end(); return; }
    if (req.url === '/host-redirect') {
      res.writeHead(302, { location: `http://localhost:${server.address().port}/valid` }); res.end(); return;
    }
    if (req.url === '/disconnect') { req.socket.destroy(); return; }
    if (req.url === '/slow') {
      res.writeHead(200, { 'content-type': 'application/pdf' }); res.flushHeaders();
      const timer = setTimeout(() => res.end(validPdf), 700);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    if (req.url === '/429') { res.writeHead(429, { 'retry-after': '60' }); res.end('rate limited'); return; }
    if (req.url === '/404') { res.writeHead(404); res.end('not found'); return; }
    const bodies = {
      '/valid': ['application/pdf', validPdf],
      '/wrong-mime': ['application/octet-stream', validPdf],
      '/html': ['application/pdf', '<html>Sign in to read this paper</html>'],
      '/truncated': ['application/pdf', validPdf.subarray(0, validPdf.length - 15)],
      '/invalid-xref': ['application/pdf', Buffer.from(validPdf.toString('latin1').replace(/startxref\n\d+/, 'startxref\n0'), 'latin1')],
      '/corrupt': ['application/pdf', corruptPdf],
    };
    const [mime, body] = bodies[req.url] || ['text/html', '<html>not a PDF</html>'];
    res.writeHead(200, { 'content-type': mime }); res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

async function workspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'academic PDF test '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function records(route) {
  return [{ title: 'A fixture paper', doi: '10.0000/fixture', full_text_status: 'open_pdf', pdf_url: `${baseUrl}${route}`, source_platforms: ['unpaywall'] }];
}

async function download(t, route, options = {}) {
  const dir = await workspace(t);
  const manifest = buildManifest(records(route));
  await downloadManifest(manifest, dir, { timeoutMs: 2000, ...options });
  return { item: manifest[0], dir };
}

test('CLI executes from an absolute path containing spaces', async t => {
  const dir = await workspace(t);
  const spacedScript = path.join(dir, 'PDF downloader.mjs');
  await fs.copyFile(scriptPath, spacedScript);
  const input = path.join(dir, 'input.json');
  const manifest = path.join(dir, 'manifest.json');
  await fs.writeFile(input, JSON.stringify(records('/valid')));
  const { stdout } = await exec(process.execPath, [spacedScript, '--input', input, '--manifest', manifest]);
  assert.notEqual(stdout.trim(), '', 'CLI must execute and report manifest counts');
  assert.equal(JSON.parse(stdout).eligible, 1);
  assert.equal(JSON.parse(await fs.readFile(manifest, 'utf8'))[0].download_status, 'eligible');
});

test('manifest keeps old statuses and starts evidence and identity unverified', () => {
  const manifest = buildManifest([...records('/valid'), { full_text_status: 'needs_institution' }]);
  assert.equal(manifest[0].download_status, 'eligible');
  assert.equal(manifest[1].download_status, 'skipped');
  assert.equal(manifest[0].pdf_verification_status, 'unverified');
  assert.equal(manifest[0].paper_identity_status, 'unverified');
  for (const field of ['final_url', 'content_type', 'checked_at', 'byte_length', 'sha256']) assert.equal(manifest[0][field], null);
});

test('manifest retains field evidence explaining the source-provided OA link', () => {
  const record = records('/valid')[0];
  record.field_sources = {
    pdf_url: [{ platform: 'publisher', source_url: 'https://example.org/article', checked_at: '2026-09-05T00:00:00Z', evidence_type: 'source_metadata' }],
  };
  const [item] = buildManifest([record]);
  assert.deepEqual(item.field_sources, record.field_sources);
  assert.equal(item.pdf_verification_status, 'unverified');
});

test('download source uses the candidate URL host even when an arXiv ID exists', () => {
  const manifest = buildManifest([{ ...records('/valid')[0], arxiv_id: '2601.00001', pdf_url: 'https://publisher.example/paper.pdf' }]);
  assert.equal(manifest[0].download_source, 'publisher.example');
});

test('discovery provider order cannot determine the PDF download host', () => {
  for (const platforms of [['unpaywall', 'openalex'], ['openalex', 'unpaywall']]) {
    const manifest = buildManifest([{ ...records('/valid')[0], source_platforms: platforms, pdf_url: 'https://repository.example/paper.pdf' }]);
    assert.equal(manifest[0].download_source, 'repository.example');
  }
});

test('download source changes to the final response host after a redirect', async t => {
  const dir = await workspace(t);
  const manifest = buildManifest(records('/host-redirect'));
  const originalUrl = manifest[0].pdf_url;
  // This also verifies the after-download behavior independently from manifest construction.
  manifest[0].download_source = '127.0.0.1';
  await downloadManifest(manifest, dir, { timeoutMs: 2000 });
  assert.equal(manifest[0].download_status, 'downloaded');
  assert.equal(manifest[0].download_source, 'localhost');
  assert.equal(new URL(manifest[0].final_url).hostname, 'localhost');
  assert.equal(manifest[0].pdf_url, originalUrl);
});

test('redirected PDF records final response provenance and bounded validation', async t => {
  const { item, dir } = await download(t, '/redirect');
  assert.equal(item.download_status, 'downloaded');
  assert.equal(item.final_url, `${baseUrl}/valid`);
  assert.equal(item.content_type, 'application/pdf');
  assert.equal(item.byte_length, validPdf.length);
  assert.equal(item.sha256, crypto.createHash('sha256').update(validPdf).digest('hex'));
  assert.ok(Number.isFinite(Date.parse(item.checked_at)));
  assert.equal(item.pdf_verification_status, pdfinfoAvailable ? 'parser_validated' : 'structure_checked_parser_unavailable');
  assert.equal(item.paper_identity_status, 'unverified');
  assert.deepEqual(await fs.readFile(item.local_pdf_path), validPdf);
  assert.deepEqual(await fs.readdir(dir), [item.filename]);
});

test('valid PDF bytes are accepted despite a non-PDF MIME type', async t => {
  const { item } = await download(t, '/wrong-mime');
  assert.equal(item.download_status, 'downloaded');
  assert.equal(item.content_type, 'application/octet-stream');
});

test('HTML with application/pdf MIME cannot be saved as a PDF', async t => {
  const { item, dir } = await download(t, '/html');
  assert.equal(item.download_status, 'not_pdf');
  assert.equal(item.download_error_code, 'not_pdf');
  assert.equal(item.pdf_verification_status, 'not_pdf');
  assert.equal(item.local_pdf_path, null);
  assert.deepEqual(await fs.readdir(dir), []);
});

for (const route of ['/truncated', '/invalid-xref']) {
  test(`${route} is rejected even when a parser is unavailable`, async t => {
    const { item, dir } = await download(t, route, { pdfinfoPath: '/nonexistent/academic-search-pdfinfo' });
    assert.equal(item.download_status, 'failed');
    assert.equal(item.download_error_code, 'invalid_pdf');
    assert.equal(item.pdf_verification_status, 'invalid_pdf');
    assert.deepEqual(await fs.readdir(dir), []);
  });
}

test('available parser rejects a corrupt PDF page tree and removes temporary file', { skip: !pdfinfoAvailable }, async t => {
  const { item, dir } = await download(t, '/corrupt');
  assert.equal(item.download_status, 'failed');
  assert.equal(item.download_error_code, 'invalid_pdf');
  assert.deepEqual(await fs.readdir(dir), []);
});

test('parser absence gives a limited structural status rather than parser validation', async t => {
  const { item } = await download(t, '/valid', { pdfinfoPath: '/nonexistent/academic-search-pdfinfo' });
  assert.equal(item.download_status, 'downloaded');
  assert.equal(item.pdf_verification_status, 'structure_checked_parser_unavailable');
  assert.equal(item.paper_identity_status, 'unverified');
});

for (const [route, code, status] of [['/404', 'http_error', 404], ['/429', 'rate_limited', 429]]) {
  test(`${status} preserves structured HTTP evidence`, async t => {
    const { item, dir } = await download(t, route);
    assert.equal(item.download_status, 'failed');
    assert.equal(item.download_error_code, code);
    assert.equal(item.http_status, status);
    assert.equal(item.final_url, `${baseUrl}${route}`);
    if (status === 429) assert.equal(item.retry_after, '60');
    assert.deepEqual(await fs.readdir(dir), []);
  });
}

test('body download timeout is bounded and leaves no temporary file', { timeout: 5000 }, async t => {
  const start = Date.now();
  const { item, dir } = await download(t, '/slow', { timeoutMs: 80 });
  assert.equal(item.download_status, 'failed');
  assert.equal(item.download_error_code, 'timeout');
  assert.ok(Date.now() - start < 2000);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('failed validation preserves an existing final PDF without claiming it as new', async t => {
  const dir = await workspace(t);
  const manifest = buildManifest(records('/html'));
  await fs.writeFile(path.join(dir, manifest[0].filename), validPdf);
  await downloadManifest(manifest, dir, { timeoutMs: 1000 });
  assert.equal(manifest[0].local_pdf_path, null);
  assert.deepEqual(await fs.readFile(path.join(dir, manifest[0].filename)), validPdf);
  assert.deepEqual(await fs.readdir(dir), [manifest[0].filename]);
});

test('a dropped HTTP connection reports network_error without leaving a file', async t => {
  const { item, dir } = await download(t, '/disconnect');
  assert.equal(item.download_status, 'failed');
  assert.equal(item.download_error_code, 'network_error');
  assert.deepEqual(await fs.readdir(dir), []);
});

test('retrying an older manifest replaces inferred provider labels before a network failure', async t => {
  const dir = await workspace(t);
  const manifest = buildManifest(records('/disconnect'));
  manifest[0].download_source = 'arxiv';
  await downloadManifest(manifest, dir, { timeoutMs: 1000 });
  assert.equal(manifest[0].download_error_code, 'network_error');
  assert.equal(manifest[0].download_source, '127.0.0.1');
  assert.equal(manifest[0].final_url, null);
});

test('rename failure removes the temporary file and preserves the destination', async t => {
  const dir = await workspace(t);
  const manifest = buildManifest(records('/valid'));
  await fs.mkdir(path.join(dir, manifest[0].filename));
  await downloadManifest(manifest, dir);
  assert.equal(manifest[0].download_status, 'failed');
  assert.equal(manifest[0].download_error_code, 'write_error');
  assert.equal(manifest[0].local_pdf_path, null);
  assert.deepEqual(await fs.readdir(dir), [manifest[0].filename]);
});

test('a stalled parser is killed and never reports parser validation', { timeout: 5000, skip: process.platform === 'win32' }, async t => {
  const fixtureRoot = await workspace(t);
  const stalledParser = path.join(fixtureRoot, 'stalled-parser');
  // A real child process fixture isolates parser execution timeout from HTTP timeout.
  await fs.writeFile(stalledParser, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const started = Date.now();
  const { item, dir } = await download(t, '/valid', { timeoutMs: 100, pdfinfoPath: stalledParser });
  assert.equal(item.download_status, 'failed');
  assert.equal(item.download_error_code, 'pdf_parser_error');
  assert.equal(item.pdf_verification_status, 'unverified');
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('CLI accepts timeout configuration and writes a failure manifest', async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'input.json');
  const manifest = path.join(dir, 'manifest.json');
  await fs.writeFile(input, JSON.stringify(records('/slow')));
  const { stdout } = await exec(process.execPath, [scriptPath, '--input', input, '--manifest', manifest, '--download', '--out-dir', path.join(dir, 'pdfs'), '--timeout-ms', '80'], { timeout: 4000 });
  assert.equal(JSON.parse(stdout).failed, 1);
  assert.equal(JSON.parse(await fs.readFile(manifest, 'utf8'))[0].download_error_code, 'timeout');
});
