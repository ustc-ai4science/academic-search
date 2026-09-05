# Academic Search 1.3

This update makes retrieval and download outcomes easier to verify while preserving API-first search and discipline-specific guidance.

## Browser behavior

- `POST /wait` accepts observed selectors for named result, empty, blocked, login and rate-limit states. Conditions are read-only and bounded; an elapsed wait never means that no papers exist.
- `click`, `clickAt` and `setFiles` reject selectors matching multiple elements. Callers must scope an action to the intended result row or form.
- Navigation reports `load_status`. New-tab and back-navigation checks avoid accepting the previous document as the completed destination.
- A disconnected browser rejects pending commands with `CDP_DISCONNECTED`, rather than disguising the failure as a selector timeout.
- Browser regression tests verify the identity of their own proxy and operate only on their own fixture tabs.

## PDF and metadata evidence

- A candidate URL, an OA declaration, validated file bytes and a matched paper identity are separate claims.
- The downloader checks actual PDF structure and uses optional `pdfinfo` for parsing. Wrong MIME, HTML, truncated files and failed parsing cannot silently become successful downloads.
- Network and parser operations are bounded. The manifest preserves final URL, response status, Retry-After, byte count, SHA-256, error category and format verification status, together with caller-supplied field evidence.
- Citation counts retain their source and checked time. Unknown required metadata remains null with a missing-field reason.
- Ordinary login requirements use `login_required`; they do not imply an institutional subscription.

## Compatibility notes

- Existing download status names remain. New evidence fields are additive. Invalid PDF structure uses `download_status=failed` with `download_error_code=invalid_pdf`.
- `download_source` now contains the URL hostname, updated to the final response hostname after redirects. It no longer infers a provider from an arXiv ID or the ordering of `source_platforms`.
- `full_text_status=open_pdf` means that a trustworthy source explicitly offers an open PDF entry point. It does not mean that its bytes have already been validated. A URL constructed from an ID alone remains `unknown`.
- Existing callers using broad selectors may now receive an ambiguity error. Observe the page and provide a unique selector instead of selecting the first result silently.
- Strict PDF checks can reject recoverable files. Without `pdfinfo`, `structure_checked_parser_unavailable` denotes limited structural checks. The downloader never verifies paper identity automatically.

## Skill workflow

The entrypoint links to browser and full-text workflows only when needed. Existing requests for complete metadata or open PDF downloads authorize the corresponding steps without another confirmation. Historical Scholar, S2 and CNKI experience is explicitly marked unverified until exercised against the current service.

No search-coverage percentage or live-platform availability is inferred from the local tests. The metadata schema describes the agent's output contract; the download helper is not a general metadata validator.

## Validation

Run `make test-offline` for local HTTP/CDP fixtures without Chrome. Run `make test-release` to include real Chrome smoke and release checks. The suite covers condition waits, connection loss, ambiguous actions, navigation, proxy isolation, redirects, PDF format failures, response timeouts and CLI paths containing spaces.

See [CDP API](../references/cdp-api.md), [metadata schema](../references/metadata-schema.md), [browser workflow](../references/browser-workflow.md) and [full-text workflow](../references/full-text-workflow.md) for the complete contracts.
