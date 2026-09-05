#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/academic-search-oa-pdf.XXXXXX)"
SERVER_JS="${TMP_DIR}/server.mjs"
INPUT_JSON="${TMP_DIR}/papers.json"
MANIFEST_JSON="${TMP_DIR}/manifest.json"
OUT_DIR="${TMP_DIR}/downloads"
SERVER_LOG="${TMP_DIR}/server.log"
SERVER_PID=""

cleanup() {
  if [ -n "${SERVER_PID}" ]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP_DIR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if [[ "${haystack}" != *"${needle}"* ]]; then
    fail "${label} -- expected '${needle}', got: ${haystack}"
  fi
}

cat > "${SERVER_JS}" <<'JS'
import http from 'node:http';
import fs from 'node:fs';

const validPdf = fs.readFileSync(process.argv[2]);

const server = http.createServer((req, res) => {
  if (req.url === '/paper.pdf') {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end(validPdf);
    return;
  }
  if (req.url === '/not-pdf') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>not a pdf</html>');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  console.log(addr.port);
});
JS

node "${SERVER_JS}" "${ROOT_DIR}/scripts/fixtures/pdf/valid.pdf" > "${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 20); do
  if [ -s "${SERVER_LOG}" ]; then
    break
  fi
  sleep 0.2
done

PORT="$(head -n 1 "${SERVER_LOG}")"
[ -n "${PORT}" ] || fail "test HTTP server did not start"

cat > "${INPUT_JSON}" <<JSON
[
  {
    "title": "Open Paper",
    "authors": ["A. Researcher"],
    "year": 2026,
    "doi": "10.0000/open",
    "arxiv_id": null,
    "full_text_status": "open_pdf",
    "pdf_url": "http://127.0.0.1:${PORT}/paper.pdf",
    "source_platforms": ["unpaywall"],
    "fetched_at": "2026-05-08"
  },
  {
    "title": "Institution Paper",
    "authors": ["B. Researcher"],
    "year": 2026,
    "doi": "10.0000/closed",
    "arxiv_id": null,
    "full_text_status": "needs_institution",
    "pdf_url": "http://127.0.0.1:${PORT}/paper.pdf",
    "source_platforms": ["publisher"],
    "fetched_at": "2026-05-08"
  },
  {
    "title": "Bad Content",
    "authors": ["C. Researcher"],
    "year": 2026,
    "doi": "10.0000/notpdf",
    "arxiv_id": null,
    "full_text_status": "open_pdf",
    "pdf_url": "http://127.0.0.1:${PORT}/not-pdf",
    "source_platforms": ["openalex"],
    "fetched_at": "2026-05-08"
  }
]
JSON

MANIFEST_ONLY="$(node "${ROOT_DIR}/scripts/oa-pdf-download.mjs" --input "${INPUT_JSON}" --manifest "${MANIFEST_JSON}")"
assert_contains "${MANIFEST_ONLY}" '"eligible":2' "manifest eligible count"
assert_contains "${MANIFEST_ONLY}" '"skipped":1' "manifest skipped count"

[ -s "${MANIFEST_JSON}" ] || fail "manifest file not created"

DOWNLOAD_OUTPUT="$(node "${ROOT_DIR}/scripts/oa-pdf-download.mjs" --input "${INPUT_JSON}" --manifest "${MANIFEST_JSON}" --download --out-dir "${OUT_DIR}")"
assert_contains "${DOWNLOAD_OUTPUT}" '"downloaded":1' "downloaded count"
assert_contains "${DOWNLOAD_OUTPUT}" '"not_pdf":1' "not-pdf count"
assert_contains "${DOWNLOAD_OUTPUT}" '"skipped":1' "skipped count"

PDF_FILE="$(find "${OUT_DIR}" -type f -name '*.pdf' | head -n 1)"
[ -s "${PDF_FILE}" ] || fail "expected downloaded PDF file"
PDF_HEADER="$(LC_ALL=C od -An -c -N 5 "${PDF_FILE}" | tr -d ' \n')"
[ "${PDF_HEADER}" = "%PDF-" ] || fail "downloaded file is not PDF, header=${PDF_HEADER}"

MANIFEST_CONTENT="$(tr -d '[:space:]' < "${MANIFEST_JSON}")"
assert_contains "${MANIFEST_CONTENT}" '"download_status":"downloaded"' "manifest downloaded status"
assert_contains "${MANIFEST_CONTENT}" '"download_status":"skipped"' "manifest skipped status"
assert_contains "${MANIFEST_CONTENT}" '"download_status":"not_pdf"' "manifest not_pdf status"
assert_contains "${MANIFEST_CONTENT}" '"local_pdf_path"' "manifest local path field"

echo "PASS: academic-search oa-pdf-download self-test"
