---
domain: cnki.net
aliases: [中国知网, CNKI, kns.cnki.net]
updated: 2026-04-05
---

## 平台特征

- 国内最大学术文献数据库，覆盖中文期刊、硕博学位论文、会议论文、报纸、年鉴等
- **无公开 API**，页面完全由 JavaScript 动态渲染，curl 直接抓取只能拿到空壳 HTML
- 必须使用 CDP 直连用户 Chrome；如需全文（CAJ/PDF），还需用户已在 Chrome 完成机构认证
- 搜索结果含被引数、下载数，是国内文献引用统计的权威来源
- **检索界面版本**：目前主力为 KNS8（`kns.cnki.net/kns8/`），旧版 KNS5 已退役

## 访问层级

| 层级 | 获取内容 | 前提 |
|------|---------|------|
| 公开访客 | 标题、作者、来源期刊、年份、摘要（可能截断）、被引/下载数 | 无需登录 |
| 机构认证用户 | 全文 CAJ 和 PDF 下载链接 | Chrome 内已通过机构 IP 或 CARSI/高校单点登录 |
| 个人账号 | 收藏、导出、自定义阅读记录 | Chrome 内已登录个人账号 |

> 日常学术检索（摘要+元数据）无需登录即可完成。

## 有效模式

### 入口 URL 选择

```
# 新版 KNS8 检索首页（推荐）
https://kns.cnki.net/kns8/defaultresult/index

# 带预设关键词直接跳转（URL 编码查询词）
https://kns.cnki.net/kns8/defaultresult/index?crossids=YSTT4HG0%2CLSTPFHG2%2CIPFD9Y60&korder=SU&kw={URL编码后的关键词}

# 旧版入口（仍可用，会跳转）
https://www.cnki.net
```

### 搜索流程（GUI 方式最稳定）

```bash
# 1. 打开 KNS8 检索页
TARGET=$(curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/new?url=https://kns.cnki.net/kns8/defaultresult/index" \
  | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).targetId")

# 2. 等待 JS 渲染（知网首次加载较慢）
sleep 3

# 3. 确认页面已加载（检查搜索框是否存在）
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=$TARGET" \
  -d 'document.querySelector("#txt_SearchText") !== null'

# 4. 填入关键词（支持中英文混合）
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=$TARGET" \
  -d 'document.querySelector("#txt_SearchText").value = "时间序列预测 Transformer"'

# 5. 点击检索
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/click?target=$TARGET" \
  -d '#btnSearch'

# 6. 等待结果渲染
sleep 3

# 7. 提取结果列表
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=$TARGET" -d '
JSON.stringify(
  Array.from(document.querySelectorAll(".result-table-list tbody tr")).slice(0, 20).map(tr => ({
    title:    tr.querySelector("td.name a")?.textContent?.trim(),
    url:      tr.querySelector("td.name a")?.href,
    authors:  tr.querySelector("td.author")?.textContent?.trim(),
    source:   tr.querySelector("td.source a")?.textContent?.trim(),
    date:     tr.querySelector("td.date")?.textContent?.trim(),
    database: tr.querySelector("td.db")?.textContent?.trim(),
    cite:     tr.querySelector("td.quote a")?.textContent?.trim(),
    download: tr.querySelector("td.download a")?.textContent?.trim()
  }))
)
'

# 8. 完成后关闭 tab
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/close?target=$TARGET"
```

### 结果列表 DOM 选择器（KNS8，截至 2026-04-05）

| 元素 | CSS 选择器 |
|------|-----------|
| 结果行容器 | `.result-table-list tbody tr` |
| 标题链接 | `td.name a` |
| 作者 | `td.author` |
| 来源期刊/会议 | `td.source a` |
| 发表日期 | `td.date` |
| 数据库类型 | `td.db` |
| 被引次数 | `td.quote a` |
| 下载次数 | `td.download a` |
| 总结果数 | `#countPageDiv .countText` |
| 下一页 | `.page-next` 或 `.icon-next` |

### 单篇详情页（点进论文后提取摘要等）

```bash
# 导航到详情页
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=$TARGET" \
  -d 'location.href = "【从列表提取的 url】"'
sleep 2

# 提取完整元数据
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=$TARGET" -d '
(() => {
  const get  = sel => document.querySelector(sel)?.textContent?.trim() ?? null;
  const getAll = sel => Array.from(document.querySelectorAll(sel)).map(el => el.textContent.trim());
  const getHref = sel => document.querySelector(sel)?.href ?? null;
  return JSON.stringify({
    title:    get("h1.title") ?? get(".doc-top h1"),
    authors:  getAll(".author a"),
    source:   get(".source a"),
    date:     get(".date"),
    abstract: get("#ChDivSummary") ?? get(".abstract-text"),
    keywords: getAll(".keyword a"),
    fund:     get(".fund a"),
    doi:      get(".doi a"),
    cnki_url: location.href,
    pdf_link: getHref(".btn-pdfdown") ?? getHref(".btn-dlcaj")
  });
})()
'
```

### 详情页 DOM 选择器（KNS8，截至 2026-04-05）

| 元素 | CSS 选择器 | 备注 |
|------|-----------|------|
| 标题 | `h1.title` 或 `.doc-top h1` | |
| 作者链接 | `.author a` | 多个作者各为一个 `<a>` |
| 期刊/来源 | `.source a` | |
| 发表日期 | `.date` | |
| 中文摘要 | `#ChDivSummary` | |
| 英文摘要 | `#EnDivSummary` | 部分论文有 |
| 关键词 | `.keyword a` | |
| 基金项目 | `.fund a` | |
| DOI | `.doi a` | 并非所有论文都有 |
| PDF 下载 | `.btn-pdfdown` | 需机构认证 |
| CAJ 下载 | `.btn-dlcaj` | 需机构认证 |
| 被引次数（详情页） | `.cited-count` 或 `.cite-count span` | |

### 高级检索（精确字段搜索）

知网高级检索支持按标题、作者、关键词、摘要、基金分别检索：

```
高级检索入口：https://kns.cnki.net/kns8/AdvSearch
```

字段代码（用于构造高级查询 URL 的 `kw` 参数）：

| 字段 | 代码 |
|------|------|
| 主题（推荐） | `SU` |
| 标题 | `TI` |
| 关键词 | `KY` |
| 摘要 | `AB` |
| 作者 | `AU` |
| 机构 | `AF` |
| 期刊名称 | `JN` |
| 基金 | `FU` |

### 排序方式

知网结果列表支持排序，URL 中通过 `korder` 参数控制：

| 参数值 | 含义 |
|--------|------|
| `SU` | 相关度（默认） |
| `PY` | 发表时间降序 |
| `DC` | 被引次数降序 |
| `FT` | 下载次数降序 |

## 已知陷阱

- **JS 渲染延迟**：知网结果列表为异步渲染，`sleep 3` 后再提取；首次打开建议 `sleep 4-5`（发现于 2026-04-05）
- **DOM 选择器可能因版本更新失效**：知网前端改版频繁，操作失败时先用 `document.body.innerText.slice(0, 500)` 确认页面状态，再重新定位选择器
- **直接构造 URL 不如 GUI 触发稳定**：`/new?url=xxx&kw=xxx` 方式偶尔会绕过登录态，导致结果不完整；遇到问题改为先打开首页再 GUI 填词
- **摘要截断**：未登录时 `#ChDivSummary` 可能只显示前 200 字，登录后完整显示
- **PDF 链接动态生成**：`.btn-pdfdown` 的 `href` 是 JS 动态写入的，需等页面完全加载后再读取；若为空，尝试点击按钮后再提取
- **CAJ vs PDF**：默认提供 CAJ 格式（知网专有），PDF 需额外权限；建议优先尝试 `.btn-pdfdown`，无效则告知用户 CAJ 需要 CAJViewer
- **反爬机制**：单个 session 频繁翻页（>20 次）可能触发人机验证，遇到 CAPTCHA 立即暂停，等用户手动处理
- **搜索框 ID 变化**：旧版 `#txt_SearchText`，部分页面为 `.search-input input`；找不到时用 `document.querySelector('input[type=text]')` 兜底
- **`td.quote` 为空**：部分新发表论文被引数为 0 或未统计，`td.quote a` 可能不存在，应做空值保护

## 操作节奏建议

- 相邻两次搜索/翻页间隔 3-5 秒
- 单次 session 翻页不超过 10 页
- 遇到 CAPTCHA 或重定向到登录页，立即停止并告知用户

## CNKI 与国际平台联合检索建议

| 场景 | 推荐策略 |
|------|---------|
| 中文文献为主 | CNKI 主搜，Semantic Scholar 补充英文引用数 |
| 中英文综述 | CNKI + arXiv/S2 并行，按语言分组输出 |
| 中文作者的国际发表 | Semantic Scholar（`/author/search?query=`）更可靠 |
| 学位论文 | 仅 CNKI 有完整收录（国内），ProQuest 覆盖国外 |
