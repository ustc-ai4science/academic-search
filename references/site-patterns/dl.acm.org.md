---
domain: dl.acm.org
aliases: [ACM DL, ACM Digital Library, ACM]
updated: 2026-04-01
---

## 平台特征

- ACM 官方数字图书馆，收录计算机科学领域顶级会议和期刊
- 无公开免费 API
- 摘要、元数据、BibTeX 均可公开访问；全文 PDF 通常需要机构订阅
- 页面内嵌 JSON-LD 结构化数据，可直接提取元数据，无需 CDP
- DOI 前缀统一为 `10.1145/`
- BibTeX 有专用导出端点，无需登录

## 有效模式

### 通过 DOI 访问论文页

```
https://dl.acm.org/doi/{doi}
示例：https://dl.acm.org/doi/10.1145/3292500.3330701
```

### Jina 提取摘要（推荐）

```bash
curl -s "https://r.jina.ai/dl.acm.org/doi/10.1145/3292500.3330701"
```

返回 Markdown，含标题、作者、摘要正文，节省 token。

### BibTeX 直接下载

```bash
# DOI 中 "/" 编码为 "%2F"
curl -s "https://dl.acm.org/action/exportCitation?doi=10.1145%2F3292500.3330701&format=bibtex&downloadName=citation"
```

URL 构造规则：
```
https://dl.acm.org/action/exportCitation?doi={DOI with / encoded as %2F}&format=bibtex
```

### JSON-LD 提取（无需 CDP）

ACM 页面 `<script type="application/ld+json">` 中含完整元数据：

```bash
curl -s "https://dl.acm.org/doi/10.1145/3292500.3330701" | \
  perl -0ne 'if (/<script type="application\/ld\+json">\s*(.*?)\s*<\/script>/s) { print "$1\n" }'
```

不要用 `grep -P`：macOS 自带 BSD `grep` 不支持该选项。

JSON-LD 字段映射：

| JSON-LD 字段 | 标准字段 |
|-------------|---------|
| `name` | title |
| `author[].name` | authors[] |
| `datePublished` | year |
| `@id`（如包含 DOI） | doi |
| `description` | abstract |

`publisher.name` 是出版方（通常为 ACM），不要当作 `venue`。`venue` 通常需要从页面标题块、引用信息或其他页面元数据补充。

### DOI 搜索（通过 ACM 搜索页）

```
https://dl.acm.org/action/doSearch?query={关键词}&startPage=0&pageSize=20
```

搜索结果页含 JSON 数据，但反爬较强，Jina 或 CDP 更可靠。

## 已知陷阱

- BibTeX 导出端点的 DOI 参数中 `/` 必须编码为 `%2F`，否则返回 404（发现于 2026-04-01）
- 全文 PDF 链接（`.btn-dl-pdf`）点击后可能跳转到登录页，不要依赖此链接
- 搜索结果页（`/search`）使用 JavaScript 动态加载，WebFetch 获取内容不完整，需 Jina 或 CDP
- 部分老论文（2000 年前）的 DOI 可能格式不标准
- `exportCitation` 端点有时返回 Cloudflare challenge 或 HTML 错误页而非 BibTeX，此时改用 CDP 点击页面上的 "Export Citation" 按钮
