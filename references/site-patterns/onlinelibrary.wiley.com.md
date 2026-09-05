---
domain: onlinelibrary.wiley.com
aliases: [Wiley Online Library, AGU Wiley]
updated: 2026-05-01
---

## Platform Characteristics

- Wiley hosts many journals, including AGU publications under `agupubs.onlinelibrary.wiley.com`.
- Open-access articles may provide PDF links; subscription articles require institution access.
- Bot-protection or entitlement checks can return 403 or HTML instead of PDF bytes.

## Effective Pattern

1. Query Unpaywall by DOI first.
2. If Unpaywall has no OA PDF, inspect the Wiley page for OA/license labels.
3. Validate PDF responses by `Content-Type: application/pdf` or PDF header bytes.
4. Report `needs_institution`, `anti_bot_blocked`, or `html_not_pdf` instead of retrying blindly.

## Known Traps

- Browser fallback can stop at Cloudflare/security verification.
- AGU article pages may be reachable while PDF downloads remain restricted.

## Evidence boundary

A candidate link or PDF MIME header does not verify file bytes. An HTML response from a PDF route does not prove readable full text or the absence of a separate PDF; inspect whether it is an article, login, challenge or error page. An OA index with no match supports only “not found in the checked sources.” See [full-text workflow](../full-text-workflow.md).
