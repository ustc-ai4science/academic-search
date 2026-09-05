# 学术论文元数据规范

跨平台统一的论文元数据结构，用于合并多平台结果、去重、导出 BibTeX。

---

## 标准 Schema（JSON）

```json
{
  "title": "Attention Is All You Need",
  "authors": ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
  "year": 2017,
  "publication_date": "2017-06-12",
  "publication_type": "conference",
  "venue": "NeurIPS 2017",
  "doi": "10.5555/3295222.3295349",
  "arxiv_id": "1706.03762",
  "pubmed_id": null,
  "pmcid": null,
  "orcid": [],
  "issn": null,
  "isbn": null,
  "cnki_url": null,
  "abstract": "The dominant sequence transduction models...",
  "keywords": [],
  "mesh_terms": [],
  "jel_codes": [],
  "msc_codes": [],
  "acm_ccs": [],
  "study_type": null,
  "sample_size": null,
  "population": null,
  "citation_count": 90000,
  "citation_counts": [{"platform": "semanticscholar", "count": 90000, "checked_at": "2026-04-01T00:00:00Z", "source_url": "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1706.03762"}],
  "field_sources": {
    "pdf_url": [{"platform": "arxiv", "source_url": "https://arxiv.org/abs/1706.03762", "checked_at": "2026-04-01T00:00:00Z", "evidence_type": "source_metadata"}]
  },
  "download_count": null,
  "open_access_status": "green",
  "license": null,
  "full_text_status": "open_pdf",
  "pdf_url": "https://arxiv.org/pdf/1706.03762",
  "local_pdf_path": null,
  "download_status": "not_requested",
  "download_error": null,
  "download_source": null,
  "final_url": null,
  "content_type": null,
  "checked_at": null,
  "byte_length": null,
  "sha256": null,
  "http_status": null,
  "retry_after": null,
  "download_error_code": null,
  "pdf_verification_status": "unverified",
  "paper_identity_status": "unverified",
  "data_availability": null,
  "code_url": null,
  "bibtex": "@inproceedings{vaswani2017attention,...}",
  "missing_fields": {},
  "source_platforms": ["arxiv", "semanticscholar"],
  "fetched_at": "2026-04-01"
}
```

以上为字段示例，数值和时间不代表实时查询结果。`full_text_status=open_pdf` 表示来源明确提供开放 PDF 入口；此示例尚未验证文件字节或论文身份。

### 字段说明

“必填”指输出应保留该键，不要求编造未知值。缺失的标量（包括标题、年份）允许 `null`，但 `fetched_at` 必须是非空且真实存在的 `YYYY-MM-DD` 日期；未知作者允许 `null` 或空数组并在 `missing_fields.authors` 注明原因。不要将未知计数填为 0。所有可选字段也允许 `null`。`missing_fields` 按字段名记录缺失原因；已知来源可保留于 `source_platforms`，未检索时不能虚构来源 URL 或查询时间。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 论文标题，保留原始大小写 |
| `authors` | string[] | 是 | 作者列表。优先使用可直接展示的自然人姓名；若来源仅提供缩写且无法可靠还原，允许保留原格式（如 PubMed 的 `Smith JA`） |
| `year` | integer | 是 | 发表年份（4 位整数） |
| `publication_date` | string | 否 | 发表日期，ISO 8601 格式；预印本、医学文献优先保留到日 |
| `publication_type` | string | 否 | 文献类型，如 `journal-article`、`conference`、`preprint`、`review`、`clinical-trial`、`book-chapter`、`working-paper` |
| `venue` | string | 否 | 会议/期刊名称，包含年份（如 `NeurIPS 2017`） |
| `doi` | string | 否 | 全局唯一标识，格式 `10.xxx/xxx` |
| `arxiv_id` | string | 否 | arXiv 标识，可含历史学科前缀或版本后缀；去重时分离基础 ID 与版本，保留原始标识 |
| `pubmed_id` | string | 否 | PubMed PMID |
| `pmcid` | string | 否 | PubMed Central 全文 ID |
| `orcid` | string[] | 否 | 作者 ORCID 列表，用于作者消歧 |
| `issn` | string | 否 | 期刊 ISSN |
| `isbn` | string | 否 | 图书或章节 ISBN |
| `cnki_url` | string | 否 | CNKI 论文详情页 URL（知网特有，格式 `https://kns.cnki.net/kcms2/article/abstract?v=...`） |
| `abstract` | string | 否 | 摘要原文 |
| `keywords` | string[] | 否 | 关键词列表（知网、部分期刊平台提供） |
| `mesh_terms` | string[] | 否 | 医学主题词 |
| `jel_codes` | string[] | 否 | 经济学 JEL 分类 |
| `msc_codes` | string[] | 否 | 数学 MSC 分类 |
| `acm_ccs` | string[] | 否 | 计算机 ACM CCS 分类 |
| `study_type` | string | 否 | 医学/社科研究类型，如 RCT、cohort、case-control、survey、qualitative |
| `sample_size` | integer | 否 | 研究样本量 |
| `population` | string | 否 | 研究对象、人群或样本来源 |
| `citation_count` | integer | 否 | 展示用引用数；必须能追溯到 `citation_counts` 中所选平台及时间，不跨平台相加 |
| `citation_counts` | object[] | 否 | 各平台独立计数：`platform`、`count`、`checked_at`、`source_url` |
| `field_sources` | object | 否 | 按字段名索引的证据数组，每项包含 `platform`、`source_url`、`checked_at`、`evidence_type`；可补 `note` 记录冲突与采用依据 |
| `download_count` | integer | 否 | 下载次数（CNKI 特有字段，其他平台为 null） |
| `open_access_status` | string | 否 | 开放获取状态，如 `gold`、`green`、`hybrid`、`bronze`、`closed`、`unknown` |
| `license` | string | 否 | 开放许可，如 `cc-by`、`cc-by-nc` |
| `full_text_status` | string | 否 | 来源/访问状态（不代表文件验证完成）：`open_pdf`、`login_required`、`needs_institution`、`no_open_pdf`、`anti_bot_blocked`、`html_not_pdf`、`unknown` |
| `pdf_url` | string | 否 | 来源提供或构造的 PDF 候选链接；仅构造地址时 `full_text_status=unknown`，并保持未验证 |
| `local_pdf_path` | string | 否 | 本地已下载 OA PDF 路径；仅当 `download_status=downloaded` 时填写 |
| `download_status` | string | 否 | OA PDF 下载状态：`not_requested`、`eligible`、`downloaded`、`skipped`、`failed`、`not_pdf` |
| `download_error` | string | 否 | 下载失败或跳过原因，成功时为 null |
| `download_source` | string | 否 | 实际下载来源，v1.3 起统一为实际 URL hostname：下载前取 `pdf_url`，收到响应后取 `final_url`；不根据论文 ID 或聚合平台推断 |
| `final_url` | string | 否 | 跟随重定向后实际响应 URL；未收到响应为 null |
| `content_type` | string | 否 | 响应声明的 MIME，不独立作为 PDF 格式证据 |
| `checked_at` | string | 否 | 本次下载尝试时间，ISO 8601 UTC 时间戳 |
| `byte_length` | integer | 否 | 完整读取的响应字节数；未读完为 null |
| `sha256` | string | 否 | 完整响应的 SHA-256；还需结合验证状态，不能单独证明它是 PDF |
| `http_status` | integer | 否 | 最终 HTTP 状态码；没有响应为 null |
| `retry_after` | string | 否 | HTTP Retry-After 原值；不存在为 null，不意味着自动重试 |
| `download_error_code` | string | 否 | 稳定错误类别，见下表；成功为 null |
| `pdf_verification_status` | string | 否 | 文件格式验证状态，见下表 |
| `paper_identity_status` | string | 否 | 下载器固定为 `unverified`；独立人工/正文身份核对可记 `matched` 或 `mismatch`，需附 `field_sources.paper_identity_status` 证据 |
| `data_availability` | string | 否 | 数据可得性说明或数据链接 |
| `code_url` | string | 否 | 代码仓库链接 |
| `bibtex` | string | 否 | BibTeX 格式引用 |
| `source_platforms` | string[] | 是 | 数据来源平台列表（含 `"cnki"` 时表示来自知网） |
| `missing_fields` | object | 否 | 缺失字段及原因，例如 `{"year":"来源未提供"}` |
| `fetched_at` | string | 是 | 抓取日期，ISO 8601 格式（YYYY-MM-DD） |

---

### OA PDF 下载状态

| 状态 | 含义 |
|------|------|
| `not_requested` | 未请求下载，仅完成元数据或 OA 状态判定 |
| `eligible` | `full_text_status=open_pdf` 且存在可公开访问的 `pdf_url`，可下载 |
| `downloaded` | 已下载到本地，`local_pdf_path` 有值 |
| `skipped` | 不满足下载条件，如需要机构权限、无开放 PDF、缺少 URL |
| `failed` | 网络错误、HTTP 错误或文件写入错误 |
| `not_pdf` | URL 返回内容不是 PDF 二进制 |

---

## 字段证据与全文判断

- `field_sources` 用字段对应的来源记录；不要仅列一组平台名就让所有字段看起来都得到交叉验证。`evidence_type` 可取 `source_metadata`、`page_text`、`pdf_text`、`download_response` 或 `inference`；推断要说明依据。
- 引用数的收录范围不同。保留各平台计数和时间，不取最大值来代表统一真值，也不混合计数。用户指定平台时按其选择展示。
- `open_pdf` 表示可信公开来源明确提供 PDF 入口，可进入下载清单；实际字节仍由 `pdf_verification_status` 描述。只有 arXiv ID 或构造 URL 时仍为 `unknown`。
- `no_open_pdf` 仅表示本次已检查来源未发现开放入口，必须记录检查范围，不能断言所有公开版本不存在。
- `html_not_pdf` 只描述所请求 PDF 地址实际返回 HTML，不能推断 HTML 是完整正文或不存在独立 PDF。明确登录要求用 `login_required`，明确机构订阅要求才用 `needs_institution`；挑战用 `anti_bot_blocked`，不把普通登录推断为机构权限。
- 开放属性与一次请求是否成功分开。访问受阻时保留来源报告的 `open_access_status`，另记录本次失败。

### PDF 验证状态与错误码

| `pdf_verification_status` | 含义 |
|---|---|
| `unverified` | 未完成格式验证；manifest 阶段或验证基础设施失败 |
| `parser_validated` | 字节通过基本 PDF 结构及 `pdfinfo` 解析检查；未确认论文身份 |
| `structure_checked_parser_unavailable` | 只通过基本签名、结尾、xref 检查；解析器不可用，不能宣称完整文件验证 |
| `not_pdf` | 响应不具备要求的 PDF 签名/内容 |
| `invalid_pdf` | PDF 结构或解析检查不通过 |

`download_error_code`：`http_error`、`rate_limited`、`timeout`、`not_pdf`、`invalid_pdf`、`network_error`、`write_error`、`pdf_parser_error`。跳过原因仍保留在原有 `download_error` 中，错误码可为 null。

保留旧 `download_status`：`not_pdf` 对应非 PDF；损坏 PDF 为 `failed` + `invalid_pdf`。下载器不会自动把来源元数据的 `full_text_status` 改成事实真值，展示时必须综合本次验证结果。`downloaded` 仅表示通过当前可用检查并已写入本地；论文身份核对是独立工作。

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

可执行校验与保守去重使用 `scripts/academic-records.mjs`，完整 CLI、输出字段、诊断码和退出码见 [academic-records.md](academic-records.md)。CLI 的 `index`、`source_indices` 均为原数组的零基位置。

### 可执行校验边界

`validate` 检查必填键、基础类型、标识符和年份格式，以及 `citation_counts` / `field_sources` 的证据记录结构；必填的 `fetched_at` 还必须是非空有效日期，`null` 是 error。证据敏感字段已有值但缺少对应来源时输出 warning，不补造 provenance，也不因缺少来源删除整条记录。验证 error 会让 CLI 在原子写出完整报告后以状态码 1 退出。

### 主键优先级

1. **DOI**：去除 DOI URL 前缀、首尾空白，大小写规范化后匹配同一记录；不同版本/更正关系保留，不任意合并
2. **arXiv ID**：按基础 ID 归组，保留版本后缀；版本必须从 `v1` 开始且序号不能全零，URL 只接受 `arxiv.org/abs/ID` 或 `arxiv.org/pdf/ID[.pdf]`；不同版本 PDF 不当作字节相同
3. **PubMed ID**：有效正整数 PMID 相同 → 同一篇论文；`0` 或全零输入无效
4. **标题线索**：可执行工具检查每个精确 ID 组中的所有原始标题，只把规范化后完全相同的实际标题列入 `possible_duplicates`；每个 result 在 `titles` 中保留首次出现的代表标题，在对应 `source_indices` 中列出该 result 内所有同规范化标题的来源位置，二者不按来源逐条一一对应。标题候选不自动合并；标题 + 年份 + 作者等组合可用于后续人工核对，避免同名论文误合并

自动去重将共享任一精确键的记录构造成连通组，因此不同标识符可以传递连接同一组。合并结果保留 `source_indices`；带版本的 arXiv ID 另以 `arxiv_versions` 保存原始 ID、版本标签和来源位置。无效标识符不参与匹配。完整 `dedupe` 输出再次交给 CLI 时，只有在 result lineage、groups、候选与冲突引用都自洽，`matched_by` 能由 result 或 identifier conflicts 支持，且所有仍可观察的带版本 arXiv 原值都被 `arxiv_versions` 覆盖时才原样保留；部分、矛盾或伪造的 provenance 会以 `INVALID_INPUT` 被拒绝。

### 字段合并策略

同一篇论文来自多个平台时，字段按以下优先级填充：

下表是人工裁决时的来源优先参考。CLI 不在来源证据或用户口径不足时自动套用该表：它保留组内最早的非空标量，把其他值及源索引写入 `conflicts`，并对数组、`citation_counts` 和 `field_sources` 做稳定去重并集。后续记录补齐字段时，会清除该字段已有的 `missing_fields` 标记。

| 字段 | 优先来源 |
|------|---------|
| `citation_count` | 用户指定来源优先；其余按明确展示口径选择，完整计数保留于 `citation_counts` |
| `open_access_status` | 保留来源与日期；有冲突时说明，不把任何单个平台当绝对真值 |
| `full_text_status` | 当前明确访问证据优先；保留独立 OA 声明及字段来源，网络失败不覆盖为“没有开放版本” |
| `pdf_url` | 优先可核验的合法公开来源；保留候选出处和实际访问结果 |
| `abstract` | Semantic Scholar > arXiv > CNKI > ACM/IEEE |
| `venue` | ACM DL > IEEE > CNKI > Semantic Scholar > arXiv |
| `doi` | ACM DL > IEEE > CNKI > Semantic Scholar > arXiv |
| `bibtex` | ACM DL > arXiv > 拼装生成 |
| `keywords` | CNKI > 出版商页面 > 其他平台 |
| `mesh_terms` | PubMed / Europe PMC |
| `jel_codes` | RePEc / Crossref / 出版商页面 |
| `code_url` | 论文/作者官方页面优先；第三方索引和搜索得到的仓库须核验作者关联 |
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
