#!/usr/bin/env node
// CDP Proxy for academic-search skill
// 通过 HTTP API 操控用户日常 Chrome，用于访问需要浏览器自动化的学术平台
// 要求：Chrome 已开启远程调试（chrome://inspect/#remote-debugging）
// Node.js 22+（使用原生 WebSocket）

import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

const PORT = parseInt(process.env.CDP_PROXY_PORT || '3456');
let ws = null;
let cmdId = 0;
const pending = new Map(); // id -> {resolve, timer}
const sessions = new Map(); // targetId -> sessionId

// --- WebSocket 兼容层 ---
let WS;
if (typeof globalThis.WebSocket !== 'undefined') {
  // Node 22+ 原生 WebSocket
  WS = globalThis.WebSocket;
} else {
  // 回退到 ws 模块
  try {
    WS = (await import('ws')).default;
  } catch {
    console.error('[CDP Proxy] 错误：Node.js 版本 < 22 且未安装 ws 模块');
    console.error('  解决方案：升级到 Node.js 22+ 或执行 npm install -g ws');
    process.exit(1);
  }
}

// --- 自动发现 Chrome 调试端口 ---
async function discoverChromePort() {
  // 1. 优先读取 DevToolsActivePort 文件（Chrome 运行时写入）
  const possiblePaths = [];
  const platform = os.platform();

  if (platform === 'darwin') {
    const home = os.homedir();
    possiblePaths.push(
      path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
    );
  } else if (platform === 'linux') {
    const home = os.homedir();
    possiblePaths.push(
      path.join(home, '.config/google-chrome/DevToolsActivePort'),
      path.join(home, '.config/chromium/DevToolsActivePort'),
    );
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    possiblePaths.push(
      path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
    );
  }

  for (const p of possiblePaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8').trim();
      const lines = content.split('\n');
      const port = parseInt(lines[0]);
      if (port > 0 && port < 65536) {
        const ok = await checkPort(port);
        if (ok) {
          const wsPath = lines[1] || null;
          console.log(`[CDP Proxy] 从 DevToolsActivePort 发现端口: ${port}${wsPath ? ' (带 wsPath)' : ''}`);
          return { port, wsPath };
        }
      }
    } catch { /* 文件不存在，继续 */ }
  }

  // 2. 扫描常用端口，并通过 /json/version 获取真实 WebSocket 路径
  const commonPorts = [9222, 9229, 9333];
  for (const port of commonPorts) {
    const ok = await checkPort(port);
    if (ok) {
      const wsPath = await fetchWsPath(port);
      console.log(`[CDP Proxy] 扫描发现 Chrome 调试端口: ${port}${wsPath ? ' (带 wsPath)' : ''}`);
      return { port, wsPath };
    }
  }

  return null;
}

// 从 /json/version 获取 Chrome 的真实 WebSocket debugger URL 路径（含 UUID）
async function fetchWsPath(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const url = json.webSocketDebuggerUrl; // e.g. ws://127.0.0.1:PORT/devtools/browser/UUID
          if (url) {
            const parsed = new URL(url);
            resolve(parsed.pathname); // 仅返回路径部分
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// TCP 探测端口（避免 WebSocket 探测触发 Chrome 安全弹窗）
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1');
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function getWebSocketUrl(port, wsPath) {
  if (wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
  return `ws://127.0.0.1:${port}/devtools/browser`;
}

// --- WebSocket 连接管理 ---
let chromePort = null;
let chromeWsPath = null;
let connectingPromise = null;

async function connect() {
  if (ws && (ws.readyState === WS.OPEN || ws.readyState === 1)) return;
  if (connectingPromise) return connectingPromise;

  if (!chromePort) {
    const discovered = await discoverChromePort();
    if (!discovered) {
      throw new Error(
        'Chrome 未开启远程调试端口。\n' +
        '请在 Chrome 地址栏打开 chrome://inspect/#remote-debugging\n' +
        '勾选 "Allow remote debugging for this browser instance" 后重试。'
      );
    }
    chromePort = discovered.port;
    chromeWsPath = discovered.wsPath;
  }

  const wsUrl = getWebSocketUrl(chromePort, chromeWsPath);

  return connectingPromise = new Promise((resolve, reject) => {
    ws = new WS(wsUrl);

    const onOpen = () => {
      cleanup();
      connectingPromise = null;
      console.log(`[CDP Proxy] 已连接 Chrome (端口 ${chromePort})`);
      resolve();
    };
    const onError = (e) => {
      cleanup();
      connectingPromise = null;
      const msg = e.message || e.error?.message || '连接失败';
      console.error('[CDP Proxy] 连接错误:', msg);
      reject(new Error(msg));
    };
    const onClose = () => {
      console.log('[CDP Proxy] 连接断开');
      ws = null;
      chromePort = null;
      chromeWsPath = null;
      sessions.clear();
    };
    const onMessage = (evt) => {
      const data = typeof evt === 'string' ? evt : (evt.data || evt);
      const msg = JSON.parse(typeof data === 'string' ? data : data.toString());

      if (msg.method === 'Target.attachedToTarget') {
        const { sessionId, targetInfo } = msg.params;
        sessions.set(targetInfo.targetId, sessionId);
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        resolve(msg);
      }
    };

    function cleanup() {
      ws.removeEventListener?.('open', onOpen);
      ws.removeEventListener?.('error', onError);
    }

    if (ws.on) {
      ws.on('open', onOpen);
      ws.on('error', onError);
      ws.on('close', onClose);
      ws.on('message', onMessage);
    } else {
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
      ws.addEventListener('message', onMessage);
    }
  });
}

function sendCDP(method, params = {}, sessionId = null) {
  return new Promise((resolve, reject) => {
    if (!ws || (ws.readyState !== WS.OPEN && ws.readyState !== 1)) {
      return reject(new Error('WebSocket 未连接'));
    }
    const id = ++cmdId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP 命令超时: ' + method));
    }, 30000);
    pending.set(id, { resolve, timer });
    ws.send(JSON.stringify(msg));
  });
}

function sendCDPChecked(method, params = {}, sessionId = null) {
  return sendCDP(method, params, sessionId).then((resp) => {
    if (resp?.error) {
      const err = new Error(resp.error.message || `CDP error: ${method}`);
      err.code = resp.error.code;
      err.data = resp.error.data;
      err.statusCode = resp.error.code === -32602 ? 400 : 502;
      throw err;
    }
    return resp;
  });
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function requireQueryParam(res, value, name) {
  if (value) return true;
  json(res, 400, { error: `缺少必填参数: ${name}` });
  return false;
}

async function ensureSession(targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);
  const resp = await sendCDPChecked('Target.attachToTarget', { targetId, flatten: true });
  if (resp.result?.sessionId) {
    sessions.set(targetId, resp.result.sessionId);
    return resp.result.sessionId;
  }
  throw new Error('attach 失败: ' + JSON.stringify(resp.error));
}

// --- 等待页面加载 ---
async function waitForLoad(sessionId, timeoutMs = 15000) {
  await sendCDP('Page.enable', {}, sessionId);

  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearInterval(checkInterval);
      resolve(result);
    };

    const timer = setTimeout(() => done('timeout'), timeoutMs);
    const checkInterval = setInterval(async () => {
      try {
        const resp = await sendCDP('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        }, sessionId);
        if (resp.result?.result?.value === 'complete') {
          done('complete');
        }
      } catch { /* 忽略 */ }
    }, 500);
  });
}

// --- 读取 POST body ---
async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

// --- HTTP API ---
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const q = Object.fromEntries(parsed.searchParams);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    if (pathname === '/health') {
      const connected = ws && (ws.readyState === WS.OPEN || ws.readyState === 1);
      res.end(JSON.stringify({ status: 'ok', connected, sessions: sessions.size, chromePort }));
      return;
    }

    await connect();

    // GET /targets
    if (pathname === '/targets') {
      const resp = await sendCDPChecked('Target.getTargets');
      const pages = resp.result.targetInfos.filter(t => t.type === 'page');
      res.end(JSON.stringify(pages, null, 2));
    }

    // GET /new?url=xxx
    else if (pathname === '/new') {
      const targetUrl = q.url || 'about:blank';
      const resp = await sendCDPChecked('Target.createTarget', { url: targetUrl, background: true });
      const targetId = resp.result.targetId;

      if (targetUrl !== 'about:blank') {
        try {
          const sid = await ensureSession(targetId);
          await waitForLoad(sid);
        } catch { /* 非致命 */ }
      }

      res.end(JSON.stringify({ targetId }));
    }

    // GET /close?target=xxx
    else if (pathname === '/close') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const resp = await sendCDPChecked('Target.closeTarget', { targetId: q.target });
      if (!resp.result?.success) {
        json(res, 404, { error: `未找到或无法关闭 target: ${q.target}` });
        return;
      }
      sessions.delete(q.target);
      res.end(JSON.stringify(resp.result));
    }

    // GET /navigate?target=xxx&url=yyy
    else if (pathname === '/navigate') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      if (!requireQueryParam(res, q.url, 'url')) return;
      const sid = await ensureSession(q.target);
      const resp = await sendCDPChecked('Page.navigate', { url: q.url }, sid);
      await waitForLoad(sid);
      res.end(JSON.stringify(resp.result));
    }

    // GET /back?target=xxx
    else if (pathname === '/back') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const sid = await ensureSession(q.target);
      await sendCDPChecked('Runtime.evaluate', { expression: 'history.back()' }, sid);
      await waitForLoad(sid);
      res.end(JSON.stringify({ ok: true }));
    }

    // POST /eval?target=xxx
    else if (pathname === '/eval') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const sid = await ensureSession(q.target);
      const body = await readBody(req);
      const expr = body || q.expr || 'document.title';
      const resp = await sendCDPChecked('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      }, sid);
      if (resp.result?.result?.value !== undefined) {
        res.end(JSON.stringify({ value: resp.result.result.value }));
      } else if (resp.result?.exceptionDetails) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: resp.result.exceptionDetails.text }));
      } else {
        res.end(JSON.stringify(resp.result));
      }
    }

    // POST /click?target=xxx
    else if (pathname === '/click') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const sid = await ensureSession(q.target);
      const selector = await readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'POST body 需要 CSS 选择器' }));
        return;
      }
      const selectorJson = JSON.stringify(selector);
      const js = `(() => {
        const el = document.querySelector(${selectorJson});
        if (!el) return { error: '未找到元素: ' + ${selectorJson} };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { clicked: true, tag: el.tagName, text: (el.textContent || '').slice(0, 100) };
      })()`;
      const resp = await sendCDPChecked('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
        awaitPromise: true,
      }, sid);
      if (resp.result?.result?.value) {
        const val = resp.result.result.value;
        res.statusCode = val.error ? 400 : 200;
        res.end(JSON.stringify(val));
      } else {
        res.end(JSON.stringify(resp.result));
      }
    }

    // POST /clickAt?target=xxx
    else if (pathname === '/clickAt') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const sid = await ensureSession(q.target);
      const selector = await readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'POST body 需要 CSS 选择器' }));
        return;
      }
      const selectorJson = JSON.stringify(selector);
      const js = `(() => {
        const el = document.querySelector(${selectorJson});
        if (!el) return { error: '未找到元素: ' + ${selectorJson} };
        el.scrollIntoView({ block: 'center' });
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName, text: (el.textContent || '').slice(0, 100) };
      })()`;
      const coordResp = await sendCDPChecked('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
        awaitPromise: true,
      }, sid);
      const coord = coordResp.result?.result?.value;
      if (!coord || coord.error) {
        res.statusCode = 400;
        res.end(JSON.stringify(coord || coordResp.result));
        return;
      }
      await sendCDPChecked('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: coord.x, y: coord.y, button: 'left', clickCount: 1
      }, sid);
      await sendCDPChecked('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: coord.x, y: coord.y, button: 'left', clickCount: 1
      }, sid);
      res.end(JSON.stringify({ clicked: true, x: coord.x, y: coord.y, tag: coord.tag, text: coord.text }));
    }

    // POST /setFiles?target=xxx
    else if (pathname === '/setFiles') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const sid = await ensureSession(q.target);
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        json(res, 400, { error: 'POST body 需要合法 JSON' });
        return;
      }
      if (!body.selector || !Array.isArray(body.files) || body.files.length === 0) {
        json(res, 400, { error: '需要 selector 和非空 files 数组字段' });
        return;
      }
      await sendCDPChecked('DOM.enable', {}, sid);
      const doc = await sendCDPChecked('DOM.getDocument', {}, sid);
      const node = await sendCDPChecked('DOM.querySelector', {
        nodeId: doc.result.root.nodeId,
        selector: body.selector
      }, sid);
      if (!node.result?.nodeId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: '未找到元素: ' + body.selector }));
        return;
      }
      await sendCDPChecked('DOM.setFileInputFiles', {
        nodeId: node.result.nodeId,
        files: body.files
      }, sid);
      res.end(JSON.stringify({ success: true, files: body.files.length }));
    }

    // GET /scroll?target=xxx&y=3000&direction=down
    else if (pathname === '/scroll') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const sid = await ensureSession(q.target);
      const y = parseInt(q.y || '3000');
      const direction = q.direction || 'down';
      let js;
      if (direction === 'top') {
        js = 'window.scrollTo(0, 0); "scrolled to top"';
      } else if (direction === 'bottom') {
        js = 'window.scrollTo(0, document.body.scrollHeight); "scrolled to bottom"';
      } else if (direction === 'up') {
        js = `window.scrollBy(0, -${Math.abs(y)}); "scrolled up ${Math.abs(y)}px"`;
      } else {
        js = `window.scrollBy(0, ${Math.abs(y)}); "scrolled down ${Math.abs(y)}px"`;
      }
      const resp = await sendCDPChecked('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
      }, sid);
      await new Promise(r => setTimeout(r, 800));
      res.end(JSON.stringify({ value: resp.result?.result?.value }));
    }

    // GET /screenshot?target=xxx&file=/tmp/x.png
    else if (pathname === '/screenshot') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const sid = await ensureSession(q.target);
      const format = q.format || 'png';
      const resp = await sendCDPChecked('Page.captureScreenshot', {
        format,
        quality: format === 'jpeg' ? 80 : undefined,
      }, sid);
      if (q.file) {
        fs.writeFileSync(q.file, Buffer.from(resp.result.data, 'base64'));
        res.end(JSON.stringify({ saved: q.file }));
      } else {
        res.setHeader('Content-Type', 'image/' + format);
        res.end(Buffer.from(resp.result.data, 'base64'));
      }
    }

    // GET /info?target=xxx
    else if (pathname === '/info') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const sid = await ensureSession(q.target);
      const resp = await sendCDPChecked('Runtime.evaluate', {
        expression: 'JSON.stringify({title: document.title, url: location.href, ready: document.readyState})',
        returnByValue: true,
      }, sid);
      res.end(resp.result?.result?.value || '{}');
    }

    else {
      res.statusCode = 404;
      res.end(JSON.stringify({
        error: '未知端点',
        endpoints: {
          '/health': 'GET - 健康检查',
          '/targets': 'GET - 列出所有页面 tab',
          '/new?url=': 'GET - 创建新后台 tab',
          '/close?target=': 'GET - 关闭 tab',
          '/navigate?target=&url=': 'GET - 导航',
          '/back?target=': 'GET - 后退',
          '/info?target=': 'GET - 页面信息',
          '/eval?target=': 'POST body=JS - 执行 JS',
          '/click?target=': 'POST body=CSS选择器 - 点击元素',
          '/clickAt?target=': 'POST body=CSS选择器 - 真实鼠标点击',
          '/setFiles?target=': 'POST body=JSON - 文件上传',
          '/scroll?target=&y=&direction=': 'GET - 滚动页面',
          '/screenshot?target=&file=': 'GET - 截图',
        },
      }));
    }
  } catch (e) {
    json(res, e.statusCode || 500, { error: e.message });
  }
});

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port, '127.0.0.1');
  });
}

async function main() {
  const available = await checkPortAvailable(PORT);
  if (!available) {
    try {
      const ok = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${PORT}/health`, { timeout: 2000 }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve(d.includes('"ok"')));
        }).on('error', () => resolve(false));
      });
      if (ok) {
        console.log(`[CDP Proxy] 已有实例运行在端口 ${PORT}，退出`);
        process.exit(0);
      }
    } catch { /* 端口被占用但非 proxy */ }
    console.error(`[CDP Proxy] 端口 ${PORT} 已被占用`);
    process.exit(1);
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[CDP Proxy] academic-search 运行在 http://localhost:${PORT}`);
    connect().catch(e => console.error('[CDP Proxy] 初始连接失败:', e.message, '（将在首次请求时重试）'));
  });
}

process.on('uncaughtException', (e) => {
  console.error('[CDP Proxy] 未捕获异常:', e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('[CDP Proxy] 未处理拒绝:', e?.message || e);
});

main();
