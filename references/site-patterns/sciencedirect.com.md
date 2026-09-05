---
domain: sciencedirect.com
aliases: [ScienceDirect, Elsevier]
updated: 2026-05-01
---

## Platform Characteristics

- Elsevier publisher platform.
- Article landing pages may be public, but PDFs often require institutional entitlement.
- Some open-access articles expose a PDF link, but closed articles should be marked `needs_institution`.

## Effective Pattern

1. Resolve DOI to the article page.
2. Check metadata and open-access labels.
3. Prefer Unpaywall before attempting publisher PDF routes.
4. If a PDF URL returns HTML, login, or entitlement pages, classify `html_not_pdf`, `login_required`, or `needs_institution` according to the actual evidence; a login page alone does not prove an institutional entitlement is required.

## Known Traps

- HTTP 403 or redirected login pages are access restrictions, not retryable download failures.
- A visible article abstract does not imply PDF access.
- Do not use third-party paywall bypass services.

## Evidence boundary

A candidate link or PDF MIME header does not verify file bytes. An HTML response from a PDF route does not prove readable full text or the absence of a separate PDF; inspect whether it is an article, login, challenge or error page. An OA index with no match supports only “not found in the checked sources.” See [full-text workflow](../full-text-workflow.md).
