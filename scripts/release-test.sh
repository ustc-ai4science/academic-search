#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROXY_PORT="${CDP_PROXY_PORT:-0}"
BASE_URL="http://127.0.0.1:${PROXY_PORT}"
PROXY_PID=""
TEST_DIR="$(mktemp -d /tmp/academic-search-release-test.XXXXXX)"
PROXY_LOG="${TEST_DIR}/proxy.log"
TARGET_A=""
TARGET_B=""
FIXTURE_HTML=""
PNG_FILE=""
PNG_HEADERS=""
UPLOAD_A=""
UPLOAD_B=""
HTTP_BODY_FILE=""

cleanup() {
  rm -f "${PROXY_LOG}" "${HTTP_BODY_FILE}" >/dev/null 2>&1 || true
  if [ -n "${TARGET_A}" ]; then
    curl -s "${BASE_URL}/close?target=${TARGET_A}" >/dev/null 2>&1 || true
  fi
  if [ -n "${TARGET_B}" ]; then
    curl -s "${BASE_URL}/close?target=${TARGET_B}" >/dev/null 2>&1 || true
  fi
  if [ -n "${PROXY_PID}" ]; then
    kill "${PROXY_PID}" >/dev/null 2>&1 || true
    wait "${PROXY_PID}" 2>/dev/null || true
  fi
  if [ -n "${FIXTURE_HTML}" ]; then
    rm -f "${FIXTURE_HTML}" >/dev/null 2>&1 || true
  fi
  if [ -n "${PNG_FILE}" ]; then
    rm -f "${PNG_FILE}" >/dev/null 2>&1 || true
  fi
  if [ -n "${PNG_HEADERS}" ]; then
    rm -f "${PNG_HEADERS}" >/dev/null 2>&1 || true
  fi
  if [ -n "${UPLOAD_A}" ]; then
    rm -f "${UPLOAD_A}" >/dev/null 2>&1 || true
  fi
  if [ -n "${UPLOAD_B}" ]; then
    rm -f "${UPLOAD_B}" >/dev/null 2>&1 || true
  fi
  if [ -n "${HTTP_BODY_FILE}" ]; then
    rm -f "${HTTP_BODY_FILE}" >/dev/null 2>&1 || true
  fi
  rmdir "${TEST_DIR}" >/dev/null 2>&1 || true
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
    fail "${label} -- expected to find '${needle}', got: ${haystack}"
  fi
}

assert_empty() {
  local value="$1"
  local label="$2"
  if [ -n "${value}" ]; then
    fail "${label} -- expected empty result, got: ${value}"
  fi
}

assert_file_nonempty() {
  local file="$1"
  local label="$2"
  if [ ! -s "${file}" ]; then
    fail "${label} -- expected non-empty file at ${file}"
  fi
}

assert_png_file() {
  local file="$1"
  local label="$2"
  local header
  header="$(LC_ALL=C od -An -t x1 -N 8 "${file}" | tr -d ' \n')"
  if [ "${header}" != "89504e470d0a1a0a" ]; then
    fail "${label} -- expected PNG header, got ${header}"
  fi
}

request() {
  local method="$1"
  local url="$2"
  local body="${3-}"
  if [ -n "${body}" ]; then
    curl -s -X "${method}" "${url}" -d "${body}"
  else
    curl -s -X "${method}" "${url}"
  fi
}

request_with_status() {
  local method="$1"
  local url="$2"
  local body="${3-}"
  if [ -n "${body}" ]; then
    curl -s -o "${HTTP_BODY_FILE}" -w '%{http_code}' -X "${method}" "${url}" -d "${body}"
  else
    curl -s -o "${HTTP_BODY_FILE}" -w '%{http_code}' -X "${method}" "${url}"
  fi
}

start_proxy() {
  echo "Starting isolated test proxy (requested port ${PROXY_PORT})"
  CDP_PROXY_PORT="${PROXY_PORT}" node "${SCRIPT_DIR}/cdp-proxy.mjs" >"${PROXY_LOG}" 2>&1 &
  PROXY_PID=$!
  local health="" bound_port=""
  for _ in $(seq 1 120); do
    kill -0 "${PROXY_PID}" 2>/dev/null || fail "new proxy process exited; refusing to test an existing instance: $(cat "${PROXY_LOG}")"
    bound_port="$(sed -n 's#.*运行在 http://127.0.0.1:\([0-9]*\).*#\1#p' "${PROXY_LOG}" | head -n 1)"
    if [ -n "${bound_port}" ]; then
      PROXY_PORT="${bound_port}"
      BASE_URL="http://127.0.0.1:${PROXY_PORT}"
      health="$(curl -s --max-time 3 "${BASE_URL}/health" 2>/dev/null || true)"
      if printf '%s' "${health}" | node -e 'let h;try{h=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{process.exit(1)};process.exit(h.pid===Number(process.argv[1])&&h.instance_id&&h.connected===true?0:1)' "${PROXY_PID}"; then
        return 0
      fi
    fi
    sleep 0.25
  done
  fail "owned proxy did not connect to Chrome: $(cat "${PROXY_LOG}")"
}

FIXTURE_HTML="${TEST_DIR}/fixture_html.html"
PNG_FILE="${TEST_DIR}/png_file.png"
PNG_HEADERS="${TEST_DIR}/png_headers.txt"
UPLOAD_A="${TEST_DIR}/upload_a.txt"
UPLOAD_B="${TEST_DIR}/upload_b.txt"
HTTP_BODY_FILE="${TEST_DIR}/http_body_file.txt"

printf 'upload-a\n' > "${UPLOAD_A}"
printf 'upload-b\n' > "${UPLOAD_B}"
printf '%s' '<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>academic-search release fixture</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    .toolbar { position: sticky; top: 0; padding: 12px; background: #e5e7eb; }
    .spacer { height: 2400px; background: linear-gradient(#f8fafc, #bfdbfe); }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="click-btn" onclick="document.body.dataset.clicked='\''true'\''">click</button>
    <input id="multi-file-input" type="file" multiple onchange="document.body.dataset.fileCount=String(this.files.length); document.body.dataset.fileNames=Array.from(this.files).map(f => f.name).join('\''|'\'')" />
  </div>
  <div class="spacer"></div>
</body>
</html>' > "${FIXTURE_HTML}"

DOC_LOCALHOST="$(rg -n 'http://localhost:345[67]' "${ROOT_DIR}/README.md" "${ROOT_DIR}/README.en.md" "${ROOT_DIR}/SKILL.md" "${ROOT_DIR}/references" || true)"
assert_empty "${DOC_LOCALHOST}" "documentation localhost hardcoding"
README_CONTENT="$(cat "${ROOT_DIR}/README.md")"
assert_contains "${README_CONTENT}" 'make test' "README make test mention"
assert_contains "${README_CONTENT}" 'make test-release' "README make test-release mention"
assert_contains "${README_CONTENT}" '开放获取 PDF' "README open-access PDF expectation"
assert_contains "${README_CONTENT}" 'OA PDF 下载' "README OA PDF download mention"
assert_contains "${README_CONTENT}" '不绕过付费墙' "README paywall boundary"
README_EN_CONTENT="$(cat "${ROOT_DIR}/README.en.md")"
assert_contains "${README_EN_CONTENT}" 'make test' "README.en make test mention"
assert_contains "${README_EN_CONTENT}" 'make test-release' "README.en make test-release mention"
assert_contains "${README_EN_CONTENT}" 'open-access PDF' "README.en open-access PDF expectation"
assert_contains "${README_EN_CONTENT}" 'open-access PDF download' "README.en OA PDF download mention"
assert_contains "${README_EN_CONTENT}" 'does not bypass paywalls' "README.en paywall boundary"
SKILL_CONTENT="$(cat "${ROOT_DIR}/SKILL.md")"
SCHEMA_CONTENT="$(cat "${ROOT_DIR}/references/metadata-schema.md")"
assert_contains "${SKILL_CONTENT}" '学科路由' "SKILL discipline routing section"
assert_contains "${SCHEMA_CONTENT}" 'full_text_status' "metadata full text status guidance"
assert_contains "${SKILL_CONTENT}" 'references/full-text-workflow.md' "SKILL delegated full text workflow"
assert_contains "${SKILL_CONTENT}" 'references/disciplines' "SKILL discipline references index"
assert_contains "${SKILL_CONTENT}" 'OpenAlex' "SKILL OpenAlex coverage"
assert_contains "${SKILL_CONTENT}" 'Crossref' "SKILL Crossref coverage"
assert_contains "${SKILL_CONTENT}" '开放 PDF 下载与 manifest 导出' "SKILL OA PDF download section"
assert_contains "${SCHEMA_CONTENT}" 'download_status' "metadata download status schema"
assert_contains "${SKILL_CONTENT}" '不得调用 Sci-Hub' "SKILL no Sci-Hub boundary"
[ -f "${ROOT_DIR}/references/disciplines/biomedicine.md" ] || fail "missing biomedicine discipline profile"
[ -f "${ROOT_DIR}/references/disciplines/computer-science.md" ] || fail "missing computer science discipline profile"
[ -f "${ROOT_DIR}/references/disciplines/economics-social-science.md" ] || fail "missing economics/social science discipline profile"
[ -f "${ROOT_DIR}/references/rankings/biomed-evidence-ranking.md" ] || fail "missing biomedical evidence ranking reference"
[ -f "${ROOT_DIR}/references/workflows/systematic-review.md" ] || fail "missing systematic review workflow"
[ -f "${ROOT_DIR}/references/site-patterns/sciencedirect.com.md" ] || fail "missing ScienceDirect site pattern"

start_proxy

node "${SCRIPT_DIR}/browser-smoke.mjs" "${BASE_URL}" "${PROXY_PID}"

# This manually started fixture has no bootstrap ownership record; do not adopt it.
if CHECK_DEPS_OUTPUT="$(CDP_PROXY_PORT="${PROXY_PORT}" bash "${SCRIPT_DIR}/check-deps.sh" 2>&1)"; then
  fail 'check-deps must refuse a proxy it did not start or record'
fi
assert_contains "${CHECK_DEPS_OUTPUT}" 'PROXY_PORT_IN_USE' 'check-deps ownership check'

FIXTURE_URL="file://${FIXTURE_HTML}"
TARGET_A_JSON="$(request GET "${BASE_URL}/new?url=${FIXTURE_URL}")"
TARGET_A="$(printf '%s' "${TARGET_A_JSON}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).targetId")"
[ -n "${TARGET_A}" ] || fail "target A creation failed"

TARGET_B_JSON="$(request GET "${BASE_URL}/new?url=${FIXTURE_URL}")"
TARGET_B="$(printf '%s' "${TARGET_B_JSON}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).targetId")"
[ -n "${TARGET_B}" ] || fail "target B creation failed"

CLICK_A="$(request POST "${BASE_URL}/click?target=${TARGET_A}" '#click-btn')"
assert_contains "${CLICK_A}" '"clicked":true' "target A click"
CLICK_A_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_A}" 'document.body.dataset.clicked || null')"
assert_contains "${CLICK_A_STATE}" '"value":"true"' "target A click state"
CLICK_B_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_B}" 'document.body.dataset.clicked || null')"
assert_contains "${CLICK_B_STATE}" '"value":null' "target B isolation"

curl -s -D "${PNG_HEADERS}" -o "${PNG_FILE}" "${BASE_URL}/screenshot?target=${TARGET_A}" >/dev/null
assert_file_nonempty "${PNG_FILE}" "binary screenshot file"
assert_png_file "${PNG_FILE}" "binary screenshot file format"
PNG_HEADER_TEXT="$(cat "${PNG_HEADERS}")"
assert_contains "${PNG_HEADER_TEXT}" 'Content-Type: image/png' "binary screenshot content-type"

SETFILES_BODY="$(printf '{"selector":"#multi-file-input","files":["%s","%s"]}' "${UPLOAD_A}" "${UPLOAD_B}")"
SETFILES_OK="$(request POST "${BASE_URL}/setFiles?target=${TARGET_A}" "${SETFILES_BODY}")"
assert_contains "${SETFILES_OK}" '"success":true' "setFiles multi-file response"
assert_contains "${SETFILES_OK}" '"files":2' "setFiles multi-file count"
SETFILES_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_A}" '(() => ({count: document.body.dataset.fileCount, names: document.body.dataset.fileNames, filesLength: document.querySelector("#multi-file-input").files.length}))()')"
assert_contains "${SETFILES_STATE}" '"count":"2"' "setFiles multi-file onchange count"
assert_contains "${SETFILES_STATE}" "$(basename "${UPLOAD_A}")|$(basename "${UPLOAD_B}")" "setFiles multi-file names"
assert_contains "${SETFILES_STATE}" '"filesLength":2' "setFiles multi-file DOM count"

STATUS="$(request_with_status GET "${BASE_URL}/info?target=INVALID_TARGET")"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "404" ] || fail "info invalid target should return 404, got ${STATUS}"
assert_contains "${BODY}" 'No target with given id found' "info invalid target message"

STATUS="$(request_with_status GET "${BASE_URL}/scroll?target=INVALID_TARGET")"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "404" ] || fail "scroll invalid target should return 404, got ${STATUS}"
assert_contains "${BODY}" 'No target with given id found' "scroll invalid target message"

STATUS="$(request_with_status GET "${BASE_URL}/back?target=INVALID_TARGET")"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "404" ] || fail "back invalid target should return 404, got ${STATUS}"
assert_contains "${BODY}" 'No target with given id found' "back invalid target message"

STATUS="$(request_with_status POST "${BASE_URL}/eval?target=INVALID_TARGET" 'document.title')"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "404" ] || fail "eval invalid target should return 404, got ${STATUS}"
assert_contains "${BODY}" 'No target with given id found' "eval invalid target message"

STATUS="$(request_with_status GET "${BASE_URL}/screenshot?target=INVALID_TARGET&file=${PNG_FILE}")"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "404" ] || fail "screenshot invalid target should return 404, got ${STATUS}"
assert_contains "${BODY}" 'No target with given id found' "screenshot invalid target message"

echo "PASS: academic-search release-test"
