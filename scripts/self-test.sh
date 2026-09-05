#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROXY_PORT="${CDP_PROXY_PORT:-0}"
BASE_URL="http://127.0.0.1:${PROXY_PORT}"
PROXY_PID=""
TEST_DIR="$(mktemp -d /tmp/academic-search-self-test.XXXXXX)"
PROXY_LOG="${TEST_DIR}/proxy.log"
TARGET_ID=""
FIXTURE_HTML=""
SHOT_FILE=""
JPEG_FILE=""
NAV_HTML=""
UPLOAD_FILE=""
HTTP_BODY_FILE="${TEST_DIR}/http_body_file.txt"

cleanup() {
  rm -f "${PROXY_LOG}" "${HTTP_BODY_FILE}" >/dev/null 2>&1 || true
  if [ -n "${TARGET_ID}" ]; then
    curl -s "${BASE_URL}/close?target=${TARGET_ID}" >/dev/null 2>&1 || true
  fi
  if [ -n "${PROXY_PID}" ]; then
    kill "${PROXY_PID}" >/dev/null 2>&1 || true
    wait "${PROXY_PID}" 2>/dev/null || true
  fi
  if [ -n "${FIXTURE_HTML}" ]; then
    rm -f "${FIXTURE_HTML}" >/dev/null 2>&1 || true
  fi
  if [ -n "${SHOT_FILE}" ]; then
    rm -f "${SHOT_FILE}" >/dev/null 2>&1 || true
  fi
  if [ -n "${JPEG_FILE}" ]; then
    rm -f "${JPEG_FILE}" >/dev/null 2>&1 || true
  fi
  if [ -n "${NAV_HTML}" ]; then
    rm -f "${NAV_HTML}" >/dev/null 2>&1 || true
  fi
  if [ -n "${UPLOAD_FILE}" ]; then
    rm -f "${UPLOAD_FILE}" >/dev/null 2>&1 || true
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

assert_jpeg_file() {
  local file="$1"
  local label="$2"
  local header
  header="$(LC_ALL=C od -An -t x1 -N 3 "${file}" | tr -d ' \n')"
  if [[ "${header}" != ff* ]]; then
    fail "${label} -- expected JPEG header, got ${header}"
  fi
  if [ "${header}" != "ffd8ff" ]; then
    fail "${label} -- expected JPEG header prefix ffd8ff, got ${header}"
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
SHOT_FILE="${TEST_DIR}/shot_file.png"
JPEG_FILE="${TEST_DIR}/jpeg_file.jpg"
NAV_HTML="${TEST_DIR}/nav_html.html"
UPLOAD_FILE="${TEST_DIR}/upload_file.txt"
printf 'academic-search upload fixture\n' > "${UPLOAD_FILE}"
printf '%s' '<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>academic-search self-test fixture</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    .toolbar { position: sticky; top: 0; padding: 12px; background: #f5f5f5; }
    .spacer { height: 3200px; background: linear-gradient(#ffffff, #dbeafe); }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="click-btn" onclick="document.body.dataset.clicked='\''true'\''">click</button>
    <button id="real-btn" onclick="document.body.dataset.realClick='\''true'\''">clickAt</button>
    <input id="file-input" type="file" onchange="document.body.dataset.fileCount=String(this.files.length); document.body.dataset.fileName=this.files[0]?.name || '\'''\''" />
  </div>
  <div class="spacer"></div>
</body>
</html>' > "${FIXTURE_HTML}"
printf '%s' '<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>academic-search navigation fixture</title>
</head>
<body>
  <main id="nav-root">navigation target</main>
</body>
</html>' > "${NAV_HTML}"

start_proxy

node "${SCRIPT_DIR}/browser-smoke.mjs" "${BASE_URL}" "${PROXY_PID}"

TARGET_JSON="$(request GET "${BASE_URL}/new?url=about:blank")"
TARGET_ID="$(printf '%s' "${TARGET_JSON}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).targetId")"
[ -n "${TARGET_ID}" ] || fail "new endpoint did not return targetId"

INFO="$(request GET "${BASE_URL}/info?target=${TARGET_ID}")"
assert_contains "${INFO}" '"url":"about:blank"' "info endpoint"

EVAL_OK="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" 'document.title')"
assert_contains "${EVAL_OK}" '"value":""' "eval endpoint"

STATUS="$(request_with_status POST "${BASE_URL}/eval" 'document.title')"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "400" ] || fail "eval without target should return 400, got ${STATUS}"
assert_contains "${BODY}" '缺少必填参数: target' "eval missing target"

STATUS="$(request_with_status POST "${BASE_URL}/setFiles?target=${TARGET_ID}" '{bad json}')"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "400" ] || fail "setFiles malformed JSON should return 400, got ${STATUS}"
assert_contains "${BODY}" 'POST body 需要合法 JSON' "setFiles malformed JSON"

STATUS="$(request_with_status GET "${BASE_URL}/navigate?target=${TARGET_ID}")"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "400" ] || fail "navigate without url should return 400, got ${STATUS}"
assert_contains "${BODY}" '缺少必填参数: url' "navigate missing url"

STATUS="$(request_with_status GET "${BASE_URL}/close")"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "400" ] || fail "close without target should return 400, got ${STATUS}"
assert_contains "${BODY}" '缺少必填参数: target' "close missing target"

CLOSE_OK="$(request GET "${BASE_URL}/close?target=${TARGET_ID}")"
assert_contains "${CLOSE_OK}" '"success":true' "close endpoint"
TARGET_ID=""

FIXTURE_URL="file://${FIXTURE_HTML}"
TARGET_JSON="$(request GET "${BASE_URL}/new?url=${FIXTURE_URL}")"
TARGET_ID="$(printf '%s' "${TARGET_JSON}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).targetId")"
[ -n "${TARGET_ID}" ] || fail "fixture page did not return targetId"

CLICK_OK="$(request POST "${BASE_URL}/click?target=${TARGET_ID}" '#click-btn')"
assert_contains "${CLICK_OK}" '"clicked":true' "click endpoint"
CLICK_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" 'document.body.dataset.clicked')"
assert_contains "${CLICK_STATE}" '"value":"true"' "click effect"

STATUS="$(request_with_status POST "${BASE_URL}/click?target=${TARGET_ID}" '#missing-btn')"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "400" ] || fail "click missing element should return 400, got ${STATUS}"
assert_contains "${BODY}" '未找到元素: #missing-btn' "click missing element"

CLICK_AT_OK="$(request POST "${BASE_URL}/clickAt?target=${TARGET_ID}" '#real-btn')"
assert_contains "${CLICK_AT_OK}" '"clicked":true' "clickAt endpoint"
CLICK_AT_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" 'document.body.dataset.realClick')"
assert_contains "${CLICK_AT_STATE}" '"value":"true"' "clickAt effect"

STATUS="$(request_with_status POST "${BASE_URL}/clickAt?target=${TARGET_ID}" '#missing-real-btn')"
BODY="$(cat "${HTTP_BODY_FILE}")"
[ "${STATUS}" = "400" ] || fail "clickAt missing element should return 400, got ${STATUS}"
assert_contains "${BODY}" '未找到元素: #missing-real-btn' "clickAt missing element"

SCROLL_OK="$(request GET "${BASE_URL}/scroll?target=${TARGET_ID}&y=700")"
assert_contains "${SCROLL_OK}" 'scrolled down 700px' "scroll endpoint"
SCROLL_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" 'window.scrollY')"
assert_contains "${SCROLL_STATE}" '"value":700' "scroll effect"

SCROLL_UP_OK="$(request GET "${BASE_URL}/scroll?target=${TARGET_ID}&y=200&direction=up")"
assert_contains "${SCROLL_UP_OK}" 'scrolled up 200px' "scroll up endpoint"
SCROLL_UP_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" 'window.scrollY')"
assert_contains "${SCROLL_UP_STATE}" '"value":500' "scroll up effect"

SCROLL_BOTTOM_OK="$(request GET "${BASE_URL}/scroll?target=${TARGET_ID}&direction=bottom")"
assert_contains "${SCROLL_BOTTOM_OK}" 'scrolled to bottom' "scroll bottom endpoint"
SCROLL_BOTTOM_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" 'window.innerHeight + window.scrollY >= document.body.scrollHeight - 5')"
assert_contains "${SCROLL_BOTTOM_STATE}" '"value":true' "scroll bottom effect"

SCROLL_TOP_OK="$(request GET "${BASE_URL}/scroll?target=${TARGET_ID}&direction=top")"
assert_contains "${SCROLL_TOP_OK}" 'scrolled to top' "scroll top endpoint"
SCROLL_TOP_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" 'window.scrollY')"
assert_contains "${SCROLL_TOP_STATE}" '"value":0' "scroll top effect"

SCREENSHOT_OK="$(request GET "${BASE_URL}/screenshot?target=${TARGET_ID}&file=${SHOT_FILE}")"
assert_contains "${SCREENSHOT_OK}" "\"saved\":\"${SHOT_FILE}\"" "screenshot endpoint"
assert_file_nonempty "${SHOT_FILE}" "screenshot file"
assert_png_file "${SHOT_FILE}" "screenshot file format"

JPEG_SCREENSHOT_OK="$(request GET "${BASE_URL}/screenshot?target=${TARGET_ID}&format=jpeg&file=${JPEG_FILE}")"
assert_contains "${JPEG_SCREENSHOT_OK}" "\"saved\":\"${JPEG_FILE}\"" "jpeg screenshot endpoint"
assert_file_nonempty "${JPEG_FILE}" "jpeg screenshot file"
assert_jpeg_file "${JPEG_FILE}" "jpeg screenshot file format"

SETFILES_BODY="$(printf '{"selector":"#file-input","files":["%s"]}' "${UPLOAD_FILE}")"
SETFILES_OK="$(request POST "${BASE_URL}/setFiles?target=${TARGET_ID}" "${SETFILES_BODY}")"
assert_contains "${SETFILES_OK}" '"success":true' "setFiles endpoint"
assert_contains "${SETFILES_OK}" '"files":1' "setFiles response count"
SETFILES_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" '(() => ({count: document.body.dataset.fileCount, name: document.body.dataset.fileName, filesLength: document.querySelector("#file-input").files.length}))()')"
assert_contains "${SETFILES_STATE}" '"count":"1"' "setFiles onchange count"
assert_contains "${SETFILES_STATE}" "\"name\":\"$(basename "${UPLOAD_FILE}")\"" "setFiles filename"
assert_contains "${SETFILES_STATE}" '"filesLength":1' "setFiles DOM files length"

NAV_URL="file://${NAV_HTML}"
NAVIGATE_OK="$(request GET "${BASE_URL}/navigate?target=${TARGET_ID}&url=${NAV_URL}")"
assert_contains "${NAVIGATE_OK}" '"load_status":"complete"' "navigate load status"
assert_contains "${NAVIGATE_OK}" '"frameId"' "navigate endpoint"
NAV_INFO="$(request GET "${BASE_URL}/info?target=${TARGET_ID}")"
assert_contains "${NAV_INFO}" '"title":"academic-search navigation fixture"' "navigate effect"

BACK_OK="$(request GET "${BASE_URL}/back?target=${TARGET_ID}")"
assert_contains "${BACK_OK}" '"load_status":"complete"' "back load status"
assert_contains "${BACK_OK}" '"ok":true' "back endpoint"
BACK_INFO="$(request GET "${BASE_URL}/info?target=${TARGET_ID}")"
assert_contains "${BACK_INFO}" '"title":"academic-search self-test fixture"' "back effect"

FIXTURE_CLOSE_OK="$(request GET "${BASE_URL}/close?target=${TARGET_ID}")"
assert_contains "${FIXTURE_CLOSE_OK}" '"success":true' "fixture close endpoint"
TARGET_ID=""

echo "PASS: academic-search proxy self-test"
