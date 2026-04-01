---
domain: paperswithcode.com
aliases: [Papers with Code, PwC]
updated: 2026-04-01
---

## 平台特征

- 专注于 ML/CV/NLP/AI 领域，建立论文 ↔ 代码仓库 ↔ benchmark 结果的关联
- 完全公开的 REST API，无需鉴权
- 论文收录不全（主要覆盖有代码实现的 ML 论文）
- 引用数不完整（依赖 Semantic Scholar 数据）
- 独特价值：获取论文官方/非官方代码实现、benchmark 排行榜

## 有效模式

### API 根 URL

```
https://paperswithcode.com/api/v1/
```

### 搜索论文

```bash
curl -s "https://paperswithcode.com/api/v1/papers/?q=object+detection&items_per_page=10&page=1"
```

分页参数：`page`（1-based），`items_per_page`（默认 10，最大 50）

### 获取论文详情

```bash
curl -s "https://paperswithcode.com/api/v1/papers/{paper_id}/"
```

`paper_id` 从搜索结果的 `id` 字段获取（字符串，如 `"attention-is-all-you-need"`）。

### 获取代码仓库

```bash
curl -s "https://paperswithcode.com/api/v1/papers/{paper_id}/repositories/"
```

返回字段：`url`（GitHub/GitLab URL）、`stars`、`framework`（PyTorch/TensorFlow/JAX 等）、`is_official`（是否官方实现）

### 获取 Benchmark 结果

```bash
# 获取论文在各 benchmark 上的结果
curl -s "https://paperswithcode.com/api/v1/papers/{paper_id}/results/"

# 获取特定 task 的 SOTA 排行榜
curl -s "https://paperswithcode.com/api/v1/sota/?task={task_id}"
```

### 按 arXiv ID 查询

```bash
curl -s "https://paperswithcode.com/api/v1/papers/?arxiv_id=1706.03762"
```

### 响应字段映射

| JSON 字段 | 标准字段 |
|-----------|---------|
| `title` | title |
| `authors` | authors[]（字符串数组） |
| `published` | year（格式 `YYYY-MM-DD`，取前 4 位） |
| `abstract` | abstract |
| `arxiv_id` | arxiv_id |
| `url_pdf` | pdf_url |
| `id` | pwc_id（内部标识） |

## 已知陷阱

- 论文 ID（`id` 字段）是可读字符串（如 `"bert-pre-training-of-deep-bidirectional"`），不是数字（发现于 2026-04-01）
- `authors` 字段是字符串数组，但有时包含机构名而非个人姓名，需过滤
- 仅收录有代码实现的论文，理论性或非 ML 方向论文大量缺失
- `url_pdf` 有时指向 arXiv，有时指向其他来源，少数情况下为 null
- benchmark 相关接口（`/sota/`）返回数据量大，建议只在明确需要排行榜时调用
