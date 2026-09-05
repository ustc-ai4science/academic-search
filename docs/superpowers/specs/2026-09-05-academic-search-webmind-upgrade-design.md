# Academic Search Browser and Record Reliability Design

## Goal

Upgrade Academic Search from v1.3.1 to v1.4.0 with reusable webpage reading, safer browser input, explicit action evidence, and executable academic-record validation and deduplication. Preserve the existing academic routing, PDF verification, dedicated Chrome runtime, target ownership, and evidence boundaries.

## Browser interface

The existing Node HTTP proxy remains the only bundled browser runtime. New page-side helpers live in a focused module and generate expressions executed through the existing CDP session.

`POST /readPage?target=ID` accepts JSON with optional `selector`, `max_chars` (default 20000), and `max_links` (default 100). It returns `page.title`, `url`, `lang`, cleaned visible `text`, bounded `headings`, deduplicated HTTP(S) `links`, `extraction`, and independent `truncated` flags. An explicit selector must match exactly one visible region. Automatic extraction scores article-like containers and falls back to the body. It ignores scripts, forms, navigation, sidebars, hidden content, iframes, and other non-content elements. The response states that extraction is heuristic; it does not imply complete full text, OCR, Shadow DOM, or iframe coverage.

New action endpoints are `POST /fill`, `POST /insertText`, `POST /press`, and `POST /handleJsDialog`. Element endpoints require one unique, visible, enabled, non-inert target. Pointer actions also reject zero-size, pointer-disabled, and center-occluded elements. `/fill` uses the native value setter where applicable, dispatches `input` and `change`, and reports immediate value verification. `/insertText` verifies focus before CDP text insertion. `/press` validates a bounded key vocabulary or one Unicode character. `/handleJsDialog` handles the current JavaScript alert, confirm, or prompt; it does not operate browser-native or OS dialogs.

Existing `/click` and `/clickAt` gain the same actionability checks. Successful actions return `status:"dispatched"` and `outcome_verified:false`. Immediate checks use separate fields such as `immediate_value_verified` and `focus_verified`; no action response claims that the website accepted, saved, submitted, or published anything.

## Academic record interface

Add a standard-library Node CLI, `scripts/academic-records.mjs`, with `validate` and `dedupe` commands. Both accept `--input` and `--output`; input may be an array or an object with `results`.

Validation returns a machine-readable report with record indices, errors, warnings, and summary counts. It validates required keys and basic types, DOI/arXiv/PMID formats, years, citation-source records, and `field_sources` entries. Populated evidence-sensitive fields without corresponding provenance produce warnings rather than fabricated provenance or wholesale rejection. Errors cause a nonzero exit status after the report is written.

Deduplication builds connected groups only from exact normalized DOI, base arXiv ID, or PMID matches. It merges missing values conservatively, unions arrays and provenance, preserves conflicts and original source indices, and records arXiv version labels. It does not automatically merge title-only matches. Normalized equal titles without a shared exact identifier are returned as `possible_duplicates` for later identity review.

## Documentation and compatibility

The Skill entrypoint remains concise and routes record normalization to a new reference. Browser protocol details stay in `references/cdp-api.md`. README files document the new executable capabilities and evidence limits. The release note identifies the source of the design influence without making WebMind a runtime dependency.

The proxy keeps its v1.3.1 managed-profile and endpoint behavior. API-only academic tasks still do not start Chrome. Existing endpoint response fields remain available; new evidence fields are additive except that successful click responses now describe dispatch rather than implying a verified business outcome.

## Verification

Tests must first fail for every new behavior. Offline tests cover extraction, truncation, unique selectors, actionability, input events, key validation, dialog handling, record validation, exact-identifier grouping, conflicts, provenance, and title-only candidates. Real Chrome smoke tests cover reading and form interaction on local fixtures. The full release suite, Skill validator, link checks, syntax checks, and clean diff checks gate completion.

