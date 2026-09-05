# Academic Search 1.3.1

This update isolates browser automation from everyday Chrome and changes the default Proxy port from **3456 to 3457**. API-first retrieval, academic metadata and PDF validation workflows remain as described in the [1.3 release notes](release-1.3.md).

## Browser isolation

The default managed mode uses an installed Chrome executable with a separate persistent profile at `~/.local/share/academic-search/chrome-profile`. It launches Chrome with a non-default `--user-data-dir`, a system-assigned debugging port (`--remote-debugging-port=0`) and loopback debugging address. Only this profile's `DevToolsActivePort` is read; everyday-browser profile discovery and common-port scanning are removed.

The previous discovery behavior could select an everyday Chrome instance and trigger its remote-debugging consent prompt. The new default does not request access to that instance. Websites can still require login, CAPTCHA or other checks. Sign in within the dedicated profile when needed; everyday-browser cookies and login state are not copied. The profile persists across tasks, while website session validity remains controlled by the website.

Chrome's official guidance calls for a non-default user-data directory when using remote-debugging switches starting with Chrome 136. See [Changes to remote debugging switches to improve security](https://developer.chrome.com/blog/remote-debugging-port).

## Configuration

| Variable | Default / behavior |
|---|---|
| `ACADEMIC_CHROME_PROFILE` | Dedicated profile directory; defaults to `~/.local/share/academic-search/chrome-profile` |
| `ACADEMIC_CHROME_EXECUTABLE` | Optional installed Chrome executable path |
| `ACADEMIC_CHROME_ENDPOINT` | Explicit attach-only HTTP CDP endpoint; no browser launch or fallback |
| `ACADEMIC_CHROME_START_TIMEOUT_MS` | 15000 ms browser preparation budget |
| `ACADEMIC_CDP_CONNECT_TIMEOUT_MS` | 5000 ms CDP connection budget |
| `CDP_PROXY_PORT` | **3457**, the Proxy HTTP port; it is not the Chrome debugging port |

From the installed Skill root, run `bash scripts/check-deps.sh` only for browser tasks. API-only tasks do not run browser setup. To reuse an already-running independent browser, such as WebUse, set its actual endpoint explicitly:

```bash
ACADEMIC_CHROME_ENDPOINT=http://127.0.0.1:9334 bash scripts/check-deps.sh
```

The address is an example, not a claim that WebUse is running. An unavailable explicit endpoint fails without starting a browser, scanning another port or falling back to managed mode.

## Proxy identity and migration

Update custom client URLs from the old default `127.0.0.1:3456` to `127.0.0.1:3457`, or consistently configure another `CDP_PROXY_PORT`. Do not stop a different tool that still uses the old port.

`check-deps` reuses only a proxy whose recorded process identity, version and browser configuration can be verified. Unknown port occupancy is a conflict, not an invitation to adopt or terminate the service. Tests also verify their own proxy identity rather than accepting whichever process responds.

Before making an HTTP request, reuse checks the process's random startup marker and ownership of the listening socket. This needs `ps` and `lsof` on macOS/Linux, or PowerShell on Windows. Missing verification tools cause reuse to fail without probing the service. Startup records and logs live under `~/.local/share/academic-search/proxy-state` (override with `ACADEMIC_PROXY_STATE_DIR`). Manually launched proxies do not have these records; use `check-deps.sh` for normal startup.

`GET /health` is read-only: it does not discover, start or connect to Chrome. It reports `version:"1.3.1"` and `browser:{mode,endpoint,profile_dir}` in addition to the existing identity and connection fields. Managed mode reports no endpoint until preparation discovers the dynamic address; endpoint mode reports the explicitly configured address and no managed profile. The initial background connection can still be pending when health reports `connected:false`.

`browser-runtime.mjs config` only returns configuration. Its `ensure` command prepares managed Chrome or checks the explicit endpoint with a bounded wait. Detailed API and configuration contracts are in [CDP API](../references/cdp-api.md); task ownership, observation and cleanup rules are in [browser workflow](../references/browser-workflow.md).

## Validation scope

Use `make test-offline` for local fixtures. Browser tests require an installed Chrome or an explicitly configured running endpoint and must operate only on task-owned tabs. Report the platform and browser mode actually exercised; documentation of executable discovery is not evidence that every operating system was tested.

Validated on macOS with Node.js 25.6.1 and Chrome 152.0.7977.76: dedicated-profile cold start and reuse, automatic CDP connections across fresh proxy processes, `check-deps` process reuse, and the browser self-test/release-test. No remote-debugging consent interaction was required during these checks. Windows and Linux browser startup were not exercised on this host.

This release does not promise that websites never show login or verification prompts, and it does not alter site access permissions. Browser isolation addresses how the runtime selects and prepares Chrome.
