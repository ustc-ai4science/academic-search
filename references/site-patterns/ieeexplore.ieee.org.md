---
domain: ieeexplore.ieee.org
aliases: [IEEE Xplore, IEEE]
updated: 2026-04-01
---

## 平台特征

- IEEE 官方数字图书馆，收录 IEEE 旗下期刊、会议、标准
- 有官方 REST API，但需要机构订阅 Key（`https://developer.ieee.org`）
- 无机构 Key 时：摘要和元数据可公开访问，可用 Jina 或 WebFetch
- 全文 PDF 需机构订阅（部分 Open Access 论文例外）
- 文章 ID（arnumber）是数字，格式稳定

## 有效模式

### 文章页 URL 格式

```
https://ieeexplore.ieee.org/document/{arnumber}/
示例：https://ieeexplore.ieee.org/document/9607200/
```

### 无 Key 时：Jina 提取

```bash
curl -s "https://r.jina.ai/ieeexplore.ieee.org/document/9607200/"
```

可提取标题、作者、摘要、DOI、发表信息。

### 无 Key 时：WebFetch 直接访问

```bash
curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://ieeexplore.ieee.org/document/9607200/"
```

页面内嵌 `xplGlobal.document.metadata` JavaScript 对象，含完整元数据：

```javascript
// 在 CDP eval 中提取
JSON.stringify(xplGlobal.document.metadata)
```

### 有机构 Key 时：搜索 API

```bash
curl -s "https://ieeexploreapi.ieee.org/api/v1/search/articles?querytext=deep+reinforcement+learning&max_records=10&apikey=YOUR_KEY"

# 按 DOI 精确查询
curl -s "https://ieeexploreapi.ieee.org/api/v1/search/articles?doi=10.1109/TPAMI.2021.3073784&apikey=YOUR_KEY"
```

### BibTeX 导出

无统一端点，页面有 "Cite This" 按钮，CDP 点击后可获取：

```javascript
// 通过 xplGlobal 对象获取引用信息
JSON.stringify({
  title: xplGlobal.document.metadata.title,
  doi: xplGlobal.document.metadata.doi,
  year: xplGlobal.document.metadata.publicationYear,
  authors: xplGlobal.document.metadata.authors?.map(a => a.full_name)
})
```

### arnumber 获取方式

- 从 IEEE 搜索结果页 URL 中提取：`/document/{arnumber}/`
- 从 DOI 中提取：IEEE DOI 格式通常为 `10.1109/{PUBLICATION}.{arnumber}`（不总是，仅作参考）

## 已知陷阱

- `xplGlobal.document.metadata` 对象在页面 JavaScript 中，需 CDP eval 才能读取，WebFetch 获取的静态 HTML 中不包含（发现于 2026-04-01）
- Jina 偶尔无法完整提取 IEEE 页面，此时改用 CDP
- 搜索结果页（`/search/searchresult.jsp`）大量依赖 JavaScript，WebFetch 无效
- Open Access 论文的 PDF 链接在 `xplGlobal.document.metadata.pdfPath`，格式为相对路径，需拼接 `https://ieeexplore.ieee.org`
- 标准文档（Standards）的元数据结构与普通论文不同，`arnumber` 可能不存在
