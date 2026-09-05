# Academic Search 1.4.0

This release turns four reliability rules into executable behavior: bounded page reading, safer browser actions, explicit action evidence, and machine-checkable academic records. The design adapts useful interface ideas observed in WebMind while keeping Academic Search's Node/CDP runtime, dedicated Chrome profile, unique-selector contract, academic routing, and PDF evidence model. WebMind is not a runtime or installation dependency.

## Structured page reading

`POST /readPage` returns visible text, headings, deduplicated HTTP(S) links, raw `citation_*` page declarations, the actual page URL, extraction metadata, and independent truncation flags. Repeated metadata such as `citation_author` remains an array. Callers may provide a unique visible selector or let the extractor score semantic content containers and fall back to `body`. The response explicitly labels the extraction as heuristic, limits it to the current frame's light DOM, and reports whether semantic-candidate scanning hit its budget.

This is a bounded DOM observation. Citation meta is a page claim rather than verified paper identity. The response does not claim complete paper text, dynamic-result completeness, OCR, iframe coverage, or Shadow DOM traversal. A truncated response must remain marked as truncated in downstream evidence.

## Reliable browser actions

The Proxy adds `/fill`, `/insertText`, `/press`, and `/handleJsDialog`. Element actions retain Academic Search's unique-selector requirement and add ancestor visibility, disabled, inert, pointer, size, and center-occlusion checks where relevant. Fill uses the native value setter, emits input/change events, and reports immediate value verification. Text insertion performs one synchronous exact-target DOM edit with cancellable `beforeinput` and `input`; it reports `keyboard_semantics:false`, while `/press` supplies real named-key behavior. Coordinate clicks revalidate element identity, coordinates, and occlusion before dispatch and capture the actual mouse-event target. Oversized POST bodies are rejected at 1 MiB with JSON 413 before the connection closes, and page extraction uses finite DOM traversal plus item-size budgets.

Successful actions return `status:"dispatched"` and `outcome_verified:false`. Immediate evidence may include `immediate_value_verified`, `immediate_text_verified`, `insert_target_verified`, or `dispatch_target_verified`. Compatibility fields such as `clicked:true` remain available, but they do not mean that a query completed or that a website saved, submitted, or published anything. Exact-target insertion prevents the tool's edit from landing in a sibling or iframe. Click guards block browser-default mouse actions when they observe a wrong target; earlier page capture or pointer handlers can still run the page's own side effects. The caller must observe the resulting page state.

`/handleJsDialog` handles page JavaScript alert, confirm, and prompt dialogs only. It cannot control Chrome's remote-debugging permission prompt, its automation banner, browser permission surfaces, native file pickers, or operating-system dialogs. The existing dedicated-profile default avoids attaching to everyday Chrome and therefore avoids the remote-debugging consent flow that motivated v1.3.1; websites can still show login, CAPTCHA, or consent pages.

## Academic-record validation and deduplication

`scripts/academic-records.mjs` provides two JSON workflows:

```bash
node scripts/academic-records.mjs validate --input results.json --output validation.json
node scripts/academic-records.mjs dedupe --input results.json --output deduplicated.json
```

Validation checks record shape, identifier formats, year values, citation-count provenance, and field-level source entries. Missing provenance for populated evidence-sensitive fields is reported as a warning rather than filled with invented data. Validation errors are written to the report and return a nonzero exit status.

Deduplication groups records only through valid exact normalized DOI, base arXiv ID, or positive PMID links. It merges missing values conservatively, unions arrays and provenance, and preserves source indices, arXiv versions, and conflicts. Equal normalized titles, including aliases within exact-ID components, remain separate in `possible_duplicates` for identity review when they occur across different components. Complete prior dedupe envelopes can be processed again without losing lineage; incomplete or internally inconsistent provenance envelopes are rejected. `fetched_at` must be a real, non-null calendar date.

## Compatibility

- The managed browser still uses a separate persistent profile at `~/.local/share/academic-search/chrome-profile` and a system-assigned Chrome debugging port.
- `CDP_PROXY_PORT` remains 3457 by default.
- Explicit `ACADEMIC_CHROME_ENDPOINT` configuration remains attach-only with no browser launch or fallback.
- API-only tasks do not start Chrome.
- Existing proxy endpoints and response fields remain available; new action-evidence fields are additive.

## Validation boundary

Offline tests exercise page extraction, action schemas and guards, record validation, identifier grouping, conflicts, provenance, and title-only candidates. Browser release tests use local task-owned fixtures. Public academic sites, login state, browser versions on other operating systems, and site-specific anti-bot behavior are outside those local fixtures and must be reported from current observations rather than inferred from this release.

Run `make test-offline` for fixture-only checks and `make test-release` for the full local browser gate. The [browser workflow](../references/browser-workflow.md), [CDP API](../references/cdp-api.md), and [academic-record reference](../references/academic-records.md) define the operational contracts and evidence limits.
