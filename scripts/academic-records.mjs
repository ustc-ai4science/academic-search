#!/usr/bin/env node
import crypto from 'node:crypto';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_KEYS = ['title', 'authors', 'year', 'source_platforms', 'fetched_at'];
const STRING_FIELDS = [
  'title', 'publication_date', 'publication_type', 'venue', 'doi', 'arxiv_id',
  'pubmed_id', 'pmcid', 'issn', 'isbn', 'cnki_url', 'abstract', 'study_type',
  'population', 'open_access_status', 'license', 'full_text_status', 'pdf_url',
  'local_pdf_path', 'download_status', 'download_error', 'download_source',
  'final_url', 'content_type', 'checked_at', 'sha256', 'retry_after',
  'download_error_code', 'pdf_verification_status', 'paper_identity_status',
  'data_availability', 'code_url', 'bibtex', 'fetched_at',
];
const STRING_ARRAY_FIELDS = [
  'authors', 'orcid', 'keywords', 'mesh_terms', 'jel_codes', 'msc_codes',
  'acm_ccs', 'source_platforms',
];
const NONNEGATIVE_INTEGER_FIELDS = [
  'sample_size', 'citation_count', 'download_count', 'byte_length', 'http_status',
];
const EVIDENCE_TYPES = new Set([
  'source_metadata', 'page_text', 'pdf_text', 'download_response', 'inference',
]);
const EVIDENCE_SENSITIVE_FIELDS = [
  'abstract', 'publication_date', 'publication_type', 'venue', 'open_access_status',
  'license', 'full_text_status', 'pdf_url', 'download_count', 'study_type',
  'sample_size', 'population', 'keywords', 'mesh_terms', 'jel_codes', 'msc_codes',
  'acm_ccs', 'data_availability', 'code_url',
];

function diagnostic(code, field, message) {
  return { code, field, message };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMissing(value) {
  return value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && isIsoDate(value.slice(0, 10))
    && !Number.isNaN(Date.parse(value));
}

function stripIdentifierUrl(value, hostnames, prefix) {
  const text = value.trim();
  try {
    const url = new URL(text);
    const acceptedHosts = Array.isArray(hostnames) ? hostnames : [hostnames];
    if (acceptedHosts.includes(url.hostname.toLowerCase())) {
      return decodeURIComponent(url.pathname.replace(prefix, '').replace(/^\/+/, ''));
    }
  } catch {}
  return text;
}

export function normalizeDoi(value) {
  if (typeof value !== 'string') return null;
  let normalized = stripIdentifierUrl(value, ['doi.org', 'dx.doi.org', 'www.doi.org'], /^\/+?/);
  normalized = normalized.replace(/^doi\s*:\s*/i, '').trim().toLowerCase();
  return /^10\.\d{4,9}\/[^\s]+$/i.test(normalized) ? normalized : null;
}

export function parseArxivId(value) {
  if (typeof value !== 'string') return null;
  let normalized = value.trim();
  if (/^https?:\/\//i.test(normalized)) {
    let url;
    try {
      url = new URL(normalized);
    } catch {
      return null;
    }
    if (url.hostname.toLowerCase() !== 'arxiv.org') return null;
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
    if (pathname.startsWith('/abs/')) {
      normalized = pathname.slice('/abs/'.length);
      if (normalized.toLowerCase().endsWith('.pdf')) return null;
    } else if (pathname.startsWith('/pdf/')) {
      normalized = pathname.slice('/pdf/'.length);
      if (normalized.toLowerCase().endsWith('.pdf')) normalized = normalized.slice(0, -4);
    } else {
      return null;
    }
  } else {
    normalized = normalized.replace(/^arxiv\s*:\s*/i, '');
  }
  normalized = normalized.trim();
  const match = /^(\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{2}(?:0[1-9]|1[0-2])\d{3})(v[1-9]\d*)?$/i.exec(normalized);
  if (!match) return null;
  const sequence = match[1].includes('.') ? match[1].split('.').at(-1) : match[1].slice(-3);
  if (/^0+$/.test(sequence)) return null;
  return {
    base: match[1].toLowerCase(),
    version: match[2]?.toLowerCase() ?? null,
    normalized: `${match[1].toLowerCase()}${match[2]?.toLowerCase() ?? ''}`,
  };
}

export function normalizePmid(value) {
  if (typeof value !== 'string') return null;
  let normalized = stripIdentifierUrl(value, 'pubmed.ncbi.nlm.nih.gov', /^\/+?/);
  normalized = normalized.replace(/^pmid\s*:\s*/i, '').replace(/\/+$/, '').trim();
  if (!/^\d{1,9}$/.test(normalized)) return null;
  if (/^0+$/.test(normalized)) return null;
  return normalized.replace(/^0+(?=\d)/, '');
}

function addTypeErrors(record, errors) {
  for (const field of STRING_FIELDS) {
    const value = record[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push(diagnostic('invalid_type', field, `${field} must be a string or null`));
    }
  }

  for (const field of STRING_ARRAY_FIELDS) {
    const value = record[field];
    if (value === undefined) continue;
    if (value === null) {
      if (field === 'source_platforms') {
        errors.push(diagnostic('invalid_type', field, `${field} must be an array of strings`));
      }
      continue;
    }
    if (!Array.isArray(value)) {
      errors.push(diagnostic('invalid_type', field, `${field} must be an array of strings or null`));
      continue;
    }
    value.forEach((item, index) => {
      if (typeof item !== 'string') {
        errors.push(diagnostic('invalid_type', `${field}[${index}]`, `${field}[${index}] must be a string`));
      }
    });
  }

  for (const field of NONNEGATIVE_INTEGER_FIELDS) {
    const value = record[field];
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      errors.push(diagnostic('invalid_type', field, `${field} must be a nonnegative integer or null`));
    }
  }

  if (record.year !== undefined && record.year !== null
      && (!Number.isInteger(record.year) || record.year < 1000 || record.year > 9999)) {
    errors.push(diagnostic('invalid_year', 'year', 'year must be a four-digit integer or null'));
  }

  if (record.publication_date !== undefined && record.publication_date !== null
      && typeof record.publication_date === 'string' && !isIsoDate(record.publication_date)) {
    errors.push(diagnostic('invalid_date', 'publication_date', 'publication_date must be an ISO date (YYYY-MM-DD)'));
  }
  if (Object.hasOwn(record, 'fetched_at')
      && (record.fetched_at === null
        || record.fetched_at === undefined
        || (typeof record.fetched_at === 'string' && !isIsoDate(record.fetched_at)))) {
    errors.push(diagnostic('invalid_date', 'fetched_at', 'fetched_at must be a nonempty ISO date (YYYY-MM-DD)'));
  }
  if (record.checked_at !== undefined && record.checked_at !== null
      && typeof record.checked_at === 'string' && !isIsoTimestamp(record.checked_at)) {
    errors.push(diagnostic('invalid_timestamp', 'checked_at', 'checked_at must be an ISO timestamp'));
  }

  if (record.missing_fields !== undefined && record.missing_fields !== null) {
    if (!isObject(record.missing_fields)) {
      errors.push(diagnostic('invalid_type', 'missing_fields', 'missing_fields must be an object or null'));
    } else {
      for (const [field, reason] of Object.entries(record.missing_fields)) {
        if (typeof reason !== 'string' || reason.trim() === '') {
          errors.push(diagnostic('invalid_type', `missing_fields.${field}`, 'missing field reasons must be nonempty strings'));
        }
      }
    }
  }
}

function addIdentifierErrors(record, errors) {
  if (!isMissing(record.doi) && typeof record.doi === 'string' && !normalizeDoi(record.doi)) {
    errors.push(diagnostic('invalid_doi', 'doi', 'doi must be a valid DOI or DOI URL'));
  }
  if (!isMissing(record.arxiv_id) && typeof record.arxiv_id === 'string' && !parseArxivId(record.arxiv_id)) {
    errors.push(diagnostic('invalid_arxiv_id', 'arxiv_id', 'arxiv_id must be a modern or legacy arXiv identifier'));
  }
  if (!isMissing(record.pubmed_id) && typeof record.pubmed_id === 'string' && !normalizePmid(record.pubmed_id)) {
    errors.push(diagnostic('invalid_pubmed_id', 'pubmed_id', 'pubmed_id must be a PMID or PubMed URL'));
  }
}

function validateCitationSources(record, errors) {
  if (record.citation_counts === undefined || record.citation_counts === null) return [];
  if (!Array.isArray(record.citation_counts)) {
    errors.push(diagnostic('invalid_type', 'citation_counts', 'citation_counts must be an array or null'));
    return [];
  }

  const validSources = [];
  record.citation_counts.forEach((source, index) => {
    const base = `citation_counts[${index}]`;
    if (!isObject(source)) {
      errors.push(diagnostic('invalid_citation_source', base, 'citation source must be an object'));
      return;
    }
    let valid = true;
    if (typeof source.platform !== 'string' || source.platform.trim() === '') {
      errors.push(diagnostic('invalid_citation_source', `${base}.platform`, 'platform must be a nonempty string'));
      valid = false;
    }
    if (!Number.isSafeInteger(source.count) || source.count < 0) {
      errors.push(diagnostic('invalid_citation_source', `${base}.count`, 'count must be a nonnegative integer'));
      valid = false;
    }
    if (!isIsoTimestamp(source.checked_at)) {
      errors.push(diagnostic('invalid_citation_source', `${base}.checked_at`, 'checked_at must be an ISO timestamp'));
      valid = false;
    }
    if (!isHttpUrl(source.source_url)) {
      errors.push(diagnostic('invalid_citation_source', `${base}.source_url`, 'source_url must be an HTTP(S) URL'));
      valid = false;
    }
    if (valid) validSources.push(source);
  });
  return validSources;
}

function validateFieldSources(record, errors) {
  const fieldsWithValidSources = new Set();
  if (record.field_sources === undefined || record.field_sources === null) return fieldsWithValidSources;
  if (!isObject(record.field_sources)) {
    errors.push(diagnostic('invalid_field_sources', 'field_sources', 'field_sources must be an object or null'));
    return fieldsWithValidSources;
  }

  for (const [field, sources] of Object.entries(record.field_sources)) {
    const base = `field_sources.${field}`;
    if (!Array.isArray(sources)) {
      errors.push(diagnostic('invalid_field_sources', base, `${base} must be an array`));
      continue;
    }
    let hasValidSource = false;
    sources.forEach((source, index) => {
      const sourceField = `${base}[${index}]`;
      if (!isObject(source)) {
        errors.push(diagnostic('invalid_field_source', sourceField, 'field source must be an object'));
        return;
      }
      let valid = true;
      if (typeof source.platform !== 'string' || source.platform.trim() === '') {
        errors.push(diagnostic('invalid_field_source', `${sourceField}.platform`, 'platform must be a nonempty string'));
        valid = false;
      }
      if (!isHttpUrl(source.source_url)) {
        errors.push(diagnostic('invalid_field_source', `${sourceField}.source_url`, 'source_url must be an HTTP(S) URL'));
        valid = false;
      }
      if (!isIsoTimestamp(source.checked_at)) {
        errors.push(diagnostic('invalid_field_source', `${sourceField}.checked_at`, 'checked_at must be an ISO timestamp'));
        valid = false;
      }
      if (!EVIDENCE_TYPES.has(source.evidence_type)) {
        errors.push(diagnostic('invalid_field_source', `${sourceField}.evidence_type`, `evidence_type must be one of ${[...EVIDENCE_TYPES].join(', ')}`));
        valid = false;
      }
      if (source.evidence_type === 'inference'
          && (typeof source.note !== 'string' || source.note.trim() === '')) {
        errors.push(diagnostic('invalid_field_source', `${sourceField}.note`, 'inference evidence requires a nonempty note explaining its basis'));
        valid = false;
      } else if (source.note !== undefined && source.note !== null && typeof source.note !== 'string') {
        errors.push(diagnostic('invalid_field_source', `${sourceField}.note`, 'note must be a string or null'));
        valid = false;
      }
      if (valid) hasValidSource = true;
    });
    if (hasValidSource) fieldsWithValidSources.add(field);
  }
  return fieldsWithValidSources;
}

function addProvenanceWarnings(record, validCitationSources, fieldsWithValidSources, warnings) {
  if (!isMissing(record.citation_count)) {
    if (validCitationSources.length === 0) {
      warnings.push(diagnostic('missing_citation_provenance', 'citation_count', 'citation_count has no valid citation_counts source record'));
    } else if (!validCitationSources.some(source => source.count === record.citation_count)) {
      warnings.push(diagnostic('citation_count_not_in_sources', 'citation_count', 'citation_count does not match any valid citation_counts entry'));
    }
  }

  for (const field of EVIDENCE_SENSITIVE_FIELDS) {
    if (!isMissing(record[field]) && !fieldsWithValidSources.has(field)) {
      warnings.push(diagnostic('missing_field_provenance', field, `${field} is populated without a valid field_sources entry`));
    }
  }

  if (!isMissing(record.paper_identity_status)
      && record.paper_identity_status !== 'unverified'
      && !fieldsWithValidSources.has('paper_identity_status')) {
    warnings.push(diagnostic('missing_field_provenance', 'paper_identity_status', 'a verified paper identity status requires field provenance'));
  }
}

export function validateRecords(records) {
  if (!Array.isArray(records)) {
    throw Object.assign(new Error('records must be an array'), { code: 'INVALID_INPUT' });
  }

  const recordReports = records.map((record, index) => {
    const errors = [];
    const warnings = [];
    if (!isObject(record)) {
      errors.push(diagnostic('invalid_record', '$', 'record must be an object'));
      return { index, valid: false, errors, warnings };
    }

    for (const field of REQUIRED_KEYS) {
      if (!Object.hasOwn(record, field)) {
        errors.push(diagnostic('missing_required_key', field, `required key is missing: ${field}`));
      }
    }
    addTypeErrors(record, errors);
    addIdentifierErrors(record, errors);
    const validCitationSources = validateCitationSources(record, errors);
    const fieldsWithValidSources = validateFieldSources(record, errors);
    addProvenanceWarnings(record, validCitationSources, fieldsWithValidSources, warnings);
    return { index, valid: errors.length === 0, errors, warnings };
  });

  const errorCount = recordReports.reduce((sum, record) => sum + record.errors.length, 0);
  const warningCount = recordReports.reduce((sum, record) => sum + record.warnings.length, 0);
  const invalidCount = recordReports.filter(record => !record.valid).length;
  return {
    valid: errorCount === 0,
    records: recordReports,
    summary: {
      total_records: records.length,
      valid_records: records.length - invalidCount,
      invalid_records: invalidCount,
      errors: errorCount,
      warnings: warningCount,
    },
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return structuredClone(value);
}

function unionArrays(left, right) {
  const output = [];
  const seen = new Set();
  for (const value of [...left, ...right]) {
    const key = canonicalValue(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clone(value));
  }
  return output;
}

function isMergeMissing(value) {
  return isMissing(value) || (isObject(value) && Object.keys(value).length === 0);
}

function mergeFieldSources(current, incoming) {
  if (!isObject(incoming)) return isObject(current) ? current : clone(incoming);
  if (!isObject(current)) current = {};
  for (const [field, sources] of Object.entries(incoming)) {
    if (!Object.hasOwn(current, field) || isMergeMissing(current[field])) {
      current[field] = Array.isArray(sources) ? unionArrays([], sources) : clone(sources);
    } else if (Array.isArray(current[field]) && Array.isArray(sources)) {
      current[field] = unionArrays(current[field], sources);
    }
  }
  return current;
}

function mergeMissingFields(current, incoming) {
  if (!isObject(current)) return clone(incoming);
  if (!isObject(incoming)) return current;
  for (const [field, reason] of Object.entries(incoming)) {
    if (!Object.hasOwn(current, field) || isMergeMissing(current[field])) {
      current[field] = clone(reason);
    }
  }
  return current;
}

function mergeGroupRecords(records, sourceIndices) {
  const merged = {};
  for (const sourceIndex of sourceIndices) {
    for (const [field, value] of Object.entries(records[sourceIndex])) {
      if (field === 'source_indices' || field === 'arxiv_versions') continue;
      if (!Object.hasOwn(merged, field)) {
        if (field === 'field_sources') {
          merged[field] = mergeFieldSources({}, value);
        } else if (field === 'missing_fields') {
          merged[field] = mergeMissingFields({}, value);
        } else {
          merged[field] = Array.isArray(value) ? unionArrays([], value) : clone(value);
        }
      } else if (field === 'field_sources') {
        merged[field] = mergeFieldSources(merged[field], value);
      } else if (field === 'missing_fields') {
        merged[field] = mergeMissingFields(merged[field], value);
      } else if (Array.isArray(merged[field]) && Array.isArray(value)) {
        merged[field] = unionArrays(merged[field], value);
      } else if (isMergeMissing(merged[field]) && !isMergeMissing(value)) {
        merged[field] = Array.isArray(value) ? unionArrays([], value) : clone(value);
      }
    }
  }

  if (isObject(merged.missing_fields)) {
    for (const field of Object.keys(merged.missing_fields)) {
      if (!isMergeMissing(merged[field])) delete merged.missing_fields[field];
    }
  }
  merged.source_indices = [...sourceIndices];
  return merged;
}

function identifierKey(field, value) {
  if (field === 'doi') return normalizeDoi(value);
  if (field === 'arxiv_id') return parseArxivId(value)?.base ?? null;
  if (field === 'pubmed_id') return normalizePmid(value);
  return null;
}

function equivalenceKey(field, value) {
  const identifier = identifierKey(field, value);
  return identifier === null ? canonicalValue(value) : `normalized:${identifier}`;
}

function conflictsForGroup(records, sourceIndices, resultIndex, merged) {
  const ignored = new Set(['source_indices', 'arxiv_versions', 'field_sources', 'missing_fields']);
  const fields = [];
  const seenFields = new Set();
  for (const sourceIndex of sourceIndices) {
    for (const [field, value] of Object.entries(records[sourceIndex])) {
      if (ignored.has(field) || Array.isArray(value) || seenFields.has(field)) continue;
      seenFields.add(field);
      fields.push(field);
    }
  }

  const conflicts = [];
  for (const field of fields) {
    const values = [];
    const byValue = new Map();
    for (const sourceIndex of sourceIndices) {
      const value = records[sourceIndex][field];
      if (isMergeMissing(value) || Array.isArray(value)) continue;
      const key = equivalenceKey(field, value);
      const existing = byValue.get(key);
      if (existing) {
        existing.source_indices.push(sourceIndex);
      } else {
        const item = { value: clone(value), source_indices: [sourceIndex] };
        byValue.set(key, item);
        values.push(item);
      }
    }
    if (values.length > 1) {
      conflicts.push({
        result_index: resultIndex,
        field,
        kept_value: clone(merged[field]),
        values,
        source_indices: values.flatMap(value => value.source_indices),
      });
    }
  }
  return conflicts;
}

function arxivVersions(records, sourceIndices) {
  const versions = [];
  for (const sourceIndex of sourceIndices) {
    const raw = records[sourceIndex].arxiv_id;
    const parsed = parseArxivId(raw);
    if (parsed?.version) {
      versions.push({ source_index: sourceIndex, arxiv_id: raw, version: parsed.version });
    }
  }
  return versions;
}

function normalizedTitle(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array(size).fill(0);
  }

  find(index) {
    if (this.parent[index] !== index) this.parent[index] = this.find(this.parent[index]);
    return this.parent[index];
  }

  union(left, right) {
    let leftRoot = this.find(left);
    let rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (this.rank[leftRoot] < this.rank[rightRoot]) [leftRoot, rightRoot] = [rightRoot, leftRoot];
    this.parent[rightRoot] = leftRoot;
    if (this.rank[leftRoot] === this.rank[rightRoot]) this.rank[leftRoot] += 1;
  }
}

export function dedupeRecords(records) {
  if (!Array.isArray(records)) {
    throw Object.assign(new Error('records must be an array'), { code: 'INVALID_INPUT' });
  }
  records.forEach((record, index) => {
    if (!isObject(record)) {
      throw Object.assign(new Error(`record at index ${index} must be an object`), { code: 'INVALID_INPUT' });
    }
  });

  const sets = new DisjointSet(records.length);
  const firstByIdentifier = new Map();
  const identifierMatches = new Map();
  const identifierFields = ['doi', 'arxiv_id', 'pubmed_id'];

  records.forEach((record, sourceIndex) => {
    for (const field of identifierFields) {
      const value = identifierKey(field, record[field]);
      if (value === null) continue;
      const key = `${field}:${value}`;
      if (!identifierMatches.has(key)) {
        identifierMatches.set(key, { identifier: field, value, source_indices: [] });
      }
      identifierMatches.get(key).source_indices.push(sourceIndex);
      if (firstByIdentifier.has(key)) {
        sets.union(sourceIndex, firstByIdentifier.get(key));
      } else {
        firstByIdentifier.set(key, sourceIndex);
      }
    }
  });

  const componentsByRoot = new Map();
  records.forEach((_, index) => {
    const root = sets.find(index);
    if (!componentsByRoot.has(root)) componentsByRoot.set(root, []);
    componentsByRoot.get(root).push(index);
  });
  const components = [...componentsByRoot.values()].sort((left, right) => left[0] - right[0]);

  const results = [];
  const groups = [];
  const conflicts = [];
  components.forEach((sourceIndices, resultIndex) => {
    const merged = mergeGroupRecords(records, sourceIndices);
    const versions = arxivVersions(records, sourceIndices);
    if (versions.length > 0) merged.arxiv_versions = versions;
    results.push(merged);
    conflicts.push(...conflictsForGroup(records, sourceIndices, resultIndex, merged));

    if (sourceIndices.length > 1) {
      const sourceSet = new Set(sourceIndices);
      const matchedBy = [...identifierMatches.values()]
        .map(match => ({
          ...match,
          source_indices: match.source_indices.filter(index => sourceSet.has(index)),
        }))
        .filter(match => match.source_indices.length > 1);
      groups.push({
        result_index: resultIndex,
        source_indices: [...sourceIndices],
        matched_by: matchedBy,
        arxiv_versions: versions,
      });
    }
  });

  const possibleDuplicates = [];
  const resultIndexBySource = new Map();
  components.forEach((sourceIndices, resultIndex) => {
    sourceIndices.forEach(sourceIndex => resultIndexBySource.set(sourceIndex, resultIndex));
  });
  const matchesByTitle = new Map();
  records.forEach((record, sourceIndex) => {
    const title = normalizedTitle(record.title);
    if (!title) return;
    if (!matchesByTitle.has(title)) matchesByTitle.set(title, new Map());
    const byResult = matchesByTitle.get(title);
    const resultIndex = resultIndexBySource.get(sourceIndex);
    if (!byResult.has(resultIndex)) {
      byResult.set(resultIndex, { result_index: resultIndex, title: record.title, source_indices: [] });
    }
    byResult.get(resultIndex).source_indices.push(sourceIndex);
  });
  for (const [title, matchesByResult] of matchesByTitle) {
    const matches = [...matchesByResult.values()].sort((left, right) => left.result_index - right.result_index);
    for (let left = 0; left < matches.length; left += 1) {
      for (let right = left + 1; right < matches.length; right += 1) {
        const pair = [matches[left], matches[right]];
        possibleDuplicates.push({
          reason: 'normalized_title',
          normalized_title: title,
          result_indices: pair.map(match => match.result_index),
          source_indices: pair.map(match => [...match.source_indices]),
          titles: pair.map(match => match.title),
        });
      }
    }
  }

  return {
    results,
    groups,
    possible_duplicates: possibleDuplicates,
    conflicts,
    summary: {
      input_records: records.length,
      output_records: results.length,
      duplicate_groups: groups.length,
      merged_records: records.length - results.length,
      possible_duplicates: possibleDuplicates.length,
      conflicts: conflicts.length,
    },
  };
}

function cliError(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseArgs(argv) {
  const command = argv[0];
  if (command !== 'validate' && command !== 'dedupe') {
    throw cliError('INVALID_ARGUMENT', 'Command must be validate or dedupe');
  }
  const args = { command, input: '', output: '' };
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== '--input' && flag !== '--output') {
      throw cliError('INVALID_ARGUMENT', `Unknown argument: ${flag}`);
    }
    if (seen.has(flag)) throw cliError('INVALID_ARGUMENT', `Duplicate argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw cliError('INVALID_ARGUMENT', `Missing value for ${flag}`);
    }
    seen.add(flag);
    args[flag.slice(2)] = value;
    index += 1;
  }
  if (!args.input) throw cliError('INVALID_ARGUMENT', 'Missing required argument: --input');
  if (!args.output) throw cliError('INVALID_ARGUMENT', 'Missing required argument: --output');
  return args;
}

function recordsFromInput(value) {
  if (Array.isArray(value)) return value;
  if (isObject(value) && Array.isArray(value.results)) return value.results;
  throw cliError('INVALID_INPUT', 'Input JSON must be an array or an object with a results array');
}

function isNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isUniqueIndexArray(value, minimumLength = 1) {
  return Array.isArray(value)
    && value.length >= minimumLength
    && value.every(isNonnegativeInteger)
    && new Set(value).size === value.length;
}

function sameIndexArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isValidArxivVersions(versions, sourceIndices) {
  if (!Array.isArray(versions)) return false;
  const allowedSources = new Set(sourceIndices);
  const seenSources = new Set();
  for (const version of versions) {
    if (!isObject(version)
        || !isNonnegativeInteger(version.source_index)
        || !allowedSources.has(version.source_index)
        || seenSources.has(version.source_index)
        || typeof version.arxiv_id !== 'string'
        || typeof version.version !== 'string') {
      return false;
    }
    const parsed = parseArxivId(version.arxiv_id);
    if (!parsed?.version || parsed.version !== version.version) return false;
    seenSources.add(version.source_index);
  }
  return true;
}

function isValidGroupMatches(matches, sourceIndices, identifierEvidence) {
  if (!Array.isArray(matches) || matches.length === 0) return false;
  const sourcePositions = new Map(sourceIndices.map((sourceIndex, position) => [sourceIndex, position]));
  const connected = new DisjointSet(sourceIndices.length);
  const seenIdentifiers = new Set();

  for (const match of matches) {
    if (!isObject(match)
        || !['doi', 'arxiv_id', 'pubmed_id'].includes(match.identifier)
        || typeof match.value !== 'string'
        || identifierKey(match.identifier, match.value) !== match.value
        || !isUniqueIndexArray(match.source_indices, 2)
        || match.source_indices.some(sourceIndex => !sourcePositions.has(sourceIndex))) {
      return false;
    }
    const observed = identifierEvidence.get(match.identifier)?.get(match.value);
    if (!observed
        || (observed.source_indices !== null
          && !sameIndexArray(match.source_indices, observed.source_indices))) return false;
    const identifier = `${match.identifier}:${match.value}`;
    if (seenIdentifiers.has(identifier)) return false;
    seenIdentifiers.add(identifier);

    const firstPosition = sourcePositions.get(match.source_indices[0]);
    for (const sourceIndex of match.source_indices.slice(1)) {
      connected.union(firstPosition, sourcePositions.get(sourceIndex));
    }
  }

  const root = connected.find(0);
  return sourceIndices.every((_, position) => connected.find(position) === root);
}

function observableIdentifierEvidence(result, conflicts) {
  const evidence = new Map();
  for (const field of ['doi', 'arxiv_id', 'pubmed_id']) {
    const byValue = new Map();
    const keptValue = identifierKey(field, result[field]);
    if (keptValue !== null) byValue.set(keptValue, { source_indices: null });
    evidence.set(field, byValue);
  }

  for (const conflict of conflicts) {
    if (!evidence.has(conflict.field)) continue;
    const byValue = evidence.get(conflict.field);
    for (const value of conflict.values) {
      const normalized = identifierKey(conflict.field, value.value);
      if (normalized !== null) {
        byValue.set(normalized, { source_indices: [...value.source_indices] });
      }
    }
  }
  return evidence;
}

function hasCompleteObservableArxivVersions(result, conflicts, versions, identifierEvidence) {
  const arxivEvidence = identifierEvidence.get('arxiv_id');
  for (const version of versions) {
    const parsed = parseArxivId(version.arxiv_id);
    const observed = arxivEvidence.get(parsed.base);
    if (!observed
        || (observed.source_indices !== null
          && !observed.source_indices.includes(version.source_index))) {
      return false;
    }
  }

  const observableValues = [{ raw: result.arxiv_id, source_indices: null }];
  for (const conflict of conflicts) {
    if (conflict.field !== 'arxiv_id') continue;
    for (const value of conflict.values) {
      observableValues.push({ raw: value.value, source_indices: value.source_indices });
    }
  }

  for (const observable of observableValues) {
    const parsed = parseArxivId(observable.raw);
    if (!parsed?.version) continue;
    const matchingVersions = versions.filter(version => version.arxiv_id === observable.raw);
    if (matchingVersions.length === 0
        || (observable.source_indices !== null
          && !matchingVersions.some(version => observable.source_indices.includes(version.source_index)))) {
      return false;
    }
  }
  return true;
}

function isValidPossibleDuplicate(item, results, sourceSets, seenCandidates) {
  if (!isObject(item)
      || item.reason !== 'normalized_title'
      || typeof item.normalized_title !== 'string'
      || normalizedTitle(item.normalized_title) !== item.normalized_title
      || item.normalized_title === ''
      || !isUniqueIndexArray(item.result_indices, 2)
      || item.result_indices.length !== 2
      || item.result_indices.some(resultIndex => resultIndex >= results.length)
      || !Array.isArray(item.source_indices)
      || item.source_indices.length !== 2
      || !Array.isArray(item.titles)
      || item.titles.length !== 2) {
    return false;
  }

  for (let position = 0; position < 2; position += 1) {
    const resultIndex = item.result_indices[position];
    const sources = item.source_indices[position];
    if (!isUniqueIndexArray(sources)
        || sources.some(sourceIndex => !sourceSets[resultIndex].has(sourceIndex))
        || typeof item.titles[position] !== 'string'
        || normalizedTitle(item.titles[position]) !== item.normalized_title) {
      return false;
    }
  }

  const candidateKey = `${item.normalized_title}:${[...item.result_indices].sort((left, right) => left - right).join(',')}`;
  if (seenCandidates.has(candidateKey)) return false;
  seenCandidates.add(candidateKey);
  return true;
}

function isValidConflict(conflict, results, sourceSets, seenConflicts) {
  if (!isObject(conflict)
      || !isNonnegativeInteger(conflict.result_index)
      || conflict.result_index >= results.length
      || typeof conflict.field !== 'string'
      || conflict.field.trim() === ''
      || !Object.hasOwn(conflict, 'kept_value')
      || !isUniqueIndexArray(conflict.source_indices, 2)
      || !Array.isArray(conflict.values)
      || conflict.values.length < 2) {
    return false;
  }

  const result = results[conflict.result_index];
  const allowedSources = sourceSets[conflict.result_index];
  if (!Object.hasOwn(result, conflict.field)
      || canonicalValue(conflict.kept_value) !== canonicalValue(result[conflict.field])
      || conflict.source_indices.some(sourceIndex => !allowedSources.has(sourceIndex))) {
    return false;
  }

  const flattenedSources = [];
  const seenSources = new Set();
  const seenValues = new Set();
  let includesKeptValue = false;
  for (const value of conflict.values) {
    if (!isObject(value)
        || !Object.hasOwn(value, 'value')
        || !isUniqueIndexArray(value.source_indices)
        || value.source_indices.some(sourceIndex => !allowedSources.has(sourceIndex) || seenSources.has(sourceIndex))) {
      return false;
    }
    const valueKey = equivalenceKey(conflict.field, value.value);
    if (seenValues.has(valueKey)) return false;
    seenValues.add(valueKey);
    if (canonicalValue(value.value) === canonicalValue(conflict.kept_value)) includesKeptValue = true;
    value.source_indices.forEach(sourceIndex => {
      seenSources.add(sourceIndex);
      flattenedSources.push(sourceIndex);
    });
  }
  if (!includesKeptValue || !sameIndexArray(flattenedSources, conflict.source_indices)) return false;

  const conflictKey = `${conflict.result_index}:${conflict.field}`;
  if (seenConflicts.has(conflictKey)) return false;
  seenConflicts.add(conflictKey);
  return true;
}

function isCompleteDedupeOutput(value) {
  if (!isObject(value)
      || !Array.isArray(value.results)
      || !Array.isArray(value.groups)
      || !Array.isArray(value.possible_duplicates)
      || !Array.isArray(value.conflicts)
      || !isObject(value.summary)) {
    return false;
  }

  const summary = value.summary;
  const summaryFields = [
    'input_records', 'output_records', 'duplicate_groups', 'merged_records',
    'possible_duplicates', 'conflicts',
  ];
  if (!summaryFields.every(field => isNonnegativeInteger(summary[field]))) return false;
  if (summary.output_records !== value.results.length
      || summary.duplicate_groups !== value.groups.length
      || summary.possible_duplicates !== value.possible_duplicates.length
      || summary.conflicts !== value.conflicts.length
      || summary.merged_records !== summary.input_records - summary.output_records) {
    return false;
  }

  const lineage = [];
  const sourceSets = [];
  for (const result of value.results) {
    if (!isObject(result)
        || !isUniqueIndexArray(result.source_indices)
        || result.source_indices.some(sourceIndex => sourceIndex >= summary.input_records)
        || (Object.hasOwn(result, 'arxiv_versions') && !Array.isArray(result.arxiv_versions))) {
      return false;
    }
    const versions = result.arxiv_versions ?? [];
    if (!isValidArxivVersions(versions, result.source_indices)) return false;
    lineage.push(...result.source_indices);
    sourceSets.push(new Set(result.source_indices));
  }
  lineage.sort((left, right) => left - right);
  if (lineage.length !== summary.input_records
      || !lineage.every((sourceIndex, position) => sourceIndex === position)) {
    return false;
  }

  const seenCandidates = new Set();
  if (!value.possible_duplicates.every(item => (
    isValidPossibleDuplicate(item, value.results, sourceSets, seenCandidates)
  ))) {
    return false;
  }

  const seenConflicts = new Set();
  if (!value.conflicts.every(conflict => (
    isValidConflict(conflict, value.results, sourceSets, seenConflicts)
  ))) {
    return false;
  }

  const conflictsByResult = value.results.map(() => []);
  value.conflicts.forEach(conflict => conflictsByResult[conflict.result_index].push(conflict));
  const identifierEvidenceByResult = value.results.map((result, resultIndex) => (
    observableIdentifierEvidence(result, conflictsByResult[resultIndex])
  ));
  for (let resultIndex = 0; resultIndex < value.results.length; resultIndex += 1) {
    const result = value.results[resultIndex];
    if (!hasCompleteObservableArxivVersions(
      result,
      conflictsByResult[resultIndex],
      result.arxiv_versions ?? [],
      identifierEvidenceByResult[resultIndex],
    )) {
      return false;
    }
  }

  const groupsByResult = new Map();
  for (const group of value.groups) {
    if (!isObject(group)
        || !isNonnegativeInteger(group.result_index)
        || group.result_index >= value.results.length
        || groupsByResult.has(group.result_index)) {
      return false;
    }
    const result = value.results[group.result_index];
    if (result.source_indices.length < 2
        || !sameIndexArray(group.source_indices, result.source_indices)
        || !isValidArxivVersions(group.arxiv_versions, group.source_indices)
        || canonicalValue(group.arxiv_versions) !== canonicalValue(result.arxiv_versions ?? [])
        || !isValidGroupMatches(
          group.matched_by,
          group.source_indices,
          identifierEvidenceByResult[group.result_index],
        )) {
      return false;
    }
    groupsByResult.set(group.result_index, group);
  }
  for (let resultIndex = 0; resultIndex < value.results.length; resultIndex += 1) {
    if (groupsByResult.has(resultIndex) !== (value.results[resultIndex].source_indices.length > 1)) return false;
  }
  return true;
}

function hasDedupeProvenance(value, records) {
  return records.some(record => isObject(record)
      && (Object.hasOwn(record, 'source_indices') || Object.hasOwn(record, 'arxiv_versions')))
    || (isObject(value) && ['groups', 'possible_duplicates', 'conflicts'].some(field => Object.hasOwn(value, field)));
}

async function readInput(inputPath) {
  let text;
  try {
    text = await fs.readFile(inputPath, 'utf8');
  } catch (error) {
    throw cliError('INPUT_READ_ERROR', `Cannot read input: ${error.message}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw cliError('INVALID_JSON', `Input is not valid JSON: ${error.message}`);
  }
  return value;
}

async function writeJsonAtomic(outputPath, value) {
  const resolved = path.resolve(outputPath);
  const directory = path.dirname(resolved);
  const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, resolved);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw cliError('OUTPUT_WRITE_ERROR', `Cannot write output atomically: ${error.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = await readInput(args.input);
  const records = recordsFromInput(input);
  let output;
  if (args.command === 'validate') {
    output = validateRecords(records);
  } else if (isCompleteDedupeOutput(input)) {
    output = clone(input);
  } else {
    if (hasDedupeProvenance(input, records)) {
      throw cliError('INVALID_INPUT', 'Incomplete dedupe output would lose source provenance; provide the complete prior output envelope');
    }
    output = dedupeRecords(records);
  }
  await writeJsonAtomic(args.output, output);
  process.stdout.write(`${JSON.stringify(output.summary)}\n`);
  return args.command === 'validate' && !output.valid ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().then(
    code => { process.exitCode = code; },
    error => {
      const code = typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR';
      process.stderr.write(`${JSON.stringify({ error: { code, message: error.message } })}\n`);
      process.exitCode = 2;
    },
  );
}
