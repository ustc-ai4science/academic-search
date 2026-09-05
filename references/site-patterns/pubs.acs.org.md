---
domain: pubs.acs.org
aliases: [ACS Publications, American Chemical Society]
updated: 2026-05-01
---

## Platform Characteristics

- ACS is a major chemistry publisher.
- Metadata pages are commonly visible; PDF access often depends on OA status or institution access.
- Chemistry users may need supplementary information as much as the main PDF.

## Effective Pattern

1. Resolve DOI and collect Crossref metadata.
2. Query Unpaywall for OA status and legal PDF URL.
3. If on publisher page, check for open-access labels and supplementary information links.
4. Validate PDF content before saving.

## Known Traps

- Publisher page access is not PDF access.
- Supplementary files can have separate links and licenses.
- Do not attempt paywall bypasses.

## Evidence boundary

A candidate link or PDF MIME header does not verify file bytes. An HTML response from a PDF route does not prove readable full text or the absence of a separate PDF; inspect whether it is an article, login, challenge or error page. An OA index with no match supports only “not found in the checked sources.” See [full-text workflow](../full-text-workflow.md).
