# Systematic Review Workflow

Use for systematic reviews, reproducible searches, PRISMA-style screening or evidence maps. Report the coverage actually achieved; a formatted flow diagram does not establish a complete systematic review.

## Search and screening

1. Derive the research question, inclusion/exclusion criteria and dates from the request. Use PICO where appropriate. Clarify only an unresolved choice that materially changes eligibility; existing criteria and authorization remain valid.
2. Read the relevant discipline profile, choose appropriate databases, and record the reason for coverage. Preserve each exact search string, filters, search date, response count and any retrieval cap or access failure.
3. Retrieve and export the screening records. If full metadata or abstract screening was requested, continue beyond a lightweight first pass without an extra confirmation.
4. Deduplicate using the [metadata schema](../metadata-schema.md). Preserve source records and version relationships; ambiguous title matches require identity checks rather than automatic merging.
5. Screen titles/abstracts against the stated criteria. Record `include`, `exclude` or `maybe`, with an exclusion reason; do not invent a second independent reviewer or resolve ambiguous evidence by assertion.
6. Follow the [full-text workflow](../full-text-workflow.md), preserving candidate URLs, OA evidence, response/file verification and paper identity separately. Unavailable full text is a retrieval limitation, not automatically a scientific exclusion reason.
7. Extract the requested fields with evidence locations and source type (abstract, HTML or PDF). Apply a suitable risk-of-bias method when requested and supported; distinguish completed assessment from unavailable evidence.

## Screening record

| Fields | Purpose |
|---|---|
| title, authors, year, venue, publication_type | Screening and identity |
| doi, pubmed_id, pmcid, arxiv_id | Deduplication and version links |
| source_platforms, fetched_at, query/filter log | Search provenance |
| abstract, include_decision, exclusion_reason | Reproducible eligibility decisions |
| full_text_status, pdf_url, pdf_verification_status | Full-text evidence and limitations |
| extraction evidence / assessment notes | Traceable synthesis |

Keep retrieval, deduplication and screening counts reconcilable. Separately report records found, duplicates removed, records screened, reports sought, reports unavailable and final inclusions where applicable. A CAPTCHA, timeout or stale selector is not a zero-result query; use the [browser workflow](../browser-workflow.md) when a database needs browser access.

## Completion and limits

Continue all authorized work that the available evidence supports. If only one database was searched, queries were not logged, required texts remain inaccessible or a requested risk assessment is incomplete, explain the specific limitation and deliver the completed artifacts. Do not claim exhaustive coverage or formal review completeness. Ask only for missing decisions or access that materially block the remaining requested work; these limitations alone do not require an additional approval gate.
