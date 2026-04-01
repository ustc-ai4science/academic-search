---
domain: arxiv.org
aliases: [arXiv, arxiv]
updated: 2026-04-01
---

## 平台特征

- 完全开放的预印本服务器，无反爬机制，无需登录
- 官方 API：`https://export.arxiv.org/api/query`，返回 Atom XML
- 主要覆盖：cs、math、physics、stat、q-bio、econ 等领域
- 论文 ID 格式：2007 年后为 `YYMM.NNNNN`（如 `2301.00001`）；2007 年前为 `archive/YYMMNNN`（如 `cs/0603026`）
- PDF 无需鉴权，直接可访问

## 有效模式

### API 搜索

```
https://export.arxiv.org/api/query?search_query={query}&start={offset}&max_results={n}&sortBy=submittedDate&sortOrder=descending
```

- `max_results` 上限：2000（单次请求）
- 分页：通过 `start` 参数（0-based）
- 时间范围过滤：`submittedDate:[20230101+TO+20231231]`（含在 search_query 中，用 AND 连接）

### URL 规律

| 用途 | URL |
|------|-----|
| 论文主页 | `https://arxiv.org/abs/{arxiv_id}` |
| PDF 直链 | `https://arxiv.org/pdf/{arxiv_id}` |
| BibTeX | `https://arxiv.org/bibtex/{arxiv_id}` |
| HTML 版本 | `https://arxiv.org/html/{arxiv_id}` |

### XML 解析要点

- 命名空间：`xmlns:arxiv="http://arxiv.org/schemas/atom"`
- 每篇论文在一个 `<entry>` 节点内
- `<id>` 字段格式：`http://arxiv.org/abs/1706.03762v1`，arXiv ID = URL 末段去掉版本号 `vN`
- 多个 `<link>` 节点：`rel="alternate"` 为主页，`type="application/pdf"` 为 PDF
- 作者可能超过 20 人，API 会截断，主页显示完整列表

### 作者搜索语法

- 姓在前，名首字母：`au:LeCun_Y`
- 仅姓：`au:Hinton`（可能匹配多人）
- 精确全名：`au:"Yann LeCun"`（加引号）

## 已知陷阱

- `max_results` 超过 2000 时，API 返回 400 错误，需分批请求（发现于 2026-04-01）
- 论文可能有多个版本（v1、v2...），`<id>` 中不带版本号时默认最新版，需保留最新版 PDF 链接
- `<arxiv:doi>` 字段仅在论文已正式发表时存在，预印本无 DOI
- 批量抓取时，连续请求间隔 < 3s 可能触发临时限速（HTTP 429）
- 搜索结果按相关度排序时，`sortBy=relevance` 效果不稳定，`submittedDate` 更可预期
