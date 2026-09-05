#!/usr/bin/env node
// CDP Proxy for academic-search skill
// 通过 HTTP API 操控专用持久 Chrome profile 或显式配置的浏览器 endpoint
// 不发现日常 Chrome，不扫描调试端口，不读取日常 profile
// Node.js 22+（使用原生 WebSocket）

import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { browserConfigFromEnv, ensureBrowser } from './browser-runtime.mjs';
import { buildElementActionExpression, buildReadPageExpression, validatePressKey } from './browser-page.mjs';

const PORT = parseInt(process.env.CDP_PROXY_PORT || '3457');
const BROWSER_CONFIG = browserConfigFromEnv();
let browser = { mode: BROWSER_CONFIG.mode, endpoint: BROWSER_CONFIG.endpoint, profile_dir: BROWSER_CONFIG.profile_dir };
const INSTANCE_ID = randomUUID();
let ws = null;
let cmdId = 0;
const pending = new Map(); // id -> {resolve, reject, timer}
const sessions = new Map(); // targetId -> sessionId
const navigationVersions = new Map(); // sessionId -> main-document navigation generation
const mainFrames = new Map(); // sessionId -> frameId

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

// --- Explicit/managed browser connection ---
let chromePort = null;
let connectingPromise = null;

async function connect() {
  if (ws && (ws.readyState === WS.OPEN || ws.readyState === 1)) return;
  if (connectingPromise) return connectingPromise;
  const attempt = (async () => {
    const resolved = await ensureBrowser(BROWSER_CONFIG);
    browser = { mode: resolved.mode, endpoint: resolved.endpoint, profile_dir: resolved.profile_dir };
    chromePort = Number(new URL(resolved.endpoint).port || (resolved.endpoint.startsWith('https:') ? 443 : 80));
    const socket = new WS(resolved.webSocketDebuggerUrl);
    ws = socket;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeEventListener?.('open', onOpen);
        if (error) reject(error); else resolve();
      };
      const onOpen = () => {
        console.log(`[CDP Proxy] 已连接专用/显式 Chrome (${resolved.endpoint})`);
        finish();
      };
      const onError = event => {
        finish(apiError(event.message || event.error?.message || 'WebSocket 连接失败', 'CDP_CONNECTION_FAILED', 503));
        socket.close();
      };
      const onClose = () => {
        finish(apiError('WebSocket 连接已断开', 'CDP_DISCONNECTED', 503));
        // A delayed close from an older socket must not tear down a new connection.
        if (ws !== socket) return;
        for (const command of pending.values()) {
          clearTimeout(command.timer);
          command.reject(apiError('WebSocket 连接已断开', 'CDP_DISCONNECTED', 503));
        }
        pending.clear();
        ws = null;
        chromePort = null;
        sessions.clear();
        navigationVersions.clear();
        mainFrames.clear();
      };
      const onMessage = event => {
        if (ws !== socket) return;
        const data = typeof event === 'string' ? event : (event.data || event);
        const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
        if (msg.method === 'Target.attachedToTarget') {
          sessions.set(msg.params.targetInfo.targetId, msg.params.sessionId);
        }
        if (msg.method === 'Page.frameNavigated' && !msg.params.frame.parentId) {
          mainFrames.set(msg.sessionId, msg.params.frame.id);
          navigationVersions.set(msg.sessionId, (navigationVersions.get(msg.sessionId) || 0) + 1);
        }
        if (msg.method === 'Page.navigatedWithinDocument' && msg.params.frameId === mainFrames.get(msg.sessionId)) {
          navigationVersions.set(msg.sessionId, (navigationVersions.get(msg.sessionId) || 0) + 1);
        }
        if (msg.id && pending.has(msg.id)) {
          const { resolve, timer } = pending.get(msg.id);
          clearTimeout(timer);
          pending.delete(msg.id);
          resolve(msg);
        }
      };
      const timer = setTimeout(() => {
        finish(apiError('WebSocket 握手超时', 'CDP_CONNECT_TIMEOUT', 503));
        socket.close();
      }, BROWSER_CONFIG.connect_timeout_ms);
      if (socket.on) {
        socket.on('open', onOpen);
        socket.on('error', onError);
        socket.on('close', onClose);
        socket.on('message', onMessage);
      } else {
        socket.addEventListener('open', onOpen);
        socket.addEventListener('error', onError);
        socket.addEventListener('close', onClose);
        socket.addEventListener('message', onMessage);
      }
    });
  })();
  connectingPromise = attempt;
  try { return await attempt; }
  finally { if (connectingPromise === attempt) connectingPromise = null; }
}

function sendCDP(method, params = {}, sessionId = null, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!ws || (ws.readyState !== WS.OPEN && ws.readyState !== 1)) {
      return reject(apiError('WebSocket 未连接', 'CDP_DISCONNECTED', 503));
    }
    const id = ++cmdId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(apiError('CDP 命令超时: ' + method, 'CDP_TIMEOUT', 504));
    }, Math.max(1, timeoutMs));
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify(msg));
  });
}

function sendCDPChecked(method, params = {}, sessionId = null, timeoutMs = 30000) {
  return sendCDP(method, params, sessionId, timeoutMs).then((resp) => {
    if (resp?.error) {
      const detail = [resp.error.message, resp.error.data].filter(Boolean).join(' - ');
      const err = new Error(detail || `CDP error: ${method}`);
      err.code = 'CDP_ERROR';
      err.cdp_code = resp.error.code;
      err.data = resp.error.data;
      if (/No target with given id found|No session with given id|Target closed|Session closed/i.test(detail)) {
        err.statusCode = 404;
        err.code = 'TARGET_NOT_FOUND';
      } else {
        err.statusCode = resp.error.code === -32602 ? 400 : 502;
      }
      throw err;
    }
    return resp;
  });
}

function apiError(message, code, statusCode = 400, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, ...details });
}

function errorPayload(error) {
  return { error: error.message, code: error.code || 'INTERNAL_ERROR',
    ...(error.cdp_code !== undefined ? { cdp_code: error.cdp_code } : {}),
    ...(error.data !== undefined ? { data: error.data } : {}),
    ...(error.max_bytes !== undefined ? { max_bytes: error.max_bytes } : {}) };
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function requireQueryParam(res, value, name) {
  if (value) return true;
  json(res, 400, { error: `缺少必填参数: ${name}`, code: 'MISSING_PARAMETER', parameter: name });
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

// Poll sequentially and cap every CDP command at the remaining budget.
// document.readyState describes document loading, not application results.
function boundedInteger(value, fallback, name, min = 1, max = 60000) {
  const number = value === undefined ? fallback : value;
  if (!Number.isInteger(number) || number < min || number > max) {
    throw apiError(`${name} 必须是 ${min} 到 ${max} 的整数`, 'INVALID_ARGUMENT');
  }
  return number;
}

async function waitForLoad(sessionId, timeoutMs = 15000, navigationAfter = null) {
  const deadline = performance.now() + timeoutMs;
  try {
    await sendCDPChecked('Page.enable', {}, sessionId, timeoutMs);
    while (performance.now() < deadline) {
      if (navigationAfter !== null && (navigationVersions.get(sessionId) || 0) <= navigationAfter) {
        await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(0, deadline - performance.now()))));
        continue;
      }
      const resp = await sendCDPChecked('Runtime.evaluate', {
        expression: 'document.readyState', returnByValue: true,
      }, sessionId, deadline - performance.now());
      if (resp.result?.exceptionDetails) {
        throw apiError(resp.result.exceptionDetails.text, 'EVALUATION_FAILED', 502);
      }
      if (resp.result?.result?.value === 'complete') return { load_status: 'complete' };
      await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, deadline - performance.now()))));
    }
  } catch (error) {
    if (error.code !== 'CDP_TIMEOUT') return { load_status: 'error', ...errorPayload(error) };
  }
  return { load_status: 'timeout' };
}

const WAIT_STATES = new Set(['results_ready', 'blocked', 'empty', 'login_required', 'rate_limited']);
function validateWait(body) {
  if (!body || !Array.isArray(body.conditions) || body.conditions.length < 1 || body.conditions.length > 20) {
    throw apiError('conditions 必须包含 1 到 20 个条件', 'INVALID_ARGUMENT');
  }
  const conditions = body.conditions.map(condition => {
    if (!condition || !WAIT_STATES.has(condition.state) || typeof condition.selector !== 'string' ||
        !condition.selector.trim() || (condition.visible !== undefined && typeof condition.visible !== 'boolean')) {
      throw apiError('每个条件需要受支持的 state、CSS selector 和可选布尔 visible', 'INVALID_ARGUMENT');
    }
    return { state: condition.state, selector: condition.selector, visible: condition.visible ?? true };
  });
  return { conditions, timeout_ms: boundedInteger(body.timeout_ms, 15000, 'timeout_ms'),
    poll_ms: boundedInteger(body.poll_ms, 250, 'poll_ms', 1, 5000) };
}

// Serialized into the page. This function only reads current DOM state.
function observeConditions(conditions) {
  const diagnostics = [];
  let matched;
  for (const condition of conditions) {
    let elements;
    try { elements = Array.from(document.querySelectorAll(condition.selector)); }
    catch (error) { return { error: error.message, code: 'INVALID_SELECTOR', selector: condition.selector }; }
    const visibleCount = elements.filter(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' &&
        rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    }).length;
    const diagnostic = { ...condition, match_count: elements.length, visible_count: visibleCount };
    diagnostics.push(diagnostic);
    if (!matched && (condition.visible ? visibleCount > 0 : elements.length > 0)) matched = diagnostic;
  }
  return { matched, diagnostics };
}

async function waitForConditions(sessionId, options) {
  const started = performance.now();
  const deadline = started + options.timeout_ms;
  let diagnostics = [];
  const expression = `(${observeConditions.toString()})(${JSON.stringify(options.conditions)})`;
  while (performance.now() < deadline) {
    try {
      const response = await sendCDPChecked('Runtime.evaluate', {
        expression, returnByValue: true,
      }, sessionId, deadline - performance.now());
      const observation = evaluatedValue(response);
      if (observation.error) return observation;
      diagnostics = observation.diagnostics;
      if (observation.matched) {
        const { state, selector, visible, match_count, visible_count } = observation.matched;
        return { state, matched: true, elapsed_ms: Math.round(performance.now() - started),
          condition: { state, selector, visible }, diagnostics: { match_count, visible_count } };
      }
    } catch (error) {
      if (error.code === 'CDP_TIMEOUT') break;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(options.poll_ms, Math.max(0, deadline - performance.now()))));
  }
  return { error: '等待页面条件超时', code: 'WAIT_TIMEOUT', state: 'timeout', matched: false,
    elapsed_ms: Math.round(performance.now() - started), diagnostics };
}

function evaluatedValue(response) {
  if (response.result?.exceptionDetails) {
    const detail = response.result.exceptionDetails;
    throw apiError(detail.exception?.description || detail.text, 'EVALUATION_FAILED');
  }
  if (response.result?.result?.value === undefined) throw apiError('页面未返回可序列化结果', 'EVALUATION_FAILED', 502);
  return response.result.result.value;
}

async function evaluateElementAction(sessionId, options) {
  const response = await sendCDPChecked('Runtime.evaluate', {
    expression: buildElementActionExpression(options),
    returnByValue: true,
  }, sessionId);
  return evaluatedValue(response);
}

// --- 读取 POST body ---
function readBody(req) {
  const maximumBytes = 1024 * 1024;
  const declaredLength = Number(req.headers?.['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    req.pause?.();
    return Promise.reject(apiError(`POST body 不得超过 ${maximumBytes} 字节`, 'PAYLOAD_TOO_LARGE', 413,
      { max_bytes: maximumBytes, close_request: true }));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);
    };
    const onData = chunk => {
      const buffered = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffered.length;
      if (bytes > maximumBytes) {
        req.removeListener('data', onData);
        req.pause?.();
        fail(apiError(`POST body 不得超过 ${maximumBytes} 字节`, 'PAYLOAD_TOO_LARGE', 413,
          { max_bytes: maximumBytes, close_request: true }));
        return;
      }
      chunks.push(buffered);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, bytes).toString());
    });
    req.on('error', error => fail(error));
  });
}

async function readJsonObject(req, allowedFields) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (error) {
    if (error?.code === 'PAYLOAD_TOO_LARGE') throw error;
    throw apiError('POST body 需要合法 JSON', 'INVALID_ARGUMENT');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError('POST body 需要 JSON 对象', 'INVALID_ARGUMENT');
  const unknown = Object.keys(body).filter(field => !allowedFields.includes(field));
  if (unknown.length) throw apiError(`未知字段: ${unknown[0]}`, 'INVALID_ARGUMENT');
  return body;
}

function requirePost(req, res, endpoint) {
  if (req.method === 'POST') return true;
  json(res, 405, { error: `${endpoint} 需要 POST`, code: 'METHOD_NOT_ALLOWED' });
  return false;
}

// --- HTTP API ---
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
  const pathname = parsed.pathname;
  const q = Object.fromEntries(parsed.searchParams);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    if (pathname === '/health') {
      const connected = Boolean(ws && (ws.readyState === WS.OPEN || ws.readyState === 1));
      res.end(JSON.stringify({ status: 'ok', version: '1.4.0', connected, sessions: sessions.size, chromePort,
        pid: process.pid, instance_id: INSTANCE_ID, port: server.address()?.port, browser }));
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
      const timeoutMs = boundedInteger(q.timeout_ms === undefined ? undefined : Number(q.timeout_ms), 15000, 'timeout_ms');
      const targetUrl = q.url || 'about:blank';
      const resp = await sendCDPChecked('Target.createTarget', { url: 'about:blank', background: true });
      const targetId = resp.result.targetId;

      let load;
      try {
        const sid = await ensureSession(targetId);
        // Navigate after attachment so the initial blank document cannot satisfy the load check.
        if (targetUrl !== 'about:blank') {
          const navigation = await sendCDPChecked('Page.navigate', { url: targetUrl }, sid);
          if (navigation.result.errorText) throw apiError(navigation.result.errorText, 'NAVIGATION_FAILED', 502);
        }
        load = await waitForLoad(sid, timeoutMs);
      } catch (error) { load = { load_status: 'error', ...errorPayload(error) }; }
      res.end(JSON.stringify({ targetId, ...load }));
    }

    // GET /close?target=xxx
    else if (pathname === '/close') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const resp = await sendCDPChecked('Target.closeTarget', { targetId: q.target });
      if (!resp.result?.success) {
        json(res, 404, { error: `未找到或无法关闭 target: ${q.target}`, code: 'TARGET_NOT_FOUND' });
        return;
      }
      const closedSession = sessions.get(q.target);
      navigationVersions.delete(closedSession);
      mainFrames.delete(closedSession);
      sessions.delete(q.target);
      res.end(JSON.stringify(resp.result));
    }

    // GET /navigate?target=xxx&url=yyy
    else if (pathname === '/navigate') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      if (!requireQueryParam(res, q.url, 'url')) return;
      const timeoutMs = boundedInteger(q.timeout_ms === undefined ? undefined : Number(q.timeout_ms), 15000, 'timeout_ms');
      const sid = await ensureSession(q.target);
      const resp = await sendCDPChecked('Page.navigate', { url: q.url }, sid);
      if (resp.result.errorText) {
        json(res, 502, { ...resp.result, error: resp.result.errorText, code: 'NAVIGATION_FAILED', load_status: 'error' });
        return;
      }
      const load = await waitForLoad(sid, timeoutMs);
      res.end(JSON.stringify({ ...resp.result, ...load }));
    }

    // GET /back?target=xxx
    else if (pathname === '/back') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const timeoutMs = boundedInteger(q.timeout_ms === undefined ? undefined : Number(q.timeout_ms), 15000, 'timeout_ms');
      const sid = await ensureSession(q.target);
      const history = await sendCDPChecked('Page.getNavigationHistory', {}, sid);
      const entry = history.result.entries[history.result.currentIndex - 1];
      if (!entry) {
        res.end(JSON.stringify({ ok: true, load_status: 'complete', navigated: false }));
        return;
      }
      await sendCDPChecked('Page.enable', {}, sid);
      const tree = await sendCDPChecked('Page.getFrameTree', {}, sid);
      mainFrames.set(sid, tree.result.frameTree.frame.id);
      const navigationAfter = navigationVersions.get(sid) || 0;
      await sendCDPChecked('Page.navigateToHistoryEntry', { entryId: entry.id }, sid);
      const load = await waitForLoad(sid, timeoutMs, navigationAfter);
      res.end(JSON.stringify({ ok: true, navigated: true, ...load }));
    }

    // POST /wait?target=xxx; ordered alternatives, never a DOM mutation.
    else if (pathname === '/wait') {
      if (req.method !== 'POST') {
        json(res, 405, { error: '/wait 需要 POST', code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      if (!requireQueryParam(res, q.target, 'target')) return;
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch (error) {
        if (error?.code === 'PAYLOAD_TOO_LARGE') throw error;
        throw apiError('POST body 需要合法 JSON', 'INVALID_ARGUMENT');
      }
      const options = validateWait(body);
      const sid = await ensureSession(q.target);
      const result = await waitForConditions(sid, options);
      json(res, result.code === 'WAIT_TIMEOUT' ? 408 : result.error ? 400 : 200, result);
    }

    // POST /readPage?target=xxx; bounded, heuristic light-DOM extraction.
    else if (pathname === '/readPage') {
      if (!requirePost(req, res, '/readPage')) return;
      if (!requireQueryParam(res, q.target, 'target')) return;
      const serialized = await readBody(req);
      let body;
      try { body = serialized.trim() ? JSON.parse(serialized) : {}; }
      catch { throw apiError('POST body 需要合法 JSON', 'INVALID_ARGUMENT'); }
      const sid = await ensureSession(q.target);
      const response = await sendCDPChecked('Runtime.evaluate', {
        expression: buildReadPageExpression(body), returnByValue: true,
      }, sid);
      const result = evaluatedValue(response);
      json(res, result.error ? 400 : 200, result);
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
        res.end(JSON.stringify({ error: resp.result.exceptionDetails.exception?.description || resp.result.exceptionDetails.text, code: 'EVALUATION_FAILED' }));
      } else {
        res.end(JSON.stringify(resp.result));
      }
    }

    // POST /click or /clickAt?target=xxx; body remains a CSS selector.
    else if (pathname === '/click' || pathname === '/clickAt') {
      if (!requirePost(req, res, pathname)) return;
      if (!requireQueryParam(res, q.target, 'target')) return;
      const selector = await readBody(req);
      const sid = await ensureSession(q.target);
      if (pathname === '/click') {
        const selected = await evaluateElementAction(sid, { selector, action: 'click' });
        if (selected.error) { json(res, 400, selected); return; }
        res.end(JSON.stringify({ clicked: true, status: 'dispatched', outcome_verified: false, ...selected }));
        return;
      }

      const guardId = randomUUID();
      const selected = await evaluateElementAction(sid, { selector, action: 'coordinates', guard_id: guardId });
      if (selected.error) { json(res, 400, selected); return; }
      const revalidated = await evaluateElementAction(sid, {
        selector, action: 'revalidateCoordinates', guard_id: guardId,
      });
      if (revalidated.error) {
        await evaluateElementAction(sid, { selector, action: 'finishClick', guard_id: guardId }).catch(() => {});
        json(res, 409, { ...revalidated, dispatch_target_verified: false });
        return;
      }
      let dispatchError;
      try {
        await sendCDPChecked('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: revalidated.x, y: revalidated.y, button: 'left', clickCount: 1,
        }, sid);
        await sendCDPChecked('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: revalidated.x, y: revalidated.y, button: 'left', clickCount: 1,
        }, sid);
      } catch (error) {
        dispatchError = error;
      }
      let finalized;
      try {
        finalized = await evaluateElementAction(sid, { selector, action: 'finishClick', guard_id: guardId });
      } catch (error) {
        if (!dispatchError) dispatchError = error;
      }
      if (dispatchError) throw dispatchError;
      if (finalized.error) {
        json(res, 409, { ...finalized, clicked: false, status: 'blocked', outcome_verified: false,
          dispatch_target_verified: false });
        return;
      }
      res.end(JSON.stringify({ clicked: true, status: 'dispatched', outcome_verified: false,
        ...revalidated, dispatch_target_verified: finalized.dispatch_target_verified === true }));
    }

    // POST /fill?target=xxx; replace editable value and report immediate DOM verification only.
    else if (pathname === '/fill') {
      if (!requirePost(req, res, '/fill')) return;
      if (!requireQueryParam(res, q.target, 'target')) return;
      const body = await readJsonObject(req, ['selector', 'text']);
      const sid = await ensureSession(q.target);
      const result = await evaluateElementAction(sid, { selector: body.selector, action: 'fill', text: body.text });
      json(res, result.error ? 400 : 200, result);
    }

    // POST /insertText?target=xxx; focus is verified before CDP insertion.
    else if (pathname === '/insertText') {
      if (!requirePost(req, res, '/insertText')) return;
      if (!requireQueryParam(res, q.target, 'target')) return;
      const body = await readJsonObject(req, ['selector', 'text']);
      if (typeof body.text !== 'string' || body.text.length > 100000) {
        throw apiError('text 必须是至多 100000 字符的字符串', 'INVALID_ARGUMENT');
      }
      const sid = await ensureSession(q.target);
      const result = await evaluateElementAction(sid, {
        selector: body.selector, action: 'insertText', text: body.text,
      });
      const conflict = ['FOCUS_LOST', 'INPUT_CANCELED'].includes(result.code);
      json(res, result.error ? conflict ? 409 : 400 : 200, result);
    }

    // POST /press?target=xxx; no modifier chords or arbitrary key names.
    else if (pathname === '/press') {
      if (!requirePost(req, res, '/press')) return;
      if (!requireQueryParam(res, q.target, 'target')) return;
      const body = await readJsonObject(req, ['key']);
      const key = validatePressKey(body.key);
      const sid = await ensureSession(q.target);
      await sendCDPChecked('Input.dispatchKeyEvent', { type: key.text === undefined ? 'rawKeyDown' : 'keyDown', ...key }, sid);
      const { text: _text, unmodifiedText: _unmodifiedText, ...keyUp } = key;
      await sendCDPChecked('Input.dispatchKeyEvent', { type: 'keyUp', ...keyUp }, sid);
      res.end(JSON.stringify({ key: body.key, status: 'dispatched', outcome_verified: false }));
    }

    // POST /handleJsDialog?target=xxx; JavaScript dialogs only.
    else if (pathname === '/handleJsDialog') {
      if (!requirePost(req, res, '/handleJsDialog')) return;
      if (!requireQueryParam(res, q.target, 'target')) return;
      const body = await readJsonObject(req, ['accept', 'prompt_text']);
      if (typeof body.accept !== 'boolean' || body.prompt_text !== undefined &&
          (typeof body.prompt_text !== 'string' || body.prompt_text.length > 100000)) {
        throw apiError('accept 必须是布尔值，prompt_text 必须是至多 100000 字符的字符串', 'INVALID_ARGUMENT');
      }
      const sid = await ensureSession(q.target);
      await sendCDPChecked('Page.handleJavaScriptDialog', {
        accept: body.accept, ...(body.prompt_text === undefined ? {} : { promptText: body.prompt_text }),
      }, sid);
      res.end(JSON.stringify({ accepted: body.accept, prompt_text_supplied: body.prompt_text !== undefined,
        status: 'dispatched', outcome_verified: false }));
    }

    // POST /setFiles?target=xxx
    else if (pathname === '/setFiles') {
      if (!requireQueryParam(res, q.target, 'target')) return;
      const sid = await ensureSession(q.target);
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (error) {
        if (error?.code === 'PAYLOAD_TOO_LARGE') throw error;
        json(res, 400, { error: 'POST body 需要合法 JSON', code: 'INVALID_ARGUMENT' });
        return;
      }
      if (!body || typeof body.selector !== 'string' || !body.selector.trim() || !Array.isArray(body.files) || body.files.length === 0 || body.files.some(file => typeof file !== 'string' || !file.trim())) {
        json(res, 400, { error: '需要 selector 和非空 files 数组字段', code: 'INVALID_ARGUMENT' });
        return;
      }
      const selected = await evaluateElementAction(sid, { selector: body.selector, action: 'inspect' });
      if (selected.error) { json(res, 400, selected); return; }
      if (selected.tag !== 'INPUT' || selected.type?.toLowerCase() !== 'file') {
        json(res, 400, { error: '元素必须是 file input', code: 'INVALID_ELEMENT', ...selected });
        return;
      }
      await sendCDPChecked('DOM.enable', {}, sid);
      const doc = await sendCDPChecked('DOM.getDocument', {}, sid);
      const node = await sendCDPChecked('DOM.querySelectorAll', {
        nodeId: doc.result.root.nodeId,
        selector: body.selector
      }, sid);
      if (node.result?.nodeIds?.length !== 1) {
        json(res, 400, { error: '选择器匹配在操作前发生变化', code: 'SELECTOR_CHANGED',
          selector: body.selector, match_count: node.result?.nodeIds?.length ?? 0 });
        return;
      }
      await sendCDPChecked('DOM.setFileInputFiles', {
        nodeId: node.result.nodeIds[0],
        files: body.files
      }, sid);
      res.end(JSON.stringify({ success: true, files: body.files.length, selector: body.selector, match_count: 1 }));
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
        error: '未知端点', code: 'UNKNOWN_ENDPOINT',
        endpoints: {
          '/health': 'GET - 健康检查',
          '/targets': 'GET - 列出所有页面 tab',
          '/new?url=': 'GET - 创建新后台 tab',
          '/close?target=': 'GET - 关闭 tab',
          '/navigate?target=&url=': 'GET - 导航',
          '/back?target=': 'GET - 后退',
          '/info?target=': 'GET - 页面信息',
          '/eval?target=': 'POST body=JS - 执行 JS',
          '/wait?target=': 'POST body=JSON - 等待具名页面状态',
          '/readPage?target=': 'POST body=JSON - 提取有界页面内容',
          '/click?target=': 'POST body=CSS选择器 - 点击元素',
          '/clickAt?target=': 'POST body=CSS选择器 - 真实鼠标点击',
          '/fill?target=': 'POST body=JSON - 填写输入值',
          '/insertText?target=': 'POST body=JSON - 聚焦后插入文本',
          '/press?target=': 'POST body=JSON - 发送受支持按键',
          '/handleJsDialog?target=': 'POST body=JSON - 处理 JavaScript 对话框',
          '/setFiles?target=': 'POST body=JSON - 文件上传',
          '/scroll?target=&y=&direction=': 'GET - 滚动页面',
          '/screenshot?target=&file=': 'GET - 截图',
        },
      }));
    }
  } catch (e) {
    if (e?.code === 'PAYLOAD_TOO_LARGE' && e.close_request) {
      res.setHeader('Connection', 'close');
      res.once('finish', () => req.destroy());
    }
    json(res, e.statusCode || 500, errorPayload(e));
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
    console.error(`[CDP Proxy] 端口 ${PORT} 已被占用`);
    process.exit(1);
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[CDP Proxy] academic-search 运行在 http://127.0.0.1:${server.address().port}`);
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
