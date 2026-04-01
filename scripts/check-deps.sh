#!/usr/bin/env bash
# academic-search: 环境检查 + 确保 CDP Proxy 就绪

PROXY_PORT="${CDP_PROXY_PORT:-3456}"

# Node.js 检查
if command -v node &>/dev/null; then
  NODE_VER=$(node --version 2>/dev/null)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
    echo "node: ok ($NODE_VER)"
  else
    echo "node: warn ($NODE_VER, 建议升级到 22+，低版本需安装 ws 模块)"
  fi
else
  echo "node: missing — CDP 浏览器模式不可用（Google Scholar 等需要）；arXiv/S2/PubMed 等 API 模式仍可正常使用"
fi

# curl 检查（API 调用必需）
if command -v curl &>/dev/null; then
  echo "curl: ok"
else
  echo "curl: missing — 请安装 curl"
  exit 1
fi

# Chrome 调试端口检查
if ! CHROME_PORT=$(node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1');
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function activePortFiles() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  switch (process.platform) {
    case 'darwin':
      return [
        path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
      ];
    case 'linux':
      return [
        path.join(home, '.config/google-chrome/DevToolsActivePort'),
        path.join(home, '.config/chromium/DevToolsActivePort'),
      ];
    case 'win32':
      return [
        path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
        path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
      ];
    default:
      return [];
  }
}

(async () => {
  for (const filePath of activePortFiles()) {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536 && await checkPort(port)) {
        console.log(port);
        process.exit(0);
      }
    } catch (_) {}
  }
  for (const port of [9222, 9229, 9333]) {
    if (await checkPort(port)) {
      console.log(port);
      process.exit(0);
    }
  }
  process.exit(1);
})();
" 2>/dev/null); then
  echo "chrome: not connected — 请打开 chrome://inspect/#remote-debugging 并勾选 Allow remote debugging"
  echo "  注：Chrome 调试连接仅在访问需要浏览器自动化的平台（如 Google Scholar）时必需"
  echo "  使用 arXiv、Semantic Scholar、PubMed 等 API 平台无需此步骤"
  # Chrome 未连接不阻断退出，API 平台仍可正常使用
else
  echo "chrome: ok (port $CHROME_PORT)"
fi

# CDP Proxy 检查（仅在 Chrome 可用时启动）
if [ -n "$CHROME_PORT" ]; then
  TARGETS=$(curl -s --connect-timeout 3 "http://127.0.0.1:${PROXY_PORT}/targets" 2>/dev/null)
  if echo "$TARGETS" | grep -q '^\['; then
    echo "proxy: ready (port $PROXY_PORT)"
  else
    echo "proxy: connecting (port $PROXY_PORT)..."
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    node "$SCRIPT_DIR/cdp-proxy.mjs" > /tmp/academic-search-cdp-proxy.log 2>&1 &
    sleep 2
    for i in $(seq 1 15); do
      curl -s --connect-timeout 5 --max-time 8 "http://127.0.0.1:${PROXY_PORT}/targets" 2>/dev/null | grep -q '^\[' && echo "proxy: ready (port $PROXY_PORT)" && exit 0
      [ $i -eq 1 ] && echo "⚠️  Chrome 可能有授权弹窗，请点击「允许」后等待连接..."
    done
    echo "❌ 连接超时，请检查 Chrome 调试设置"
    exit 1
  fi
else
  echo "proxy: skipped (Chrome 未连接，API 模式不需要 proxy)"
fi
