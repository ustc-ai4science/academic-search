---
domain: semanticscholar.org
aliases: [Semantic Scholar, S2]
updated: 2026-04-01
---

## 平台特征

- AI2（艾伦人工智能研究院）维护的学术搜索引擎，覆盖 2 亿+ 论文
- 有完整的公开 REST API，JSON 格式
- 无 Key 可用，但速率受限；免费 Key 可提升速率（注册：https://www.semanticscholar.org/product/api#api-key）
- 引用数据较完整，支持引用/被引查询
- 支持用多种 ID 互查：DOI、arXiv ID、ACM ID、MAG ID、CorpusId

## 有效模式

### API 根 URL

```
https://api.semanticscholar.org/graph/v1/
```

### fields 参数（必须显式指定）

推荐常用组合：
```
fields=title,authors,year,abstract,citationCount,externalIds,openAccessPdf,venue,publicationTypes
```

完整可用字段：
- 基础：`title`, `abstract`, `year`, `venue`, `publicationDate`
- 作者：`authors`（含 `authorId`, `name`）
- 引用：`citationCount`, `referenceCount`, `influentialCitationCount`
- 标识：`externalIds`（含 DOI、ArXiv、PubMed、ACM、MAG）
- PDF：`openAccessPdf`（含 `url`, `status`）
- 类型：`publicationTypes`（JournalArticle/Conference/Review 等）

### paperId 格式

Semantic Scholar 接受多种 ID 格式作为 paper identifier：

| 格式 | 示例 |
|------|------|
| S2 内部 ID | `649def34f8be52c8b66281af98ae884c09aef38a` |
| DOI | `DOI:10.18653/v1/P16-1162` |
| arXiv ID | `ARXIV:1706.03762` |
| ACM | `ACM:3295222.3295349` |
| MAG | `MAG:112218234` |
| CorpusId | `CorpusId:13756489` |

### 作者 ID

作者 `authorId` 是数字字符串，可通过 author/search 获取：
```
/graph/v1/author/search?query={name}&fields=name,affiliations,paperCount
```

### 推荐论文

```
/recommendations/v1/papers/?positivePaperIds={id1},{id2}&fields=title,year,citationCount
```

## 已知陷阱

- `externalIds.ArXiv` 中 A 大写，代码中字段名大小写敏感（发现于 2026-04-01）
- `openAccessPdf` 为 null 不代表无 PDF，仅代表 S2 未收录该 PDF；此时需用 arXiv 或 Unpaywall 补充
- `authors` 字段默认只返回 `authorId` 和 `name`，不含机构信息，需单独查询 author 端点
- 批量查询（/paper/batch）上限 500 篇，超出需分批
- 无 Key 时偶发 429，重试间隔 10s 以上
- 某些非英文论文的 `abstract` 字段为 null，即使论文本身有摘要
