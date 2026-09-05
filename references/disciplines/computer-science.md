# Computer Science Discipline Profile

## Use When

Use for computer science, AI, ML, NLP, CV, systems, software engineering, databases, security, HCI, IR, and data mining tasks.

## Platform Route

| Need | Preferred Sources |
|------|-------------------|
| Broad paper search | Semantic Scholar, OpenAlex |
| Preprints | arXiv |
| CS venue metadata | ACM DL, IEEE Xplore, DBLP |
| Code and benchmarks | Paper/author project pages and official repositories; third-party indexes require validation |
| Citation counts | Google Scholar, Semantic Scholar |
| DOI / publisher metadata | Crossref |

## Query Expansion

- Expand abbreviations and full names: `LLM` / `large language model`, `GNN` / `graph neural network`.
- Add task and benchmark terms when relevant: dataset names, leaderboards, challenge names.
- Use ACM CCS terms when the query is broad or ambiguous.
- For recent AI topics, include arXiv and preprint wording; do not filter out low-citation new papers.

## Ranking

1. Recent papers in the last 6 months.
2. Venue quality using `references/venue-rankings.md`.
3. Citation count within comparable publication years.
4. Code/data availability when the user needs implementation value.

## Output Fields

Always include title, authors, year, venue, citation count, DOI/arXiv ID, PDF status, and code URL when available.
