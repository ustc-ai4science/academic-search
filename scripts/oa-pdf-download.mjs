#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;

function evidenceDefaults() {
  return {
    final_url: null,
    content_type: null,
    checked_at: null,
    byte_length: null,
    sha256: null,
    http_status: null,
    retry_after: null,
    download_error_code: null,
    pdf_verification_status: 'unverified',
    paper_identity_status: 'unverified',
  };
}

function positiveTimeout(value) {
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
    throw new Error('timeout-ms must be a positive integer no larger than 2147483647');
  }
  return timeout;
}

function parseArgs(argv) {
  const args = {
    input: '',
    manifest: '',
    outDir: '',
    download: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pdfinfoPath: 'pdfinfo',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--download') {
      args.download = true;
    } else if (arg === '--input') {
      args.input = argv[++i] || '';
    } else if (arg === '--manifest') {
      args.manifest = argv[++i] || '';
    } else if (arg === '--out-dir') {
      args.outDir = argv[++i] || '';
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = positiveTimeout(argv[++i]);
    } else if (arg === '--pdfinfo-path') {
      args.pdfinfoPath = argv[++i] || '';
      if (!args.pdfinfoPath) throw new Error('Missing value for --pdfinfo-path');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.input) throw new Error('Missing required argument: --input');
  if (!args.manifest) throw new Error('Missing required argument: --manifest');
  if (args.download && !args.outDir) {
    throw new Error('Missing required argument when --download is set: --out-dir');
  }

  return args;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.results)) return value.results;
  throw new Error('Input JSON must be an array or an object with a results array');
}

function sourceFromUrl(url) {
  try {
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

function skipReason(record) {
  if (record.full_text_status !== 'open_pdf') {
    return `full_text_status=${record.full_text_status || 'unknown'}`;
  }
  if (!record.pdf_url) {
    return 'missing pdf_url';
  }
  if (!/^https?:\/\//i.test(record.pdf_url)) {
    return 'pdf_url must be http(s)';
  }
  return '';
}

function makeId(record, index) {
  const raw = record.doi || record.arxiv_id || `${record.title || 'paper'}-${index}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

function safePart(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'paper';
}

function filenameFor(record, index) {
  const year = record.year ? String(record.year) : '';
  const title = safePart(record.title || record.doi || record.arxiv_id || `paper_${index + 1}`);
  const id = makeId(record, index);
  return [year, title, id].filter(Boolean).join('_') + '.pdf';
}

export function buildManifest(records) {
  return records.map((record, index) => {
    const reason = skipReason(record);
    const eligible = !reason;

    return {
      index: index + 1,
      title: record.title || '',
      authors: Array.isArray(record.authors) ? record.authors : [],
      year: record.year || null,
      doi: record.doi || null,
      arxiv_id: record.arxiv_id || null,
      pdf_url: record.pdf_url || null,
      full_text_status: record.full_text_status || 'unknown',
      source_platforms: Array.isArray(record.source_platforms) ? record.source_platforms : [],
      field_sources: record.field_sources ?? {},
      download_source: eligible ? sourceFromUrl(record.pdf_url) : null,
      download_status: eligible ? 'eligible' : 'skipped',
      download_error: eligible ? null : reason,
      local_pdf_path: null,
      filename: eligible ? filenameFor(record, index) : null,
      ...evidenceDefaults(),
    };
  });
}

function countStatuses(manifest) {
  const counts = {
    total: manifest.length,
    eligible: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    not_pdf: 0,
  };

  for (const item of manifest) {
    if (item.download_status === 'eligible') counts.eligible += 1;
    if (item.download_status === 'downloaded') counts.downloaded += 1;
    if (item.download_status === 'skipped') counts.skipped += 1;
    if (item.download_status === 'failed') counts.failed += 1;
    if (item.download_status === 'not_pdf') counts.not_pdf += 1;
  }

  return counts;
}

function downloadError(code, message) {
  return Object.assign(new Error(message), { downloadCode: code });
}

// These checks detect obvious truncation and malformed cross-reference pointers.
// They deliberately do not claim complete PDF validity or paper identity.
function checkPdfStructure(buffer) {
  const text = buffer.toString('latin1');
  if (!text.startsWith('%PDF-')) {
    throw downloadError('not_pdf', 'Response bytes do not begin with a PDF signature');
  }
  if (!/^%PDF-\d\.\d(?:\r\n|\r|\n)/.test(text)) {
    throw downloadError('invalid_pdf', 'Invalid PDF version header');
  }
  const ending = /startxref\s+(\d+)\s+%%EOF[\x00\t\n\f\r ]*$/.exec(text);
  if (!ending) throw downloadError('invalid_pdf', 'Missing final PDF startxref/EOF structure; file may be truncated');
  const offset = Number(ending[1]);
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= ending.index) {
    throw downloadError('invalid_pdf', 'PDF startxref offset is outside the file structure');
  }
  const xref = text.slice(offset, ending.index);
  const classicXref = /^xref\s+\d+\s+\d+\s+\d{10}\s+\d{5}\s+[nf]\b/.test(xref)
    && /\btrailer\s*<<[\s\S]*\/Size\s+\d+\b/.test(xref);
  const streamXref = /^\d+\s+\d+\s+obj\s*<<[\s\S]*?\/Type\s*\/XRef\b[\s\S]*?\bstream(?:\r\n|\r|\n)/.test(xref)
    && /\bendstream\s+endobj\b/.test(xref);
  if (!classicXref && !streamXref) {
    throw downloadError('invalid_pdf', 'PDF startxref does not identify a cross-reference table or stream');
  }
}

async function fetchPdf(item, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(item.pdf_url, {
      redirect: 'follow',
      signal,
      headers: {
        'user-agent': 'academic-search-oa-pdf-download/1.3',
        accept: 'application/pdf,*/*;q=0.8',
      },
    });
    item.final_url = response.url;
    item.download_source = sourceFromUrl(response.url);
    item.content_type = response.headers.get('content-type');
    item.http_status = response.status;
    item.retry_after = response.headers.get('retry-after');
    if (!response.ok) {
      await response.body?.cancel();
      throw downloadError(response.status === 429 ? 'rate_limited' : 'http_error', `HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    item.byte_length = buffer.length;
    item.sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    checkPdfStructure(buffer);
    return buffer;
  } catch (error) {
    if (error.downloadCode) throw error;
    if (signal.aborted) throw downloadError('timeout', `PDF download exceeded ${timeoutMs} ms`);
    throw downloadError('network_error', error.message);
  }
}

async function checkWithParser(filePath, pdfinfoPath, timeoutMs) {
  try {
    const { stdout, stderr } = await exec(pdfinfoPath, [filePath], {
      timeout: Math.min(timeoutMs, 5000),
      killSignal: 'SIGKILL',
      maxBuffer: 256 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    });
    if (!/^Pages:\s+[1-9]\d*\s*$/m.test(stdout) || /(?:Syntax (?:Error|Warning)|Internal Error):/i.test(stderr)) {
      throw downloadError('invalid_pdf', `PDF parser rejected document structure: ${stderr.trim() || 'no readable pages'}`);
    }
    return 'parser_validated';
  } catch (error) {
    if (error.downloadCode) throw error;
    if (error.code === 'ENOENT') return 'structure_checked_parser_unavailable';
    if (typeof error.code === 'number' && !/incorrect password|permission denied/i.test(error.stderr || '')) {
      throw downloadError('invalid_pdf', `PDF parser rejected document: ${(error.stderr || error.message).trim().slice(0, 1000)}`);
    }
    throw downloadError('pdf_parser_error', `PDF parser could not complete: ${error.killed ? 'validation timed out' : error.message}`);
  }
}

export async function downloadManifest(manifest, outDir, options = {}) {
  const timeoutMs = positiveTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pdfinfoPath = options.pdfinfoPath ?? 'pdfinfo';
  await fs.mkdir(outDir, { recursive: true });

  for (const item of manifest) {
    if (item.download_status !== 'eligible') continue;

    Object.assign(item, evidenceDefaults(), {
      checked_at: new Date().toISOString(),
      download_source: sourceFromUrl(item.pdf_url),
    });
    const outputPath = path.resolve(outDir, item.filename);
    const partPath = `${outputPath}.${crypto.randomUUID()}.part`;

    try {
      const pdf = await fetchPdf(item, timeoutMs);
      await fs.writeFile(partPath, pdf, { flag: 'wx' });
      item.pdf_verification_status = await checkWithParser(partPath, pdfinfoPath, timeoutMs);
      await fs.rename(partPath, outputPath);
      item.download_status = 'downloaded';
      item.download_error = null;
      item.local_pdf_path = outputPath;
    } catch (error) {
      await fs.rm(partPath, { force: true }).catch(() => {});
      item.download_error_code = error.downloadCode || 'write_error';
      item.download_status = item.download_error_code === 'not_pdf' ? 'not_pdf' : 'failed';
      item.download_error = error.message;
      item.local_pdf_path = null;
      if (['not_pdf', 'invalid_pdf'].includes(item.download_error_code)) {
        item.pdf_verification_status = item.download_error_code;
      }
    }
  }

  return manifest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputText = await fs.readFile(args.input, 'utf8');
  const records = ensureArray(JSON.parse(inputText));
  let manifest = buildManifest(records);

  if (args.download) {
    manifest = await downloadManifest(manifest, args.outDir, args);
  }

  await fs.mkdir(path.dirname(args.manifest), { recursive: true });
  await fs.writeFile(args.manifest, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(countStatuses(manifest)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}
