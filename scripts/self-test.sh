#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROXY_PORT="${CDP_PROXY_PORT:-4568}"
BASE_URL="http://127.0.0.1:${PROXY_PORT}"
PROXY_PID=""
TARGET_ID=""
FIXTURE_HTML=""
SHOT_FILE=""
NAV_HTML=""

cleanup() {
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
  if [ -n "${NAV_HTML}" ]; then
    rm -f "${NAV_HTML}" >/dev/null 2>&1 || true
  fi
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
    curl -s -o /tmp/academic-search-self-test.body -w '%{http_code}' -X "${method}" "${url}" -d "${body}"
  else
    curl -s -o /tmp/academic-search-self-test.body -w '%{http_code}' -X "${method}" "${url}"
  fi
}

echo "Starting proxy on port ${PROXY_PORT}"
CDP_PROXY_PORT="${PROXY_PORT}" node "${SCRIPT_DIR}/cdp-proxy.mjs" >/tmp/academic-search-self-test.proxy.log 2>&1 &
PROXY_PID=$!

FIXTURE_HTML="$(mktemp /tmp/academic-search-self-test.XXXXXX.html)"
SHOT_FILE="$(mktemp /tmp/academic-search-self-test-shot.XXXXXX.png)"
NAV_HTML="$(mktemp /tmp/academic-search-self-test-nav.XXXXXX.html)"
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

HEALTH=""
for _ in $(seq 1 20); do
  HEALTH="$(curl -s "${BASE_URL}/health" 2>/dev/null || true)"
  if [[ "${HEALTH}" == *'"status":"ok"'* && "${HEALTH}" == *'"connected":true'* ]]; then
    break
  fi
  sleep 1
done

assert_contains "${HEALTH}" '"status":"ok"' "health endpoint"
assert_contains "${HEALTH}" '"connected":true' "health endpoint"

TARGET_JSON="$(request GET "${BASE_URL}/new?url=about:blank")"
TARGET_ID="$(printf '%s' "${TARGET_JSON}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).targetId")"
[ -n "${TARGET_ID}" ] || fail "new endpoint did not return targetId"

INFO="$(request GET "${BASE_URL}/info?target=${TARGET_ID}")"
assert_contains "${INFO}" '"url":"about:blank"' "info endpoint"

EVAL_OK="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" 'document.title')"
assert_contains "${EVAL_OK}" '"value":""' "eval endpoint"

STATUS="$(request_with_status POST "${BASE_URL}/eval" 'document.title')"
BODY="$(cat /tmp/academic-search-self-test.body)"
[ "${STATUS}" = "400" ] || fail "eval without target should return 400, got ${STATUS}"
assert_contains "${BODY}" '缺少必填参数: target' "eval missing target"

STATUS="$(request_with_status POST "${BASE_URL}/setFiles?target=${TARGET_ID}" '{bad json}')"
BODY="$(cat /tmp/academic-search-self-test.body)"
[ "${STATUS}" = "400" ] || fail "setFiles malformed JSON should return 400, got ${STATUS}"
assert_contains "${BODY}" 'POST body 需要合法 JSON' "setFiles malformed JSON"

STATUS="$(request_with_status GET "${BASE_URL}/navigate?target=${TARGET_ID}")"
BODY="$(cat /tmp/academic-search-self-test.body)"
[ "${STATUS}" = "400" ] || fail "navigate without url should return 400, got ${STATUS}"
assert_contains "${BODY}" '缺少必填参数: url' "navigate missing url"

STATUS="$(request_with_status GET "${BASE_URL}/close")"
BODY="$(cat /tmp/academic-search-self-test.body)"
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
BODY="$(cat /tmp/academic-search-self-test.body)"
[ "${STATUS}" = "400" ] || fail "click missing element should return 400, got ${STATUS}"
assert_contains "${BODY}" '未找到元素: #missing-btn' "click missing element"

CLICK_AT_OK="$(request POST "${BASE_URL}/clickAt?target=${TARGET_ID}" '#real-btn')"
assert_contains "${CLICK_AT_OK}" '"clicked":true' "clickAt endpoint"
CLICK_AT_STATE="$(request POST "${BASE_URL}/eval?target=${TARGET_ID}" 'document.body.dataset.realClick')"
assert_contains "${CLICK_AT_STATE}" '"value":"true"' "clickAt effect"

STATUS="$(request_with_status POST "${BASE_URL}/clickAt?target=${TARGET_ID}" '#missing-real-btn')"
BODY="$(cat /tmp/academic-search-self-test.body)"
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

NAV_URL="file://${NAV_HTML}"
NAVIGATE_OK="$(request GET "${BASE_URL}/navigate?target=${TARGET_ID}&url=${NAV_URL}")"
assert_contains "${NAVIGATE_OK}" '"frameId"' "navigate endpoint"
NAV_INFO="$(request GET "${BASE_URL}/info?target=${TARGET_ID}")"
assert_contains "${NAV_INFO}" '"title":"academic-search navigation fixture"' "navigate effect"

BACK_OK="$(request GET "${BASE_URL}/back?target=${TARGET_ID}")"
assert_contains "${BACK_OK}" '"ok":true' "back endpoint"
BACK_INFO="$(request GET "${BASE_URL}/info?target=${TARGET_ID}")"
assert_contains "${BACK_INFO}" '"title":"academic-search self-test fixture"' "back effect"

FIXTURE_CLOSE_OK="$(request GET "${BASE_URL}/close?target=${TARGET_ID}")"
assert_contains "${FIXTURE_CLOSE_OK}" '"success":true' "fixture close endpoint"
TARGET_ID=""

echo "PASS: academic-search proxy self-test"
