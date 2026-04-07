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

<p align="center">Academic search and paper metadata extraction for Claude Code</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v1.2.0-0f766e" alt="version" />
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

<p align="center">
  <img src="assets/academic-search-framework.png" alt="Academic Search Skill Ecosystem" width="100%" />
</p>

academic-search skill brings academic-oriented retrieval strategy, cross-platform metadata normalization, and browser automation support to Claude Code. It is designed for paper discovery, author analysis, citation lookup, open-access PDF retrieval, BibTeX export, and structured literature comparison across multiple sources.

Compared with generic WebSearch and WebFetch, this skill focuses on three things: **platform selection for academic tasks**, **structured outputs**, and **reusable site-specific operational knowledge**.

## Quick Start

```bash
git clone https://github.com/ustc-ai4science/academic-search ~/.claude/skills/academic-search
bash ~/.claude/skills/academic-search/scripts/check-deps.sh
```

Once installed, you can immediately ask Claude Code to perform an academic search task, for example:

```text
Search for top-venue papers on graph neural networks published after 2023, give me the top 10
```

## News

- `2026-04-05` Added CNKI support docs: search strategy, metadata schema fields, and a dedicated site pattern file
- `2026-04-02` Released `v1.2.0`: frontier-first ranking, query expansion, direct PDF retrieval, and intent-aware two-pass search
- `2026-04-02` Added a new case study: [Skill vs. No-Skill Search Comparison](docs/skill-usage-comparison.md)
- `2026-04-02` Updated repository links to `ustc-ai4science/academic-search` and refreshed the README hero/content copy

## Table of Contents

- [Overview](#overview)
- [News](#news)
- [Core Features](#core-features)
- [Installation](#installation)
- [Requirements](#requirements)
- [Testing](#testing)
- [Usage Examples](#usage-examples)
- [Platforms and Access Strategy](#platforms-and-access-strategy)
- [CDP Proxy API](#cdp-proxy-api)
- [Project Structure](#project-structure)
- [Design Principles](#design-principles)
- [License](#license)

## Overview

- **Platform coverage**: arXiv, Semantic Scholar, Google Scholar, ACM DL, IEEE Xplore, PubMed, Papers with Code, and CNKI
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
| 8-platform coverage | arXiv / Semantic Scholar / Google Scholar / ACM DL / IEEE Xplore / PubMed / Papers with Code / CNKI |
| API-first strategy | 6 platforms via open APIs — no browser required, fast and stable |
| CDP browser mode | Google Scholar and other anti-bot platforms via direct Chrome connection, inheriting your login session |
| Two-pass search | First pass outputs a lightweight summary table; second pass deep-fetches full metadata only for confirmed papers. When user specifies count ("top N"), outputs directly without waiting |
| Frontier-first ranking | **Recency first** (papers from last 6 months labeled `[new]` and surfaced to top) → citation count → CCF tier (as reference only) |
| Query expansion | Automatically expands to 2-3 complementary queries (synonyms / sub-concepts / abbreviations), improving recall by 30-50% |
| Venue tier labels | CS conferences/journals annotated with CCF ranking (A/B/C); ICLR labeled separately |
| Result filtering | Filter by recency / citation count / venue tier / open PDF / code availability |
| Structured metadata | Unified schema across all platforms; DOI as primary dedup key |
| PDF direct link | ArXiv ID present → construct link directly; does not rely on `openAccessPdf` (often null in S2) |
| BibTeX export | Platform-native export + field-assembly fallback |
| Code availability | Papers with Code API auto-fills code column for ML papers |
| Citation graph | S2 citations/references API; Google Scholar citation counts as supplement |
| Failure signal handling | 429 / timeout / empty results each have explicit direction adjustments — no blind retries |
| Parallel sub-agents | Independent targets dispatched to parallel sub-agents sharing one Proxy, tab-level isolation |
| Pre-seeded site knowledge | 8 platforms ship with verified operation patterns (URL structures, selectors, known pitfalls) |

<details>
<summary>v1.2.0 Changes</summary>

- **Frontier-first ranking** — Recency as top priority: papers from last 6 months labeled `[new]` and surfaced first; citation count second; CCF tier as reference only
- **Query expansion strategy** — Auto-expands to synonyms / sub-concepts / abbreviations; multi-query dedup improves recall by 30-50%
- **PDF direct link** — ArXiv ID present → construct link directly, bypassing unreliable `openAccessPdf` field
- **Intent-aware two-pass** — When user specifies "top N papers", outputs directly without stopping to confirm
- **Failure signal table** — 429 / timeout / empty results each map to explicit direction adjustments
- **Success criteria definition** — Define field requirements and count before executing; used as decision anchor throughout
- **S2 API Key hint** — Recommends free key registration to avoid frequent 429s in single sessions

</details>

<details>
<summary>v1.1.0 Changes</summary>

- **Two-pass search strategy** — Lightweight summary table first; deep fetch only after core papers are confirmed
- **Venue rankings reference** — New `references/venue-rankings.md` covering AI/ML/CV/NLP/Data Mining/IR/Systems/SE CCF tiers
- **Explicit filtering capability** — New filtering section with 5 dimensions and output template

</details>

---

## Installation

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

arXiv, Semantic Scholar, PubMed, and other API-based platforms work out of the box with no setup.

CDP mode requires **Node.js 22+** and Chrome remote debugging:

1. Open `chrome://inspect/#remote-debugging` in Chrome's address bar
2. Check **Allow remote debugging for this browser instance** (browser restart may be required)

Environment check (the agent runs this automatically — no need to run manually):

```bash
bash ~/.claude/skills/academic-search/scripts/check-deps.sh
```

## Testing

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

If `3456` or the default test port `4568` is already occupied, override it explicitly:

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

---

## Platforms and Access Strategy

| Platform | Access Method | Requires Chrome Debugging |
|----------|--------------|:------------------------:|
| arXiv | REST API | No |
| Semantic Scholar | REST API | No |
| PubMed | NCBI E-utilities | No |
| Papers with Code | REST API | No |
| ACM DL | WebFetch + Jina | No |
| IEEE Xplore | WebFetch / Jina / Official API | No |
| Google Scholar | CDP browser | **Yes** |
| CNKI | CDP browser | **Yes** |

---

## CDP Proxy API

The Proxy connects to Chrome via WebSocket (compatible with the `chrome://inspect` method — no command-line flags needed) and exposes an HTTP API:

```bash
# The agent manages the Proxy lifecycle automatically — no manual startup needed
bash ~/.claude/skills/academic-search/scripts/check-deps.sh

# Page operations
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/new?url=https://scholar.google.com"           # Open new tab
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=ID" -d 'document.title'  # Execute JS
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/click?target=ID" -d 'button.submit'  # Click element
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/screenshot?target=ID&file=/tmp/shot.png"      # Screenshot
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/scroll?target=ID&direction=bottom"            # Scroll
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/close?target=ID"                              # Close tab
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
├── scripts/
│   ├── cdp-proxy.mjs                 # CDP Proxy HTTP server (connects to user's Chrome)
│   ├── check-deps.sh                 # Environment check + auto-start Proxy
│   ├── self-test.sh                  # Base local regression test (requires Chrome remote debugging)
│   └── release-test.sh               # Pre-release regression test (concurrency / invalid target / binary response)
└── references/
    ├── api-cookbook.md               # 8-platform call reference (curl examples + field mappings)
    ├── metadata-schema.md            # Cross-platform unified metadata schema + dedup rules + BibTeX templates
    ├── venue-rankings.md             # CS conference/journal CCF tier reference
    ├── cdp-api.md                    # CDP Proxy HTTP API complete reference
    └── site-patterns/
        ├── arxiv.org.md
        ├── semanticscholar.org.md
        ├── scholar.google.com.md
        ├── dl.acm.org.md
        ├── ieeexplore.ieee.org.md
        ├── pubmed.ncbi.nlm.nih.gov.md
        ├── paperswithcode.com.md
        └── cnki.net.md
```

---

## Design Principles

> Skill = philosophy + technical facts, not an operations manual. Explain the tradeoffs and let the AI decide — don't do its reasoning for it.

- **The bottleneck is filtering, not searching**: Output a lightweight summary table first; let the user identify core papers before deep-fetching — avoids redundant full metadata pulls
- **Frontier-first ranking**: Recency → citations → CCF tier. Papers from the last 6 months are labeled `[new]` and surfaced to the top — new papers in active research areas have naturally low citation counts but represent the latest advances
- **API-first**: Never simulate a browser for platforms that offer a public API — faster, more stable, no anti-bot exposure
- **CDP is the last resort, not the default**: Only used when no reliable API exists (Google Scholar)
- **Structured output**: All results converted to a unified schema, DOI as dedup key, directly exportable as BibTeX

📋 **Case Study**: [Skill vs. No-Skill Search Comparison](docs/skill-usage-comparison.md) — A controlled experiment searching "Time Series Agent" papers with and without the skill, documenting execution paths, result differences, and key takeaways.
- **Site knowledge reuse**: 7 platforms ship with pre-seeded operation experience; accumulated and updated across sessions

---

## License

MIT · Author: Mingyue Cheng
