#!/usr/bin/env bash
# Run only when bundled browser access is needed; --api-only never launches Chrome.
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo 'curl: missing — 请安装 curl' >&2
  exit 1
fi
echo 'curl: ok'
if [ "${1:-}" = '--api-only' ]; then
  echo 'browser: skipped (API-only)'
  exit 0
fi
if [ "$#" -gt 0 ]; then
  echo 'Usage: check-deps.sh [--api-only]' >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'node: missing — 浏览器模式需要 Node.js 22+；API-only 无需 Node.js' >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo 'node: unsupported — 请升级到 Node.js 22+' >&2
  exit 1
fi
echo "node: ok ($(node --version))"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/ensure-proxy.mjs"
