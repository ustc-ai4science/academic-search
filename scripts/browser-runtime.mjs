#!/usr/bin/env node
// A single explicit endpoint, or an owned persistent Chrome profile. Never daily-profile discovery.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function failure(code, message) { return Object.assign(new Error(message), { code, statusCode: 503 }); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const loopback = hostname => ['127.0.0.1', '[::1]', 'localhost'].includes(hostname);
function timeout(value, fallback, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 60000) throw failure('BROWSER_CONFIG_INVALID', `${name} must be an integer from 1 to 60000`);
  return result;
}
function normalizeEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('BROWSER_CONFIG_INVALID', 'ACADEMIC_CHROME_ENDPOINT must be a loopback HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || !loopback(url.hostname) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw failure('BROWSER_CONFIG_INVALID', 'ACADEMIC_CHROME_ENDPOINT must be a loopback HTTP(S) origin without credentials or paths');
  }
  return url.origin;
}

// Pure configuration: no filesystem probes, browser launch or network requests.
export function browserConfigFromEnv(env = process.env, home = os.homedir()) {
  const explicit = env.ACADEMIC_CHROME_ENDPOINT?.trim();
  const profile = env.ACADEMIC_CHROME_PROFILE?.trim() || path.join(home, '.local/share/academic-search/chrome-profile');
  return {
    mode: explicit ? 'endpoint' : 'managed',
    endpoint: explicit ? normalizeEndpoint(explicit) : null,
    profile_dir: explicit ? null : path.resolve(profile.startsWith('~/') ? path.join(home, profile.slice(2)) : profile),
    executable: env.ACADEMIC_CHROME_EXECUTABLE?.trim() || null,
    start_timeout_ms: timeout(env.ACADEMIC_CHROME_START_TIMEOUT_MS, 15000, 'ACADEMIC_CHROME_START_TIMEOUT_MS'),
    connect_timeout_ms: timeout(env.ACADEMIC_CDP_CONNECT_TIMEOUT_MS, 5000, 'ACADEMIC_CDP_CONNECT_TIMEOUT_MS'),
  };
}

async function metadata(endpoint, budgetMs) {
  let response;
  let body;
  try {
    response = await fetch(endpoint + '/json/version', { redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.ceil(budgetMs))) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = await response.json();
  } catch (error) {
    throw failure('BROWSER_ENDPOINT_UNAVAILABLE', `${endpoint} /json/version unavailable: ${error.message}`);
  }
  let ws;
  try { ws = new URL(body.webSocketDebuggerUrl); } catch { throw failure('BROWSER_ENDPOINT_INVALID', 'Chrome metadata has no valid browser WebSocket URL'); }
  const origin = new URL(endpoint);
  const expectedProtocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!/^Chrome\//.test(body.Browser || '') && !/^Chromium\//.test(body.Browser || '')) {
    throw failure('BROWSER_ENDPOINT_INVALID', 'Endpoint is not a Chrome/Chromium browser debugging service');
  }
  if (ws.protocol !== expectedProtocol || !loopback(ws.hostname) || ws.port !== origin.port || ws.username || ws.password ||
      !/^\/devtools\/browser\/[^/]+$/.test(ws.pathname) || ws.search || ws.hash) {
    throw failure('BROWSER_ENDPOINT_INVALID', 'Browser WebSocket must remain on the configured loopback port and browser path');
  }
  return ws.href;
}

async function canonicalPath(input) {
  let current = path.resolve(input);
  const suffix = [];
  for (;;) {
    try { return path.join(await fs.realpath(current), ...suffix); }
    catch (error) {
      if (error.code !== 'ENOENT' || current === path.dirname(current)) throw error;
      suffix.unshift(path.basename(current));
      current = path.dirname(current);
    }
  }
}
async function validateProfile(profile) {
  const home = os.homedir();
  const knownDailyRoots = [
    path.join(home, 'Library/Application Support/Google/Chrome'),
    path.join(home, 'Library/Application Support/Google/Chrome Canary'),
    path.join(home, 'Library/Application Support/Chromium'),
    path.join(home, '.config/google-chrome'), path.join(home, '.config/google-chrome-beta'),
    path.join(home, '.config/google-chrome-unstable'), path.join(home, '.config/chromium'),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Google/Chrome/User Data'),
      path.join(process.env.LOCALAPPDATA, 'Chromium/User Data')] : []),
  ];
  const real = await canonicalPath(profile);
  const compare = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const target = compare(real);
  for (const root of [...knownDailyRoots, home, path.parse(home).root]) {
    const normalized = compare(await canonicalPath(root));
    const isDaily = knownDailyRoots.includes(root);
    if (target === normalized || (isDaily && target.startsWith(normalized + path.sep))) {
      throw failure('BROWSER_PROFILE_UNSAFE', 'ACADEMIC_CHROME_PROFILE must be a separate browser data directory, not a daily profile');
    }
  }
  return real;
}

async function executableFor(config) {
  const candidates = [];
  if (config.executable) candidates.push(config.executable);
  else if (process.platform === 'darwin') {
    for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      candidates.push(path.join(base, 'Google Chrome.app/Contents/MacOS/Google Chrome'),
        path.join(base, 'Chromium.app/Contents/MacOS/Chromium'),
        path.join(base, 'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'));
    }
  } else if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Chromium/Application/chrome.exe'));
    }
  } else {
    for (const base of (process.env.PATH || '').split(path.delimiter)) {
      for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) candidates.push(path.join(base, command));
    }
  }
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch { /* Check only known executables, never launch a shell search. */ }
  }
  throw failure('CHROME_NOT_FOUND', 'Chrome/Chromium executable not found; set ACADEMIC_CHROME_EXECUTABLE to its full path');
}

async function inspectProfile(profile, deadline) {
  let lines;
  try { lines = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[^/]+$/.test(lines[1] || '')) return null;
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const ws = await metadata(endpoint, Math.min(1500, Math.max(1, deadline - performance.now())));
    // A stale port reused by another browser must not count as this profile.
    if (new URL(ws).pathname !== lines[1]) return null;
    return { endpoint, webSocketDebuggerUrl: ws };
  } catch (error) {
    if (['BROWSER_ENDPOINT_UNAVAILABLE', 'BROWSER_ENDPOINT_INVALID'].includes(error.code)) return null;
    throw error;
  }
}

async function removeDeadLaunchLock(lock) {
  try {
    const owner = JSON.parse(await fs.readFile(lock, 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) return;
    try { process.kill(owner.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') await fs.unlink(lock); }
  } catch { /* A live creator may still be writing the lock; wait within the budget. */ }
}

export async function ensureBrowser(config = browserConfigFromEnv(), { spawnImpl = spawn } = {}) {
  const deadline = performance.now() + config.start_timeout_ms;
  if (config.mode === 'endpoint') {
    const endpoint = normalizeEndpoint(config.endpoint);
    return { mode: 'endpoint', endpoint, profile_dir: null, launched: false,
      webSocketDebuggerUrl: await metadata(endpoint, config.start_timeout_ms) };
  }
  const profile = await validateProfile(config.profile_dir);
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  const result = (found, launched) => ({ mode: 'managed', profile_dir: profile, launched, ...found });
  let found = await inspectProfile(profile, deadline);
  if (found) return result(found, false);
  const lock = path.join(profile, '.academic-search-launch.lock');
  let handle;
  while (performance.now() < deadline && !handle) {
    try { handle = await fs.open(lock, 'wx', 0o600); await handle.writeFile(JSON.stringify({ pid: process.pid })); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      found = await inspectProfile(profile, deadline);
      if (found) return result(found, false);
      await removeDeadLaunchLock(lock);
      await sleep(Math.min(25, Math.max(0, deadline - performance.now())));
    }
  }
  if (!handle) throw failure('BROWSER_START_TIMEOUT', 'Timed out waiting for the dedicated Chrome profile launcher');
  try {
    // Another caller may have completed startup while this caller acquired the lock.
    found = await inspectProfile(profile, deadline);
    if (found) return result(found, false);
    const executable = await executableFor(config);
    let launchError;
    const chrome = spawnImpl(executable, [
      `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { detached: true, stdio: 'ignore' });
    chrome.once('error', error => { launchError = error; });
    chrome.unref();
    while (performance.now() < deadline) {
      if (launchError) throw failure('BROWSER_LAUNCH_FAILED', `Dedicated Chrome could not start: ${launchError.message}`);
      found = await inspectProfile(profile, deadline);
      if (found) return result(found, true);
      await sleep(Math.min(25, Math.max(0, deadline - performance.now())));
    }
    throw failure('BROWSER_START_TIMEOUT', 'Dedicated Chrome did not publish a valid endpoint before the startup deadline; no other browser was contacted');
  } finally {
    await handle.close();
    await fs.unlink(lock).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const command = process.argv[2] || 'config';
    if (!['config', 'ensure'].includes(command)) throw failure('BROWSER_CONFIG_INVALID', 'usage: node browser-runtime.mjs config|ensure');
    const config = browserConfigFromEnv();
    console.log(JSON.stringify(command === 'config' ? config : await ensureBrowser(config)));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, code: error.code || 'BROWSER_RUNTIME_ERROR' }));
    process.exitCode = 1;
  }
}
