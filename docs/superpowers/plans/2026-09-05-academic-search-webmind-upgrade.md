# Academic Search v1.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable page reading, safer evidence-aware browser actions, and executable academic-record validation and deduplication.

**Architecture:** Keep the existing Node/CDP proxy and dedicated Chrome runtime. Isolate browser-page expressions in `scripts/browser-page.mjs`, expose them through additive proxy endpoints, and add a separate streaming-free JSON CLI for academic records.

**Tech Stack:** Node.js 22 standard library, Chrome DevTools Protocol, Node test runner, Bash release checks, Markdown Skill references.

---

### Task 1: Page reading and browser actions

**Files:**
- Create: `scripts/browser-page.mjs`
- Create: `scripts/browser-page.test.mjs`
- Modify: `scripts/cdp-proxy.mjs`
- Modify: `scripts/browser-cdp.test.mjs`
- Modify: `scripts/browser-smoke.mjs`

- [x] **Step 1: Write failing extraction tests**

Add tests that call `/readPage` against a document with `nav`, hidden text, an article, duplicate links, repeated `citation_author` tags, other `citation_*` metadata, and more content than the configured limits. Assert unique explicit selectors, raw citation metadata arrays, extraction metadata, and independent truncation flags.

- [x] **Step 2: Verify the extraction tests fail**

Run `node --test scripts/browser-page.test.mjs scripts/browser-cdp.test.mjs`. Expected: failures because `browser-page.mjs` and `/readPage` do not exist.

- [x] **Step 3: Implement page extraction**

Export a builder that serializes validated options into a read-only browser expression. The returned page object must have this shape:

```js
{
  title: '', url: '', lang: '', text: '', headings: [], links: [], citation_meta: {},
  extraction: {
    method: 'semantic' | 'selector' | 'body', selector: '', heuristic: true,
    scope: 'current_frame_light_dom', candidate_scan_truncated: false
  },
  truncated: {
    title: false, url: false, lang: false, text: false, headings: false,
    links: false, citation_meta: false, extraction_selector: false
  }
}
```

Expose it through `POST /readPage?target=ID`, with `INVALID_ARGUMENT`, `INVALID_SELECTOR`, `ELEMENT_NOT_FOUND`, `SELECTOR_AMBIGUOUS`, and `ELEMENT_NOT_VISIBLE` responses consistent with the existing API.

- [x] **Step 4: Write failing action tests**

Cover disabled, `aria-disabled`, inert, hidden, pointer-disabled, and center-occluded targets; native setter fill plus `input`/`change`; focus before insertion; allowed and invalid keys; and JavaScript-dialog dispatch. Assert `status:"dispatched"`, `outcome_verified:false`, and separate immediate evidence fields.

- [x] **Step 5: Verify action tests fail**

Run `node --test scripts/browser-page.test.mjs scripts/browser-cdp.test.mjs`. Expected: missing endpoint and missing evidence-field failures.

- [x] **Step 6: Implement the minimal action behavior**

Use one shared unique-target inspection expression. `/fill` accepts `{selector,text}`; `/insertText` accepts `{selector,text}` and performs a synchronous exact-target DOM edit with explicit keyboard-semantics metadata; `/press` accepts `{key}`; `/handleJsDialog` accepts `{accept,prompt_text?}`. Keep payload limits and reject unknown fields where ambiguity would affect behavior.

- [x] **Step 7: Verify browser behavior**

Run `node --test scripts/browser-page.test.mjs scripts/browser-cdp.test.mjs` and `bash scripts/self-test.sh`. Expected: all tests pass and local task-owned tabs are closed.

### Task 2: Academic record validation and deduplication

**Files:**
- Create: `scripts/academic-records.mjs`
- Create: `scripts/academic-records.test.mjs`
- Create: `references/academic-records.md`
- Modify: `references/metadata-schema.md`

- [x] **Step 1: Write failing validation tests**

Test valid records, missing required keys, invalid identifiers and years, malformed citation provenance, malformed field provenance, and warnings for populated evidence-sensitive fields without a source.

- [x] **Step 2: Verify validation tests fail**

Run `node --test scripts/academic-records.test.mjs`. Expected: failure because the CLI module does not exist.

- [x] **Step 3: Implement validation and CLI IO**

Export `validateRecords(records)` and implement:

```text
node scripts/academic-records.mjs validate --input records.json --output validation.json
```

Write the JSON report atomically, emit its summary, and use exit code 1 when validation errors exist. Invalid JSON or arguments must not overwrite an existing output file.

- [x] **Step 4: Write failing deduplication tests**

Cover identifier normalization, transitive exact-ID groups, versioned arXiv IDs, conservative conflict preservation, provenance union, missing-field cleanup, stable ordering, and title-only candidates that remain separate.

- [x] **Step 5: Verify deduplication tests fail**

Run `node --test scripts/academic-records.test.mjs`. Expected: deduplication assertions fail before implementation.

- [x] **Step 6: Implement conservative deduplication**

Export `dedupeRecords(records)` and implement:

```text
node scripts/academic-records.mjs dedupe --input records.json --output deduplicated.json
```

Return `results`, `groups`, `possible_duplicates`, `conflicts`, and summary counts. Do not merge records based only on title similarity.

- [x] **Step 7: Verify record tooling**

Run `node --test scripts/academic-records.test.mjs` plus CLI tests using temporary files. Expected: all tests pass and no temporary output remains.

### Task 3: Skill routing, release documentation, and full verification

**Files:**
- Modify: `SKILL.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `references/browser-workflow.md`
- Modify: `references/cdp-api.md`
- Modify: `scripts/release-test.sh`
- Create: `docs/release-1.4.md`

- [x] **Step 1: Write failing release checks**

Add checks for version 1.4.0, discoverable references, documented endpoint and CLI examples, and stale claims that click completion proves a website outcome.

- [x] **Step 2: Verify release checks fail**

Run `bash scripts/release-test.sh`. Expected: documentation/version assertions fail.

- [x] **Step 3: Update progressive-disclosure routing and documentation**

Keep `SKILL.md` concise. Route browser reading/actions to `browser-workflow` and `cdp-api`; route validation/deduplication to `academic-records`. Update bilingual README files and release notes with actual implemented boundaries.

- [x] **Step 4: Run complete verification**

Run:

```text
make test-release
python3 /Users/chengmingyue/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
git diff --check
```

Expected: all suites exit 0, the Skill validator reports valid, and the diff check prints nothing.

- [x] **Step 5: Independent review**

Review the final diff against the design, then run realistic forward scenarios for a noisy article page, a dynamic academic result page, duplicate records with conflicting fields, and title-only candidates. Record any unverified public-site boundary rather than claiming benchmark success.
