<table>
  <tr>
    <td width="220" valign="middle">
      <img src="assets/logo.png" alt="academic-search logo" width="180" />
    </td>
    <td valign="middle">
      <h1>academic-search skill</h1>
    </td>
  </tr>
</table>

<p align="center">Academic search and paper metadata extraction for Codex, Claude Code, and compatible skill hosts</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v1.3.1-0f766e" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-1f2937" alt="license" />
  <img src="https://img.shields.io/badge/test-make%20test%20%7C%20make%20test--release-2563eb" alt="test" />
</p>

<p align="center">
  <a href="https://github.com/ustc-ai4science/academic-search/stargazers">
    <img src="https://img.shields.io/github/stars/ustc-ai4science/academic-search?style=social" alt="GitHub stars" />
  </a>
  <a href="https://github.com/ustc-ai4science/academic-search/commits/main">
    <img src="https://img.shields.io/github/last-commit/ustc-ai4science/academic-search" alt="last commit" />
  </a>
  <a href="https://github.com/ustc-ai4science/academic-search">
    <img src="https://img.shields.io/badge/repo-GitHub-111827?logo=github" alt="repo link" />
  </a>
</p>

<p align="center"><a href="README.md">简体中文</a> | English</p>

academic-search skill brings academic-oriented retrieval strategy, cross-platform metadata normalization, and browser automation support to compatible skill hosts. It is designed for paper discovery, author analysis, citation lookup, open-access PDF retrieval, BibTeX export, and structured literature comparison across multiple sources.

Compared with generic WebSearch and WebFetch, this skill focuses on three things: **platform selection for academic tasks**, **structured outputs**, and **reusable site-specific operational knowledge**.

## Quick Start

```bash
git clone https://github.com/ustc-ai4science/academic-search academic-search
cd academic-search
# Only for the bundled CDP browser mode; API retrieval does not need Chrome
bash scripts/check-deps.sh
```

Once installed, you can immediately ask Claude Code to perform an academic search task, for example:

```text
Search for top-venue papers on graph neural networks published after 2023, give me the top 10
```

## News

[v1.3.1 browser isolation notes](docs/release-1.3.1.md) · [v1.3 release notes](docs/release-1.3.md)

- `2026-09-05` `v1.3.1`: automatically managed Chrome profile, dynamic debugging port, explicit attach-only endpoints, and proxy identity checks

- `2026-09-05` Released `v1.3.0`: bounded browser conditions, unique action targets, PDF format validation and response provenance, scoped workflows and experience status

- `2026-05-08` Added an open-access PDF manifest and batch download helper: only handles legal `open_pdf` sources and does not bypass paywalls
- `2026-05-01` Added multidisciplinary guidance: discipline routing, open-access PDF status, Crossref/OpenAlex/Unpaywall foundations, and publisher access-limit handling
- `2026-04-05` Added CNKI support docs: search strategy, metadata schema fields, and a dedicated site pattern file
- `2026-04-02` Released `v1.2.0`: frontier-first ranking, query expansion, direct PDF retrieval, and intent-aware two-pass search
- `2026-04-02` Added a new case study: [Skill vs. No-Skill Search Comparison](docs/skill-usage-comparison.md)
- `2026-04-02` Refreshed the README hero/content copy

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [Installation](#installation)
- [Requirements](#requirements)
- [Testing](#testing)
- [Usage Examples](#usage-examples)
- [Open-Access PDF Download Manifest](#open-access-pdf-download-manifest)
- [Verification Boundary](#verification-boundary)
- [Multidisciplinary Usage](#multidisciplinary-usage)
- [Platforms and Access Strategy](#platforms-and-access-strategy)
- [CDP Proxy API](#cdp-proxy-api)
- [Project Structure](#project-structure)
- [Design Principles](#design-principles)
- [License](#license)

## Overview

- **Platform coverage**: arXiv, Semantic Scholar, Crossref, OpenAlex, Unpaywall, Google Scholar, ACM DL, IEEE Xplore, PubMed, Papers with Code, and CNKI
- **Operating principles**: API-first, structured-output-first, CDP only when necessary
- **Typical tasks**: keyword search, author page parsing, citation analysis, PDF/BibTeX retrieval, and batch literature review
- **Target users**: developers and researchers using Claude Code for academic search and research assistance

## Why academic-search

- **Built for academic workflows, not generic browsing**: prioritizes paper metadata, citations, PDFs, and BibTeX over raw webpage content
- **Unified results across multiple sources**: reduces manual reconciliation by deduplicating and merging cross-platform outputs
- **Controlled browser automation**: uses CDP only for platforms such as Google Scholar where no reliable API exists
- **Suitable for research pipelines**: works for both single-paper lookups and larger literature review or benchmarking workflows

---

## Core Features

| Capability | Description |
|-----------|-------------|
| Cross-disciplinary coverage | arXiv / Semantic Scholar / Crossref / OpenAlex / Unpaywall / Google Scholar / ACM DL / IEEE Xplore / PubMed / Papers with Code / CNKI |
| API-first strategy | Public APIs first — no browser required when a reliable API exists |
| Discipline routing | Selects sources, query expansion, ranking, and output fields for CS/AI, biomedicine, physics/math, chemistry/materials, social science/economics, and humanities/law |
| CDP browser mode | Automatically prepare a separate persistent Chrome profile, or attach to an explicitly configured running endpoint; API-only tasks do not launch Chrome |
| Two-pass search | Screen candidates first, then complete the requested fields. An existing request for full metadata authorizes both passes without another confirmation |
| Frontier-first ranking | Relevance and inclusion criteria first; use recency, citations and discipline-specific evaluation as task-dependent signals |
| Query expansion | Expands complementary queries and deduplicates their results; no fixed recall improvement is assumed |
| Venue tier labels | CS conferences/journals annotated with CCF ranking (A/B/C); ICLR labeled separately |
| Result filtering | Filter by recency / citation count / venue tier / open PDF / code availability |
| Structured metadata | Unified schema across all platforms; DOI as primary dedup key |
| Open-access PDF retrieval | An arXiv ID yields a candidate URL, not proof of accessibility; retain source evidence and verify downloaded bytes separately |
| Open-access PDF download | Generate a download manifest and download only records marked `open_pdf`; does not bypass paywalls and does not use Sci-Hub/WebVPN/Tor |
| Full-text access status | Records `open_pdf`, `login_required`, `needs_institution`, `no_open_pdf`, `anti_bot_blocked`, `html_not_pdf`, or `unknown` instead of treating every publisher block as a generic failure |
| Cross-disciplinary metadata | Crossref / OpenAlex / Unpaywall supplement DOI, venue, institution, citation, and open-access status across fields |
| BibTeX export | Platform-native export + field-assembly fallback |
| Code availability | Paper/author official links first; validate candidates from third-party indexes |
| Citation graph | S2 citations/references API; Google Scholar citation counts as supplement |
| Failure signal handling | 429 / timeout / empty results each have explicit direction adjustments — no blind retries |
| Parallel sub-agents | Independent targets dispatched to parallel sub-agents sharing one Proxy, tab-level isolation |
| Pre-seeded site knowledge | Platform and publisher patterns capture URL structures, selectors, access limits, and known pitfalls |

<details>
<summary>v1.2.0 Changes</summary>

- **Frontier-first ranking** — Recency as top priority: papers from last 6 months labeled `[new]` and surfaced first; citation count second; CCF tier as reference only
- **Query expansion strategy** — Auto-expands to synonyms / sub-concepts / abbreviations; merge and deduplicate complementary queries without assuming a fixed recall gain
- **Open-access PDF link** — ArXiv ID present → construct link directly, bypassing unreliable `openAccessPdf` field
- **Intent-aware two-pass** — When user specifies "top N papers", outputs directly without stopping to confirm
- **Failure signal table** — 429 / timeout / empty results each map to explicit direction adjustments
- **Success criteria definition** — Define field requirements and count before executing; used as decision anchor throughout
- **S2 API Key hint** — Recommends free key registration to avoid frequent 429s in single sessions

</details>

<details>
<summary>v1.1.0 Changes</summary>

- **Two-pass search strategy** — Lightweight summary table first; screen first and complete fields already requested by the user
- **Venue rankings reference** — New `references/venue-rankings.md` covering AI/ML/CV/NLP/Data Mining/IR/Systems/SE CCF tiers
- **Explicit filtering capability** — New filtering section with 5 dimensions and output template

</details>

---

## Installation

Choose the directory for your host. Codex commonly uses `~/.codex/skills/academic-search`; the examples below use Claude Code. Run bundled scripts relative to the actual skill root.

**Option 1: Let Claude install it automatically**

```
Install this skill for me: https://github.com/ustc-ai4science/academic-search
```

**Option 2: Manual**

```bash
git clone https://github.com/ustc-ai4science/academic-search ~/.claude/skills/academic-search
```

**Option 3: Local symlink (for development)**

```bash
# Run inside the academic-search/ directory
ln -sfn "$(pwd)" ~/.claude/skills/academic-search
```

## Requirements

API credentials and budgets depend on the current provider and account. API-only retrieval does not require Chrome. Bundled scripts require Node.js 22+.

**Default-port migration:** v1.3.1 changes the Proxy port from 3456 to 3457. Update custom client base URLs; do not treat another tool on the old port as the new proxy, and do not stop it as part of this migration.

Bundled CDP mode uses an installed Chrome executable. From the actual skill directory:

```bash
bash scripts/check-deps.sh
```

The runtime automatically prepares a separate persistent profile at `~/.local/share/academic-search/chrome-profile`. Chrome selects a dynamic debugging port bound to loopback. The runtime reads only this profile's `DevToolsActivePort`; it does not scan or connect to your everyday Chrome. Sign in to websites in the dedicated window when first needed. Existing everyday-browser cookies and logins are not copied.

| Setting | Purpose |
|---|---|
| `ACADEMIC_CHROME_PROFILE` | Override the dedicated profile directory |
| `ACADEMIC_CHROME_EXECUTABLE` | Select the installed Chrome executable |
| `ACADEMIC_CHROME_ENDPOINT` | Attach only to this already-running browser endpoint; no launch or fallback |
| `CDP_PROXY_PORT` | Proxy HTTP port, default 3457; this is not the Chrome debugging port |

For example, reuse WebUse only when it is already running at the specified endpoint:

```bash
ACADEMIC_CHROME_ENDPOINT=http://127.0.0.1:9334 bash scripts/check-deps.sh
```

An unavailable endpoint fails explicitly; this does not start WebUse. Website logins, CAPTCHA checks, and session expiry can still occur. `check-deps` reuses only a proxy whose recorded process identity can be verified; unknown port occupancy is reported rather than adopted or terminated. See [CDP API](references/cdp-api.md) for configuration and diagnostics.

## Testing

Run `make test-offline` for local fixture tests without Chrome. `make test` and `make test-release` also exercise an installed Chrome or an explicitly configured running endpoint, using task-owned tabs and an isolated proxy. They do not depend on remote debugging being enabled for your everyday Chrome.

Local regression test:

```bash
cd academic-search
make test
```

Pre-release regression test:

```bash
cd academic-search
make test-release
```

If the proxy port `3457` or the default test port `4568` is already occupied, select another port explicitly:

```bash
cd academic-search
make test CDP_PROXY_PORT=4570
make test-release CDP_PROXY_PORT=4570
```

---

## Usage Examples

After installation, just ask Claude Code to perform academic search tasks — the skill takes over automatically:

```
Search for top-venue papers on graph neural networks published after 2023, give me the top 10
```

```
Find all papers by Yann LeCun on Semantic Scholar, sorted by citation count
```

```
Get the BibTeX for this paper: https://arxiv.org/abs/1706.03762
```

```
Look up BERT, GPT-3, and T5 in parallel — give me a comparison table with metadata and citation counts
```

```
Check Google Scholar for the citation count of "Attention Is All You Need"
```

```
Search for time series agent papers from the last two years and generate an open-access PDF download manifest
```

### Open-Access PDF Download Manifest

Academic-Search can turn search results into an open-access PDF download manifest:

```bash
node scripts/oa-pdf-download.mjs \
  --input results.json \
  --manifest download-manifest.json
```

When downloads are already authorized, download source-supported `open_pdf` records directly; verify the actual bytes during download:

```bash
node scripts/oa-pdf-download.mjs \
  --input results.json \
  --manifest download-manifest.json \
  --download \
  --out-dir ./papers
```

This feature handles legal open-access PDFs only. It does not use Sci-Hub, LibGen, WebVPN, Tor, or Cloudflare bypasses. The manifest keeps the processing result for each record:

| Field | Meaning |
|-------|---------|
| `download_status` | `eligible` / `downloaded` / `skipped` / `failed` / `not_pdf` |
| `download_error` | Skip or failure reason |
| `local_pdf_path` | Local downloaded PDF path, filled only when `downloaded` |

### Verification Boundary

The downloader checks the PDF signature, EOF and basic xref structure, then uses optional Poppler `pdfinfo` to validate parsing. If the parser is unavailable, it explicitly reports `structure_checked_parser_unavailable`. Strict checks can reject recoverable PDFs. Neither a successful transfer nor a parseable PDF proves that the file belongs to the intended paper.

Manifest fields include `final_url`, `checked_at`, `byte_length`, `sha256`, `http_status`, `retry_after`, and `download_error_code`. `pdf_verification_status` is `unverified`, `parser_validated`, `structure_checked_parser_unavailable`, `not_pdf`, or `invalid_pdf`. The downloader always returns `paper_identity_status=unverified`.

Use `--timeout-ms 30000` to bound network requests and `--pdfinfo-path` to select a parser. Parser execution is bounded by the smaller of the request timeout and 5 seconds. The helper records HTTP 429 and Retry-After without retrying indefinitely. See [metadata schema](references/metadata-schema.md) and [full-text workflow](references/full-text-workflow.md).

## Multidisciplinary Usage

Academic-Search now selects sources, query expansion, ranking rules, and output fields by discipline:

| Discipline | Focus |
|------------|-------|
| CS / AI | arXiv, Semantic Scholar, ACM/IEEE, Papers with Code, CCF/top-venue labels |
| Medicine / Life Science | PubMed, Europe PMC, MeSH, evidence ranking for systematic reviews and RCTs |
| Physics / Mathematics | arXiv categories, MSC, NASA ADS / INSPIRE HEP path reserved |
| Chemistry / Materials | Crossref, OpenAlex, ChemRxiv, ACS/RSC/Springer/Wiley access status |
| Social Science / Economics | JEL, RePEc/NBER/SSRN, method type, working-paper status |
| Humanities / Law | Books, chapters, archives, legal sources, with citation count as a secondary signal |

See [Multidisciplinary Improvement Analysis](docs/multidisciplinary-improvement-analysis.md) for the planning notes behind this expansion. For systematic reviews, seminal-paper lists, open full-text checks, or discipline-specific search tasks, the skill progressively loads references from `references/disciplines/`, `references/rankings/`, `references/workflows/`, and `references/site-patterns/`.

---

## Platforms and Access Strategy

| Platform | Access Method | Browser Needed |
|----------|--------------|:------------------------:|
| arXiv | REST API | No |
| Semantic Scholar | REST API | No |
| Crossref | REST API | No |
| OpenAlex | REST API | No |
| Unpaywall | REST API | No |
| PubMed | NCBI E-utilities | No |
| Papers with Code | Historical interface reference; verify availability before use | No |
| ACM DL | WebFetch + Jina | No |
| IEEE Xplore | WebFetch / Jina / Official API | No |
| ScienceDirect / Wiley / Springer / ACS | Open-access status check + institution-access notice | No |
| Google Scholar | CDP with automatically managed Chrome | **Yes** |
| CNKI | CDP with automatically managed Chrome | **Yes** |

Full-text retrieval only uses legal open-access routes. A reachable publisher page does not mean that the PDF is downloadable; institutional entitlements, Cloudflare checks, CAPTCHA pages, or HTML responses from PDF routes are reported as access status rather than bypassed.

---

## CDP Proxy API

`POST /wait` waits for named result, empty, or blocked conditions within a deadline. `click`, `clickAt`, and `setFiles` require unique selectors. Navigation includes `load_status`; page load alone does not establish task success. See the [browser workflow](references/browser-workflow.md).

The Proxy connects via WebSocket to managed Chrome or an explicitly selected running endpoint. `/health` reads current state, version and browser configuration without initiating a connection. It can report `connected:false` while the initial background connection is pending.

```bash
# The agent manages the Proxy lifecycle automatically — no manual startup needed
bash scripts/check-deps.sh

# Page operations
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/new?url=https://scholar.google.com"           # Open new tab
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/eval?target=ID" -d 'document.title'  # Execute JS
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/click?target=ID" -d 'button.submit'  # Click element
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/screenshot?target=ID&file=/tmp/shot.png"      # Screenshot
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/scroll?target=ID&direction=bottom"            # Scroll
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/close?target=ID"                              # Close tab
```

See `references/cdp-api.md` for the full API reference.

---

## Project Structure

```
academic-search/
├── Makefile                          # Standard test entry (make test / make test-release)
├── SKILL.md                          # Main instruction (search philosophy + platform matrix + capabilities)
├── README.md                         # Chinese README
├── README.en.md                      # English README (this file)
├── docs/
│   ├── skill-usage-comparison.md
│   └── multidisciplinary-improvement-analysis.md
├── scripts/
│   ├── cdp-proxy.mjs                 # CDP Proxy HTTP server (managed Chrome / explicit endpoint)
│   ├── check-deps.sh                 # Environment check + auto-start Proxy
│   ├── oa-pdf-download.mjs           # OA PDF manifest generation and open PDF download
│   ├── oa-pdf-download-self-test.sh  # Regression test for OA PDF download helper
│   ├── self-test.sh                  # Base regression test (installed Chrome / explicit endpoint)
│   └── release-test.sh               # Pre-release regression test (concurrency / invalid target / binary response)
└── references/
    ├── api-cookbook.md               # Multi-platform call reference (curl examples + field mappings)
    ├── metadata-schema.md            # Cross-platform unified metadata schema + dedup rules + BibTeX templates
    ├── venue-rankings.md             # CS conference/journal CCF tier reference
    ├── cdp-api.md                    # CDP Proxy HTTP API complete reference
    ├── browser-workflow.md           # Observation, condition waits and result verification
    ├── full-text-workflow.md         # OA evidence, file validation and download workflow
    ├── disciplines/                  # Discipline routing and query expansion profiles
    ├── rankings/                     # Non-CS evidence/source ranking references
    ├── workflows/                    # Systematic review and literature workflow templates
    └── site-patterns/
        ├── arxiv.org.md
        ├── semanticscholar.org.md
        ├── scholar.google.com.md
        ├── dl.acm.org.md
        ├── ieeexplore.ieee.org.md
        ├── pubmed.ncbi.nlm.nih.gov.md
        ├── paperswithcode.com.md
        ├── cnki.net.md
        ├── sciencedirect.com.md
        ├── onlinelibrary.wiley.com.md
        ├── link.springer.com.md
        └── pubs.acs.org.md
```

---

## Design Principles

> Skill = philosophy + technical facts, not an operations manual. Explain the tradeoffs and let the AI decide — don't do its reasoning for it.

- **Screen before enriching**: Select relevant candidates, then complete the fields and downloads already requested; the internal two-pass strategy does not require another approval.
- **Task-dependent ranking**: Relevance, inclusion criteria and disciplinary standards lead. Recency and source-specific citation counts are supporting signals.
- **API-first**: Prefer structured sources when they satisfy the request; use current browser capabilities for missing fields, dynamic pages or explicit user choices.
- **Traceable output**: Preserve field sources, ambiguous identity matches, separate citation counts and file verification status.
- **Scoped experience**: Read relevant site operations only; historical notes remain unverified until exercised and updates follow the host's authorization rules.

📋 **Historical Case Study**: [Skill vs. No-Skill Search Comparison](docs/skill-usage-comparison.md) records two earlier search runs. It does not establish a controlled performance gain or the current host's skill invocation behavior.

---

## License

MIT · Author: Mingyue Cheng
