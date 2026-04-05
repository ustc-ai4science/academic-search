# 学术论文元数据规范

跨平台统一的论文元数据结构，用于合并多平台结果、去重、导出 BibTeX。

---

## 标准 Schema（JSON）

```json
{
  "title": "Attention Is All You Need",
  "authors": ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
  "year": 2017,
  "venue": "NeurIPS 2017",
  "doi": "10.5555/3295222.3295349",
  "arxiv_id": "1706.03762",
  "pubmed_id": null,
  "cnki_url": null,
  "abstract": "The dominant sequence transduction models...",
  "keywords": [],
  "citation_count": 90000,
  "download_count": null,
  "pdf_url": "https://arxiv.org/pdf/1706.03762",
  "bibtex": "@inproceedings{vaswani2017attention,...}",
  "source_platforms": ["arxiv", "semanticscholar"],
  "fetched_at": "2026-04-01"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 论文标题，保留原始大小写 |
| `authors` | string[] | 是 | 作者列表。优先使用可直接展示的自然人姓名；若来源仅提供缩写且无法可靠还原，允许保留原格式（如 PubMed 的 `Smith JA`） |
| `year` | integer | 是 | 发表年份（4 位整数） |
| `venue` | string | 否 | 会议/期刊名称，包含年份（如 `NeurIPS 2017`） |
| `doi` | string | 否 | 全局唯一标识，格式 `10.xxx/xxx` |
| `arxiv_id` | string | 否 | arXiv ID，仅数字+点格式（如 `1706.03762`） |
| `pubmed_id` | string | 否 | PubMed PMID |
| `cnki_url` | string | 否 | CNKI 论文详情页 URL（知网特有，格式 `https://kns.cnki.net/kcms2/article/abstract?v=...`） |
| `abstract` | string | 否 | 摘要原文 |
| `keywords` | string[] | 否 | 关键词列表（知网、部分期刊平台提供） |
| `citation_count` | integer | 否 | 引用数（来自 Scholar 或 Semantic Scholar） |
| `download_count` | integer | 否 | 下载次数（CNKI 特有字段，其他平台为 null） |
| `pdf_url` | string | 否 | 可公开访问的 PDF 直链 |
| `bibtex` | string | 否 | BibTeX 格式引用 |
| `source_platforms` | string[] | 是 | 数据来源平台列表（含 `"cnki"` 时表示来自知网） |
| `fetched_at` | string | 是 | 抓取日期，ISO 8601 格式（YYYY-MM-DD） |

---

## Markdown 表格模板

单篇论文输出：

```markdown
| 字段 | 内容 |
|------|------|
| 标题 | Attention Is All You Need |
| 作者 | Vaswani et al. (2017) |
| Venue | NeurIPS 2017 |
| DOI | 10.5555/3295222.3295349 |
| arXiv | 1706.03762 |
| 引用数 | ~90,000 |
| PDF | https://arxiv.org/pdf/1706.03762 |
| 摘要 | The dominant sequence transduction... |
```

多篇论文列表输出：

```markdown
| 标题 | 作者 | 年份 | Venue | 引用 | PDF |
|------|------|------|-------|------|-----|
| Attention Is All You Need | Vaswani et al. | 2017 | NeurIPS | 90k | [PDF](url) |
| BERT | Devlin et al. | 2019 | NAACL | 60k | [PDF](url) |
```

---

## 多平台去重规则

多个子 Agent 并行查询同一目标时，结果需按以下优先级合并去重：

### 主键优先级

1. **DOI**（全局唯一，最可靠）：DOI 相同 → 同一篇论文
2. **arXiv ID**：arXiv ID 相同 → 同一篇论文
3. **PubMed ID**：PMID 相同 → 同一篇论文
4. **标题 + 年份 + 作者首字母**：以上都没有时的模糊匹配

### 字段合并策略

同一篇论文来自多个平台时，字段按以下优先级填充：

| 字段 | 优先来源 |
|------|---------|
| `citation_count` | Google Scholar > Semantic Scholar > CNKI > 其他 |
| `pdf_url` | arXiv > Semantic Scholar openAccessPdf > CNKI > 其他 |
| `abstract` | Semantic Scholar > arXiv > CNKI > ACM/IEEE |
| `venue` | ACM DL > IEEE > CNKI > Semantic Scholar > arXiv |
| `doi` | ACM DL > IEEE > CNKI > Semantic Scholar > arXiv |
| `bibtex` | ACM DL > arXiv > 拼装生成 |
| `keywords` | CNKI > 其他平台（若其他平台不提供则仅来自 CNKI） |
| `download_count` | 仅 CNKI 提供，无需合并 |

### 合并示例

```
arXiv 结果：  { title: "BERT...", arxiv_id: "1810.04805", pdf_url: "https://arxiv.org/pdf/1810.04805" }
S2 结果：     { title: "BERT...", arxiv_id: "1810.04805", citation_count: 65000, doi: "10.18653/..." }
→ 合并后：   { title: "BERT...", arxiv_id: "1810.04805", doi: "10.18653/...",
               pdf_url: "https://arxiv.org/pdf/1810.04805", citation_count: 65000 }
```

---

## BibTeX 拼装模板

当平台无法直接导出 BibTeX 时，根据 schema 字段拼装：

### 会议论文（@inproceedings）

```bibtex
@inproceedings{[citation_key],
  title     = {[title]},
  author    = {[authors, joined by " and "]},
  booktitle = {[venue]},
  year      = {[year]},
  doi       = {[doi]},
  url       = {[pdf_url]}
}
```

### 期刊论文（@article）

```bibtex
@article{[citation_key],
  title   = {[title]},
  author  = {[authors, joined by " and "]},
  journal = {[venue]},
  year    = {[year]},
  doi     = {[doi]},
  url     = {[pdf_url]}
}
```

### 预印本（@misc，用于无正式 venue 的 arXiv 论文）

```bibtex
@misc{[citation_key],
  title         = {[title]},
  author        = {[authors, joined by " and "]},
  year          = {[year]},
  eprint        = {[arxiv_id]},
  archivePrefix = {arXiv},
  url           = {https://arxiv.org/abs/[arxiv_id]}
}
```

**citation_key 生成规则**：`{作者姓氏小写}{年份}{标题第一个实词小写}`。若首位作者是 PubMed 风格的 `LastName Initials`，姓氏取第一个空格前的片段。  
示例：`vaswani2017attention`、`devlin2019bert`

---

## 平台字段名对照表

| 标准字段 | arXiv XML | Semantic Scholar | PubMed esummary docsum | ACM JSON-LD | IEEE API | CNKI CDP |
|---------|-----------|-----------------|---------------|-------------|---------|---------|
| title | `<title>` | `title` | `title` | `name` | `title` | `td.name a` / `h1.title` |
| authors | `<author><name>` | `authors[].name` | `authors[].name`（常为 `LastName Initials`） | `author[].name` | `authors.authors[].full_name` | `td.author` / `.author a` |
| year | `<published>`[0:4] | `year` | `pubdate`[0:4] | `datePublished`[0:4] | `publication_year` | `td.date`[0:4] |
| doi | `<arxiv:doi>` | `externalIds.DOI` | `articleids[doi].value` | `@id`（DOI URL） | `doi` | `.doi a` |
| arxiv_id | `<id>`（末段） | `externalIds.ArXiv` | - | - | - | - |
| abstract | `<summary>` | `abstract` | （需 efetch） | `description` | `abstract` | `#ChDivSummary` |
| citation_count | - | `citationCount` | - | - | `citing_paper_count` | `td.quote a` |
| download_count | - | - | - | - | - | `td.download a` |
| keywords | - | - | - | - | - | `.keyword a` |
| cnki_url | - | - | - | - | - | `location.href`（详情页） |
| pdf_url | `<link type=pdf>` | `openAccessPdf.url` | - | - | `pdf_url` | `.btn-dlcaj` / `.btn-pdfdown`（需登录） |
