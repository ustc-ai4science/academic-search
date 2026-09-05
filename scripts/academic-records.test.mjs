import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  dedupeRecords,
  normalizePmid,
  parseArxivId,
  validateRecords,
} from './academic-records.mjs';

const exec = promisify(execFile);
const scriptPath = fileURLToPath(new URL('./academic-records.mjs', import.meta.url));

function validRecord(overrides = {}) {
  return {
    title: 'A well sourced paper',
    authors: ['Ada Lovelace'],
    year: 2024,
    source_platforms: ['crossref'],
    fetched_at: '2026-09-05',
    citation_count: 12,
    citation_counts: [{
      platform: 'crossref',
      count: 12,
      checked_at: '2026-09-05T01:02:03Z',
      source_url: 'https://api.crossref.org/works/10.1000/example',
    }],
    ...overrides,
  };
}

async function workspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'academic-records-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function runCli(args) {
  try {
    const result = await exec(process.execPath, [scriptPath, ...args]);
    return { ...result, code: 0 };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

test('valid records produce an empty diagnostic report', () => {
  const report = validateRecords([validRecord()]);

  assert.equal(report.valid, true);
  assert.deepEqual(report.records, [{ index: 0, valid: true, errors: [], warnings: [] }]);
  assert.deepEqual(report.summary, {
    total_records: 1,
    valid_records: 1,
    invalid_records: 0,
    errors: 0,
    warnings: 0,
  });
});

test('required keys and basic field types are validated at their source index', () => {
  const report = validateRecords([
    { title: 'Incomplete' },
    validRecord({ title: 17, authors: ['Ada', 42], source_platforms: 'crossref' }),
  ]);

  assert.equal(report.valid, false);
  assert.deepEqual(
    report.records[0].errors.filter(error => error.code === 'missing_required_key').map(error => error.field),
    ['authors', 'year', 'source_platforms', 'fetched_at'],
  );
  assert.deepEqual(
    report.records[1].errors.filter(error => error.code === 'invalid_type').map(error => error.field),
    ['title', 'authors[1]', 'source_platforms'],
  );
  assert.equal(report.records[1].index, 1);
  assert.equal(report.summary.invalid_records, 2);
});

test('invalid DOI, arXiv, PMID, and year values are errors', () => {
  const report = validateRecords([validRecord({
    year: 24,
    doi: 'example-doi',
    arxiv_id: 'not-an-arxiv-id',
    pubmed_id: 'PMID:abc',
  })]);

  assert.deepEqual(
    report.records[0].errors.map(error => [error.code, error.field]),
    [
      ['invalid_year', 'year'],
      ['invalid_doi', 'doi'],
      ['invalid_arxiv_id', 'arxiv_id'],
      ['invalid_pubmed_id', 'pubmed_id'],
    ],
  );
});

test('valid identifier URLs and legacy arXiv versions normalize without errors', () => {
  const report = validateRecords([validRecord({
    doi: 'https://dx.doi.org/10.1000/ABC',
    arxiv_id: 'math.GT/0309136v2',
    pubmed_id: 'https://pubmed.ncbi.nlm.nih.gov/00123/',
  })]);

  assert.deepEqual(report.records[0].errors, []);
});

test('arXiv identifiers reject impossible submission months', () => {
  const report = validateRecords([validRecord({ arxiv_id: '2400.12345v1' })]);

  assert.ok(report.records[0].errors.some(error => error.code === 'invalid_arxiv_id'));
});

test('arXiv parsing rejects v0, zero sequences, and noncanonical arxiv.org paths', () => {
  for (const value of [
    '2401.00001v0',
    '2401.00000',
    'hep-th/9901000',
    'https://arxiv.org/foo/2401001',
    'https://arxiv.org/abs/2401.00001.pdf',
  ]) {
    assert.equal(parseArxivId(value), null, value);
  }

  for (const value of [
    'https://arxiv.org/abs/2401.00001v2',
    'https://arxiv.org/pdf/2401.00001v2',
    'https://arxiv.org/pdf/2401.00001v2.pdf',
    'https://arxiv.org/abs/math.GT/0309136v1',
  ]) {
    assert.ok(parseArxivId(value), value);
  }
});

test('PMID normalization rejects zero and all-zero values', () => {
  for (const value of ['0', '000', 'PMID:000', 'https://pubmed.ncbi.nlm.nih.gov/000/']) {
    assert.equal(normalizePmid(value), null, value);
  }
  assert.equal(normalizePmid('PMID:00123'), '123');
});

test('required source_platforms remains an array even when no source is known', () => {
  const report = validateRecords([validRecord({ source_platforms: null })]);

  assert.ok(report.records[0].errors.some(error => error.code === 'invalid_type' && error.field === 'source_platforms'));
});

test('required fetched_at rejects null instead of treating it as an unknown scalar', () => {
  const report = validateRecords([validRecord({ fetched_at: null })]);

  assert.equal(report.valid, false);
  assert.ok(report.records[0].errors.some(error => error.code === 'invalid_date' && error.field === 'fetched_at'));
});

test('citation count provenance requires complete typed source records', () => {
  const report = validateRecords([validRecord({
    citation_counts: [
      { platform: '', count: -1, checked_at: 'yesterday', source_url: 'not a URL' },
      null,
    ],
  })]);

  const errors = report.records[0].errors;
  assert.ok(errors.some(error => error.code === 'invalid_citation_source' && error.field === 'citation_counts[0].platform'));
  assert.ok(errors.some(error => error.code === 'invalid_citation_source' && error.field === 'citation_counts[0].count'));
  assert.ok(errors.some(error => error.code === 'invalid_citation_source' && error.field === 'citation_counts[0].checked_at'));
  assert.ok(errors.some(error => error.code === 'invalid_citation_source' && error.field === 'citation_counts[0].source_url'));
  assert.ok(errors.some(error => error.code === 'invalid_citation_source' && error.field === 'citation_counts[1]'));
});

test('provenance timestamps require real dates and an explicit timezone', () => {
  const base = { platform: 'crossref', count: 12, source_url: 'https://api.crossref.org/works/example' };
  const report = validateRecords([validRecord({
    citation_counts: [
      { ...base, checked_at: '2026-02-30T00:00:00Z' },
      { ...base, checked_at: '2026-09-05T01:02:03' },
    ],
  })]);

  assert.deepEqual(
    report.records[0].errors.map(error => error.field),
    ['citation_counts[0].checked_at', 'citation_counts[1].checked_at'],
  );
});

test('field provenance requires arrays with supported evidence records', () => {
  const report = validateRecords([validRecord({
    abstract: 'Evidence-sensitive abstract',
    field_sources: {
      abstract: [{
        platform: 'publisher',
        source_url: 'https://example.org/paper',
        checked_at: '2026-09-05T01:02:03Z',
        evidence_type: 'guess',
        note: 17,
      }],
      venue: 'publisher',
    },
  })]);

  const errors = report.records[0].errors;
  assert.ok(errors.some(error => error.code === 'invalid_field_source' && error.field === 'field_sources.abstract[0].evidence_type'));
  assert.ok(errors.some(error => error.code === 'invalid_field_source' && error.field === 'field_sources.abstract[0].note'));
  assert.ok(errors.some(error => error.code === 'invalid_field_sources' && error.field === 'field_sources.venue'));
});

test('inference provenance includes a nonempty note explaining its basis', () => {
  const report = validateRecords([validRecord({
    open_access_status: 'green',
    field_sources: {
      open_access_status: [{
        platform: 'repository-index',
        source_url: 'https://example.org/record',
        checked_at: '2026-09-05T01:02:03Z',
        evidence_type: 'inference',
      }],
    },
  })]);

  assert.ok(report.records[0].errors.some(error => error.code === 'invalid_field_source' && error.field === 'field_sources.open_access_status[0].note'));
});

test('populated evidence-sensitive fields without provenance produce warnings', () => {
  const report = validateRecords([validRecord({
    citation_count: 99,
    citation_counts: [],
    abstract: 'An abstract copied from a result page',
    open_access_status: 'green',
    pdf_url: 'https://example.org/paper.pdf',
    field_sources: {},
  })]);

  assert.equal(report.valid, true);
  assert.deepEqual(
    report.records[0].warnings.map(warning => [warning.code, warning.field]),
    [
      ['missing_citation_provenance', 'citation_count'],
      ['missing_field_provenance', 'abstract'],
      ['missing_field_provenance', 'open_access_status'],
      ['missing_field_provenance', 'pdf_url'],
    ],
  );
});

test('validate CLI accepts a results object, writes the report, then exits 1 on errors', async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'records.json');
  const output = path.join(dir, 'validation.json');
  await fs.writeFile(input, JSON.stringify({ results: [validRecord({ doi: 'invalid' })] }));

  const result = await runCli(['validate', '--input', input, '--output', output]);
  const report = JSON.parse(await fs.readFile(output, 'utf8'));

  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stdout), report.summary);
  assert.equal(report.valid, false);
  assert.equal(report.records[0].errors[0].code, 'invalid_doi');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['records.json', 'validation.json']);
});

test('invalid JSON or arguments never overwrite an existing output file', async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'records.json');
  const output = path.join(dir, 'validation.json');
  await fs.writeFile(input, '{invalid json');
  await fs.writeFile(output, 'keep me');

  const invalidJson = await runCli(['validate', '--input', input, '--output', output]);
  assert.equal(invalidJson.code, 2);
  assert.equal(JSON.parse(invalidJson.stderr).error.code, 'INVALID_JSON');
  assert.equal(await fs.readFile(output, 'utf8'), 'keep me');

  await fs.writeFile(input, JSON.stringify([validRecord()]));
  const invalidArgs = await runCli(['validate', '--input', input, '--output', output, '--unknown']);
  assert.equal(invalidArgs.code, 2);
  assert.equal(JSON.parse(invalidArgs.stderr).error.code, 'INVALID_ARGUMENT');
  assert.equal(await fs.readFile(output, 'utf8'), 'keep me');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['records.json', 'validation.json']);
});

test('INPUT_READ_ERROR is machine-readable and preserves an existing output', async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'missing.json');
  const output = path.join(dir, 'validation.json');
  await fs.writeFile(output, 'keep me');

  const result = await runCli(['validate', '--input', input, '--output', output]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'INPUT_READ_ERROR');
  assert.equal(await fs.readFile(output, 'utf8'), 'keep me');
  assert.deepEqual(await fs.readdir(dir), ['validation.json']);
});

test('INVALID_INPUT is machine-readable and preserves an existing output', async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'records.json');
  const output = path.join(dir, 'validation.json');
  await fs.writeFile(input, JSON.stringify({ results: 'not an array' }));
  await fs.writeFile(output, 'keep me');

  const result = await runCli(['validate', '--input', input, '--output', output]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_INPUT');
  assert.equal(await fs.readFile(output, 'utf8'), 'keep me');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['records.json', 'validation.json']);
});

test('OUTPUT_WRITE_ERROR preserves the target and removes the atomic temp file', {
  skip: process.platform === 'win32' || process.getuid?.() === 0,
}, async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'records.json');
  const protectedDir = path.join(dir, 'protected');
  const output = path.join(protectedDir, 'validation.json');
  await fs.writeFile(input, JSON.stringify([validRecord()]));
  await fs.mkdir(protectedDir);
  await fs.writeFile(output, 'keep me');
  await fs.chmod(protectedDir, 0o555);
  t.after(() => fs.chmod(protectedDir, 0o755).catch(() => {}));

  const result = await runCli(['validate', '--input', input, '--output', output]);
  await fs.chmod(protectedDir, 0o755);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'OUTPUT_WRITE_ERROR');
  assert.equal(await fs.readFile(output, 'utf8'), 'keep me');
  assert.deepEqual(await fs.readdir(protectedDir), ['validation.json']);
});

function record(overrides = {}) {
  return {
    title: 'Connected identifiers',
    authors: ['Ada Lovelace'],
    year: 2024,
    source_platforms: ['crossref'],
    fetched_at: '2026-09-05',
    ...overrides,
  };
}

test('dedupe normalizes exact identifiers and builds transitive groups', () => {
  const output = dedupeRecords([
    record({ doi: ' HTTPS://doi.org/10.1000/Example ', arxiv_id: 'arXiv:2401.00001v2' }),
    record({ doi: 'doi:10.1000/example', source_platforms: ['openalex'] }),
    record({ arxiv_id: 'https://arxiv.org/abs/2401.00001v1', pubmed_id: '000123', source_platforms: ['arxiv'] }),
    record({ pubmed_id: 'PMID:123', source_platforms: ['pubmed'] }),
  ]);

  assert.equal(output.results.length, 1);
  assert.deepEqual(output.results[0].source_indices, [0, 1, 2, 3]);
  assert.deepEqual(output.results[0].source_platforms, ['crossref', 'openalex', 'arxiv', 'pubmed']);
  assert.equal(output.results[0].doi, ' HTTPS://doi.org/10.1000/Example ');
  assert.equal(output.results[0].pubmed_id, '000123');
  assert.deepEqual(output.results[0].arxiv_versions, [
    { source_index: 0, arxiv_id: 'arXiv:2401.00001v2', version: 'v2' },
    { source_index: 2, arxiv_id: 'https://arxiv.org/abs/2401.00001v1', version: 'v1' },
  ]);
  assert.deepEqual(output.groups, [{
    result_index: 0,
    source_indices: [0, 1, 2, 3],
    matched_by: [
      { identifier: 'doi', value: '10.1000/example', source_indices: [0, 1] },
      { identifier: 'arxiv_id', value: '2401.00001', source_indices: [0, 2] },
      { identifier: 'pubmed_id', value: '123', source_indices: [2, 3] },
    ],
    arxiv_versions: output.results[0].arxiv_versions,
  }]);
  assert.deepEqual(output.summary, {
    input_records: 4,
    output_records: 1,
    duplicate_groups: 1,
    merged_records: 3,
    possible_duplicates: 0,
    conflicts: 0,
  });
});

test('dedupe fills missing fields, unions arrays and provenance, and cleans missing_fields', () => {
  const output = dedupeRecords([
    record({
      doi: '10.1000/provenance',
      abstract: null,
      keywords: ['agents'],
      citation_counts: [{ platform: 'openalex', count: 10, checked_at: '2026-09-01T00:00:00Z', source_url: 'https://example.org/openalex' }],
      field_sources: { pdf_url: [{ platform: 'arxiv', source_url: 'https://arxiv.org/abs/2401.00001', checked_at: '2026-09-01T00:00:00Z', evidence_type: 'source_metadata' }] },
      missing_fields: { abstract: 'not returned', venue: 'not returned' },
    }),
    record({
      doi: 'https://doi.org/10.1000/PROVENANCE',
      abstract: 'Now available',
      keywords: ['science', 'agents'],
      citation_counts: [{ platform: 'semantic-scholar', count: 11, checked_at: '2026-09-02T00:00:00Z', source_url: 'https://example.org/s2' }],
      field_sources: { abstract: [{ platform: 'publisher', source_url: 'https://example.org/article', checked_at: '2026-09-02T00:00:00Z', evidence_type: 'page_text' }] },
      missing_fields: { venue: 'publisher omitted it' },
    }),
  ]);

  const [merged] = output.results;
  assert.equal(merged.abstract, 'Now available');
  assert.deepEqual(merged.keywords, ['agents', 'science']);
  assert.equal(merged.citation_counts.length, 2);
  assert.deepEqual(Object.keys(merged.field_sources), ['pdf_url', 'abstract']);
  assert.equal(merged.field_sources.pdf_url.length, 1);
  assert.equal(merged.field_sources.abstract.length, 1);
  assert.deepEqual(merged.missing_fields, { venue: 'not returned' });
});

test('array and provenance unions remove duplicates already present in one source', () => {
  const citation = { platform: 'openalex', count: 10, checked_at: '2026-09-01T00:00:00Z', source_url: 'https://example.org/openalex' };
  const provenance = { platform: 'publisher', source_url: 'https://example.org/article', checked_at: '2026-09-01T00:00:00Z', evidence_type: 'page_text' };
  const output = dedupeRecords([record({
    keywords: ['agents', 'agents'],
    citation_counts: [citation, citation],
    field_sources: { abstract: [provenance, provenance] },
  })]);

  assert.deepEqual(output.results[0].keywords, ['agents']);
  assert.deepEqual(output.results[0].citation_counts, [citation]);
  assert.deepEqual(output.results[0].field_sources.abstract, [provenance]);
});

test('arrays filled from a later duplicate source are normalized the same way', () => {
  const citation = { platform: 'openalex', count: 10, checked_at: '2026-09-01T00:00:00Z', source_url: 'https://example.org/openalex' };
  const provenance = { platform: 'publisher', source_url: 'https://example.org/article', checked_at: '2026-09-01T00:00:00Z', evidence_type: 'page_text' };
  const output = dedupeRecords([
    record({ doi: '10.1000/later-arrays', keywords: null, citation_counts: null, field_sources: null }),
    record({
      doi: '10.1000/later-arrays',
      keywords: ['agents', 'agents'],
      citation_counts: [citation, citation],
      field_sources: { abstract: [provenance, provenance] },
    }),
  ]);

  assert.deepEqual(output.results[0].keywords, ['agents']);
  assert.deepEqual(output.results[0].citation_counts, [citation]);
  assert.deepEqual(output.results[0].field_sources.abstract, [provenance]);
});

test('dedupe keeps the first populated scalar and reports every conflicting value with sources', () => {
  const output = dedupeRecords([
    record({ doi: '10.1000/conflict', title: 'First title', year: 2023, abstract: 'First abstract' }),
    record({ doi: '10.1000/conflict', title: 'Second title', year: 2024, abstract: 'Second abstract' }),
    record({ doi: '10.1000/conflict', title: 'Second title', year: 2024, abstract: 'Third abstract' }),
  ]);

  assert.equal(output.results[0].title, 'First title');
  assert.equal(output.results[0].year, 2023);
  assert.equal(output.results[0].abstract, 'First abstract');
  assert.deepEqual(output.conflicts.map(conflict => conflict.field), ['title', 'year', 'abstract']);
  const abstractConflict = output.conflicts.find(conflict => conflict.field === 'abstract');
  assert.deepEqual(abstractConflict.values, [
    { value: 'First abstract', source_indices: [0] },
    { value: 'Second abstract', source_indices: [1] },
    { value: 'Third abstract', source_indices: [2] },
  ]);
  assert.equal(abstractConflict.kept_value, 'First abstract');
  assert.deepEqual(abstractConflict.source_indices, [0, 1, 2]);
  assert.equal(output.summary.conflicts, 3);
});

test('stable output ordering follows first source appearance', () => {
  const output = dedupeRecords([
    record({ title: 'Earlier singleton', doi: '10.1000/one' }),
    record({ title: 'Later group', doi: '10.1000/two' }),
    record({ title: 'Last singleton', doi: '10.1000/three' }),
    record({ title: 'Later group', doi: 'https://doi.org/10.1000/TWO' }),
  ]);

  assert.deepEqual(output.results.map(result => result.source_indices), [[0], [1, 3], [2]]);
  assert.deepEqual(output.results.map(result => result.title), ['Earlier singleton', 'Later group', 'Last singleton']);
  assert.equal(output.groups[0].result_index, 1);
});

test('normalized equal titles remain separate possible duplicates without an exact shared identifier', () => {
  const output = dedupeRecords([
    record({ title: 'The Same: Title!', doi: '10.1000/a' }),
    record({ title: '  the same title  ', doi: '10.1000/b' }),
  ]);

  assert.equal(output.results.length, 2);
  assert.deepEqual(output.groups, []);
  assert.deepEqual(output.possible_duplicates, [{
    reason: 'normalized_title',
    normalized_title: 'the same title',
    result_indices: [0, 1],
    source_indices: [[0], [1]],
    titles: ['The Same: Title!', '  the same title  '],
  }]);
  assert.equal(output.summary.possible_duplicates, 1);
});

test('possible duplicates consider aliases from every record in each exact-ID component', () => {
  const output = dedupeRecords([
    record({ title: 'Canonical title', doi: '10.1000/component-x' }),
    record({ title: 'Shared Alias', doi: '10.1000/component-x' }),
    record({ title: ' shared alias! ', doi: '10.1000/component-y' }),
  ]);

  assert.equal(output.results.length, 2);
  assert.deepEqual(output.possible_duplicates, [{
    reason: 'normalized_title',
    normalized_title: 'shared alias',
    result_indices: [0, 1],
    source_indices: [[1], [2]],
    titles: ['Shared Alias', ' shared alias! '],
  }]);
});

test('possible duplicates keep one representative title and every matching source index per result', () => {
  const output = dedupeRecords([
    record({ title: 'Shared Alias', doi: '10.1000/title-variants-x' }),
    record({ title: ' shared alias! ', doi: '10.1000/title-variants-x' }),
    record({ title: 'SHARED ALIAS', doi: '10.1000/title-variants-y' }),
  ]);

  assert.deepEqual(output.possible_duplicates, [{
    reason: 'normalized_title',
    normalized_title: 'shared alias',
    result_indices: [0, 1],
    source_indices: [[0, 1], [2]],
    titles: ['Shared Alias', 'SHARED ALIAS'],
  }]);
});

test('invalid or absent identifiers never create an exact duplicate group', () => {
  const output = dedupeRecords([
    record({ title: 'One', doi: 'not-a-doi' }),
    record({ title: 'Two', doi: 'not-a-doi' }),
    record({ title: 'Three' }),
    record({ title: 'Four' }),
  ]);

  assert.equal(output.results.length, 4);
  assert.deepEqual(output.groups, []);
  assert.deepEqual(output.possible_duplicates, []);
});

test('invalid arXiv and PMID lookalikes never form exact duplicate groups', () => {
  const output = dedupeRecords([
    record({ title: 'v0 one', arxiv_id: '2401.00001v0' }),
    record({ title: 'v0 two', arxiv_id: '2401.00001v0' }),
    record({ title: 'zero PMID one', pubmed_id: '000' }),
    record({ title: 'zero PMID two', pubmed_id: 'PMID:0' }),
    record({ title: 'wrong path one', arxiv_id: 'https://arxiv.org/foo/2401001' }),
    record({ title: 'wrong path two', arxiv_id: 'https://arxiv.org/foo/2401001' }),
    record({ title: 'zero sequence one', arxiv_id: '2401.00000' }),
    record({ title: 'zero sequence two', arxiv_id: '2401.00000' }),
  ]);

  assert.equal(output.results.length, 8);
  assert.deepEqual(output.groups, []);
});

test('dedupe CLI accepts an array and writes machine-readable output and summary', async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'records.json');
  const output = path.join(dir, 'deduplicated.json');
  await fs.writeFile(input, JSON.stringify([
    record({ doi: '10.1000/cli' }),
    record({ doi: 'https://doi.org/10.1000/CLI' }),
  ]));

  const result = await runCli(['dedupe', '--input', input, '--output', output]);
  const deduplicated = JSON.parse(await fs.readFile(output, 'utf8'));

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), deduplicated.summary);
  assert.equal(deduplicated.results.length, 1);
  assert.deepEqual(deduplicated.results[0].source_indices, [0, 1]);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['deduplicated.json', 'records.json']);
});

test('dedupe CLI is idempotent when its complete output is used as the next results input', async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'records.json');
  const firstOutput = path.join(dir, 'first.json');
  const secondOutput = path.join(dir, 'second.json');
  await fs.writeFile(input, JSON.stringify([
    record({ title: 'Repeated Title', year: 2023, doi: '10.1000/repeat-x', arxiv_id: '2401.00001v2' }),
    record({ title: 'Conflicting Alias', year: 2024, doi: '10.1000/repeat-x' }),
    record({ title: 'repeated title!', year: 2023, doi: '10.1000/repeat-y' }),
  ]));

  const firstRun = await runCli(['dedupe', '--input', input, '--output', firstOutput]);
  const secondRun = await runCli(['dedupe', '--input', firstOutput, '--output', secondOutput]);
  const first = JSON.parse(await fs.readFile(firstOutput, 'utf8'));
  const second = JSON.parse(await fs.readFile(secondOutput, 'utf8'));

  assert.equal(firstRun.code, 0);
  assert.equal(secondRun.code, 0);
  assert.ok(first.groups.length > 0);
  assert.ok(first.conflicts.length > 0);
  assert.ok(first.possible_duplicates.length > 0);
  assert.deepEqual(first.results[0].source_indices, [0, 1]);
  assert.deepEqual(first.results[0].arxiv_versions, [
    { source_index: 0, arxiv_id: '2401.00001v2', version: 'v2' },
  ]);
  assert.deepEqual(second, first);
  assert.deepEqual(JSON.parse(secondRun.stdout), first.summary);
});

test('dedupe CLI rejects an incomplete prior-output envelope instead of dropping lineage', async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'incomplete.json');
  const output = path.join(dir, 'deduplicated.json');
  await fs.writeFile(input, JSON.stringify({
    results: [record({ doi: '10.1000/prior', source_indices: [4, 9] })],
  }));
  await fs.writeFile(output, 'keep me');

  const result = await runCli(['dedupe', '--input', input, '--output', output]);

  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_INPUT');
  assert.equal(await fs.readFile(output, 'utf8'), 'keep me');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['deduplicated.json', 'incomplete.json']);
});

async function assertEnvelopeRejected(t, envelope) {
  const dir = await workspace(t);
  const input = path.join(dir, 'prior.json');
  const output = path.join(dir, 'deduplicated.json');
  await fs.writeFile(input, JSON.stringify(envelope));
  await fs.writeFile(output, 'keep me');

  const result = await runCli(['dedupe', '--input', input, '--output', output]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_INPUT');
  assert.equal(await fs.readFile(output, 'utf8'), 'keep me');
}

test('dedupe CLI rejects a merged result whose complete-looking envelope omits its group', async t => {
  const envelope = dedupeRecords([
    record({ doi: '10.1000/missing-group' }),
    record({ doi: 'https://doi.org/10.1000/MISSING-GROUP' }),
  ]);
  envelope.groups = [];
  envelope.summary.duplicate_groups = 0;

  await assertEnvelopeRejected(t, envelope);
});

test('dedupe CLI checks group uniqueness, lineage, and arXiv version consistency', async t => {
  const singletonWithGroup = dedupeRecords([record({ doi: '10.1000/singleton' })]);
  singletonWithGroup.groups = [{
    result_index: 0,
    source_indices: [0],
    matched_by: [],
    arxiv_versions: [],
  }];
  singletonWithGroup.summary.duplicate_groups = 1;

  const reversedLineage = dedupeRecords([
    record({ doi: '10.1000/reversed' }),
    record({ doi: '10.1000/reversed' }),
  ]);
  reversedLineage.groups[0].source_indices = [1, 0];

  const duplicateGroup = dedupeRecords([
    record({ doi: '10.1000/duplicate-group' }),
    record({ doi: '10.1000/duplicate-group' }),
  ]);
  duplicateGroup.groups.push(structuredClone(duplicateGroup.groups[0]));
  duplicateGroup.summary.duplicate_groups = 2;

  const mismatchedVersions = dedupeRecords([
    record({ doi: '10.1000/version-group', arxiv_id: '2401.00001v2' }),
    record({ doi: '10.1000/version-group' }),
  ]);
  mismatchedVersions.groups[0].arxiv_versions = [];

  const nullResultVersions = dedupeRecords([record({ doi: '10.1000/null-versions' })]);
  nullResultVersions.results[0].arxiv_versions = null;

  const cases = [
    ['singleton group', singletonWithGroup],
    ['reversed source lineage', reversedLineage],
    ['duplicate result_index', duplicateGroup],
    ['mismatched arxiv_versions', mismatchedVersions],
    ['null result arxiv_versions', nullResultVersions],
  ];
  await Promise.all(cases.map(([name, envelope]) => t.test(name, child => (
    assertEnvelopeRejected(child, envelope)
  ))));
});

test('dedupe CLI rejects dangling possible-duplicate and conflict references', async t => {
  const danglingPossibleResult = dedupeRecords([
    record({ title: 'Same title', doi: '10.1000/possible-a' }),
    record({ title: 'same title!', doi: '10.1000/possible-b' }),
  ]);
  danglingPossibleResult.possible_duplicates[0].result_indices[1] = 2;

  const misplacedPossibleSource = dedupeRecords([
    record({ title: 'Same title', doi: '10.1000/source-a' }),
    record({ title: 'same title!', doi: '10.1000/source-b' }),
  ]);
  misplacedPossibleSource.possible_duplicates[0].source_indices[0] = [1];

  const danglingConflictResult = dedupeRecords([
    record({ year: 2023, doi: '10.1000/conflict-ref' }),
    record({ year: 2024, doi: '10.1000/conflict-ref' }),
  ]);
  danglingConflictResult.conflicts[0].result_index = 1;

  const misplacedConflictSource = dedupeRecords([
    record({ year: 2023, doi: '10.1000/conflict-source' }),
    record({ year: 2024, doi: '10.1000/conflict-source' }),
  ]);
  misplacedConflictSource.conflicts[0].source_indices = [0, 2];

  const cases = [
    ['dangling possible result', danglingPossibleResult],
    ['misplaced possible source', misplacedPossibleSource],
    ['dangling conflict result', danglingConflictResult],
    ['misplaced conflict source', misplacedConflictSource],
  ];
  await Promise.all(cases.map(([name, envelope]) => t.test(name, child => (
    assertEnvelopeRejected(child, envelope)
  ))));
});

test('dedupe CLI rejects erased provenance for an observable versioned arXiv value', async t => {
  const envelope = dedupeRecords([
    record({ doi: '10.1000/version-evidence', arxiv_id: '2401.00001v2' }),
    record({ doi: '10.1000/version-evidence' }),
  ]);
  delete envelope.results[0].arxiv_versions;
  envelope.groups[0].arxiv_versions = [];

  await assertEnvelopeRejected(t, envelope);
});

test('dedupe CLI rejects matched_by values without observable identifier evidence', async t => {
  const fakeDoi = dedupeRecords([
    record({ doi: '10.1000/observed-doi' }),
    record({ doi: '10.1000/observed-doi' }),
  ]);
  fakeDoi.groups[0].matched_by[0].value = '10.1000/fake-doi';

  const fakePmid = dedupeRecords([
    record({ doi: '10.1000/observed-field' }),
    record({ doi: '10.1000/observed-field' }),
  ]);
  fakePmid.groups[0].matched_by = [{
    identifier: 'pubmed_id',
    value: '123456',
    source_indices: [0, 1],
  }];

  const cases = [
    ['fake DOI', fakeDoi],
    ['unsupported PMID', fakePmid],
  ];
  await Promise.all(cases.map(([name, envelope]) => t.test(name, child => (
    assertEnvelopeRejected(child, envelope)
  ))));
});

test('dedupe CLI checks matched_by sources against identifier conflict evidence', async t => {
  const envelope = dedupeRecords([
    record({ doi: '10.1000/evidence-a', arxiv_id: '2401.00002' }),
    record({ doi: '10.1000/evidence-a' }),
    record({ doi: '10.1000/evidence-b', arxiv_id: '2401.00002' }),
  ]);
  const doiMatch = envelope.groups[0].matched_by.find(match => match.identifier === 'doi');
  doiMatch.source_indices = [1, 2];

  await assertEnvelopeRejected(t, envelope);
});

test('dedupe CLI accepts conflict-backed matches with versioned and unversioned arXiv aliases', async t => {
  const dir = await workspace(t);
  const input = path.join(dir, 'prior.json');
  const output = path.join(dir, 'deduplicated.json');
  const envelope = dedupeRecords([
    record({ doi: '10.1000/evidence-a', arxiv_id: '2401.00003v1' }),
    record({ doi: '10.1000/evidence-a', arxiv_id: '2401.00003', pubmed_id: '123456' }),
    record({ doi: '10.1000/evidence-b', arxiv_id: '2402.00004v3', pubmed_id: '123456' }),
  ]);
  await fs.writeFile(input, JSON.stringify(envelope));

  const result = await runCli(['dedupe', '--input', input, '--output', output]);

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), envelope);
});
