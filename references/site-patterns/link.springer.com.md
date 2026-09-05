---
domain: link.springer.com
aliases: [SpringerLink, Springer Nature]
updated: 2026-05-01
---

## Platform Characteristics

- SpringerLink exposes article pages and sometimes open PDFs.
- Closed articles may show metadata while PDF access requires entitlement.
- Some PDF routes return an HTML article page or access page.

## Effective Pattern

1. Use DOI metadata from Crossref/OpenAlex.
2. Check Unpaywall for legal OA locations.
3. On Springer pages, look for open-access labels before using PDF links.
4. Validate that the downloaded response is an actual PDF.

## Known Traps

- `content/pdf/...` routes are not always downloadable PDFs.
- Treat HTML from a PDF route as `full_text_status=html_not_pdf`.

## Evidence boundary

A candidate link or PDF MIME header does not verify file bytes. An HTML response from a PDF route does not prove readable full text or the absence of a separate PDF; inspect whether it is an article, login, challenge or error page. An OA index with no match supports only “not found in the checked sources.” See [full-text workflow](../full-text-workflow.md).
