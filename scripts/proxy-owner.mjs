// Verify process and socket ownership locally before contacting any HTTP handler.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const commandOptions = { timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, windowsHide: true };
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasArgument(command, value, ignoreCase = false) {
  const escaped = escapeRegex(value);
  return new RegExp(`(?:^|\\s)(?:"${escaped}"|'${escaped}'|${escaped})(?=\\s|$)`, ignoreCase ? 'i' : '').test(command);
}

function validDetails({ pid, port, marker, script } = {}) {
  return Number.isSafeInteger(pid) && pid > 0 && pid <= 2_147_483_647 &&
    Number.isInteger(port) && port > 0 && port <= 65535 &&
    typeof marker === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(marker) &&
    typeof script === 'string' && path.isAbsolute(script) && !/[\r\n\0]/.test(script);
}

function matchesCommand(command, { marker, script }) {
  return typeof command === 'string' &&
    hasArgument(command, `--academic-proxy-owner=${marker}`) &&
    hasArgument(command, script, process.platform === 'win32');
}

async function windowsOwner(details) {
  // Only validated integers enter this fixed PowerShell program. Marker and path
  // stay in JavaScript and are never interpolated into executable command text.
  const program = `$ErrorActionPreference = 'Stop';
    $record = Get-CimInstance Win32_Process -Filter 'ProcessId = ${details.pid}';
    if ($null -eq $record) { exit 1 };
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort ${details.port} | Select-Object -ExpandProperty OwningProcess);
    @{ command = $record.CommandLine; pids = $listeners } | ConvertTo-Json -Compress`;
  const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(program, 'utf16le').toString('base64')], commandOptions);
  const result = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  return matchesCommand(result.command, details) && Array.isArray(result.pids) && result.pids.length > 0 &&
    result.pids.every(pid => pid === details.pid);
}

export async function proxyOwnerMatches(details) {
  if (!details || typeof details !== 'object' || !validDetails(details)) return false;
  try {
    if (process.platform === 'win32') return await windowsOwner(details);
    const { stdout: command } = await exec('ps', ['-ww', '-p', String(details.pid), '-o', 'command='], commandOptions);
    if (!matchesCommand(command.trim(), details)) return false;
    const { stdout } = await exec('lsof', ['-nP', `-iTCP:${details.port}`, '-sTCP:LISTEN', '-F', 'p'], commandOptions);
    const pids = stdout.split(/\r?\n/).filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1)));
    return pids.length > 0 && pids.every(pid => pid === details.pid);
  } catch {
    // Missing tools, access restrictions, query timeouts, dead processes, and
    // malformed output cannot establish ownership: never probe HTTP as fallback.
    return false;
  }
}
