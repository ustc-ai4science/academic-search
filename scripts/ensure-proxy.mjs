#!/usr/bin/env node
// Unknown legacy /health handlers can connect to daily Chrome: verify local ownership first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserConfigFromEnv } from './browser-runtime.mjs';
import { proxyOwnerMatches } from './proxy-owner.mjs';

const VERSION = '1.3.1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readJSON = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function requestJSON(port, route, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: route }, res => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) req.destroy(new Error('proxy response too large'));
      });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(body);
          if (res.statusCode !== 200) throw new Error(data.error || `HTTP ${res.statusCode}`);
          resolve(data);
        } catch (error) { reject(error); }
      });
      res.on('error', error => { clearTimeout(timer); reject(error); });
    });
    const timer = setTimeout(() => req.destroy(new Error('proxy request timed out')), timeout);
    req.on('error', error => { clearTimeout(timer); reject(error); });
  });
}

function portAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function main() {
  const port = Number(process.env.CDP_PROXY_PORT || 3457);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CDP_PROXY_PORT must be an integer from 1 to 65535');
  const config = browserConfigFromEnv();
  const connectionBudget = config.start_timeout_ms + config.connect_timeout_ms + 5000;
  const script = fs.realpathSync(fileURLToPath(new URL('./cdp-proxy.mjs', import.meta.url)));
  const configHash = createHash('sha256').update(JSON.stringify({ config,
    executable: process.env.ACADEMIC_CHROME_EXECUTABLE || null,
    connect_timeout: process.env.ACADEMIC_CDP_CONNECT_TIMEOUT_MS || null,
  })).digest('hex');
  const stateDir = process.env.ACADEMIC_PROXY_STATE_DIR || path.join(os.homedir(), '.local/share/academic-search/proxy-state');
  const stateFile = path.join(stateDir, `proxy-${port}.json`);
  const matchesRecord = state => state?.version === VERSION && state.script === script &&
    state.config_hash === configHash && state.port === port && Number.isInteger(state.pid) && state.pid > 0 &&
    typeof state.instance_id === 'string' && alive(state.pid);
  const matchesHealth = (health, state) => health?.version === VERSION && health.pid === state.pid &&
    health.instance_id === state.instance_id && health.port === port;
  const ready = health => console.log(`proxy: ready (http://127.0.0.1:${port}, pid ${health.pid}, ${health.browser?.mode})`);

  if (!await portAvailable(port)) {
    const state = readJSON(stateFile);
    if (!matchesRecord(state) || !await proxyOwnerMatches(state)) throw new Error(`PROXY_PORT_IN_USE: ${port} is occupied by an unverified service or different configuration. No request was sent. Set CDP_PROXY_PORT to another free port, or stop only the proxy you own before retrying.`);
    const health = await requestJSON(port, '/health');
    if (!matchesHealth(health, state)) throw new Error(`PROXY_IDENTITY_MISMATCH: ${port}; refusing to use this service`);
    if (!health.connected) await requestJSON(port, '/targets', connectionBudget + 30000);
    const current = await requestJSON(port, '/health');
    if (!matchesHealth(current, state) || !current.connected) throw new Error('owned proxy is not connected');
    ready(current);
    return;
  }

  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const logFile = path.join(stateDir, `proxy-${port}-${randomUUID()}.log`);
  const logFD = fs.openSync(logFile, 'wx', 0o600);
  const marker = randomUUID();
  const child = spawn(process.execPath, [script, `--academic-proxy-owner=${marker}`], {
    env: { ...process.env, CDP_PROXY_PORT: String(port) }, detached: true,
    stdio: ['ignore', logFD, logFD],
  });
  fs.closeSync(logFD);
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.unref();
  let ownedState;
  try {
    const deadline = Date.now() + connectionBudget;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || !alive(child.pid)) throw new Error('new proxy process exited');
      // This private startup log proves our new process bound the port.
      if (fs.readFileSync(logFile, 'utf8').includes(`运行在 http://127.0.0.1:${port}`)) {
        const health = await requestJSON(port, '/health');
        if (health.pid !== child.pid || health.version !== VERSION || !health.instance_id) throw new Error('new proxy identity mismatch');
        if (!ownedState) {
          ownedState = { version: VERSION, pid: child.pid, marker, instance_id: health.instance_id,
            port, script, config_hash: configHash, log_file: logFile };
          const temporary = `${stateFile}.${randomUUID()}.tmp`;
          fs.writeFileSync(temporary, JSON.stringify(ownedState, null, 2) + '\n', { mode: 0o600 });
          fs.renameSync(temporary, stateFile);
        }
        if (health.connected) { ready(health); return; }
      }
      await delay(200);
    }
    throw new Error(`browser connection did not become ready within ${connectionBudget} ms`);
  } catch (error) {
    // Only terminate our own child, never a PID discovered by port scanning.
    if (child.exitCode === null) child.kill();
    if (ownedState && readJSON(stateFile)?.instance_id === ownedState.instance_id) fs.rmSync(stateFile, { force: true });
    throw new Error(`${error.message}. Log: ${logFile}\n${fs.readFileSync(logFile, 'utf8').slice(-3000)}`);
  }
}

main().catch(error => { console.error(`proxy: ${error.message}`); process.exitCode = 1; });
