---
domain: scholar.google.com
aliases: [Google Scholar, GS]
updated: 2026-04-01
---

## 平台特征

- 引用数最全面的学术搜索引擎，覆盖范围广（含灰色文献、技术报告）
- **无官方 API**，严重反爬（reCAPTCHA v3 + IP 封禁）
- 必须使用 CDP 直连用户 Chrome（天然携带登录态，模拟真实用户行为）
- 不要尝试：WebFetch、curl、任何第三方 Scholar API（均不稳定且需付费）
- 主要使用场景：获取引用数、发现其他平台未收录的论文、查看 "Cited by" 关系

## 有效模式

### 搜索流程（GUI 方式最稳定）

```bash
# 从首页搜索框操作，不直接构造 /scholar?q= URL
TARGET=$(curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/new?url=https://scholar.google.com" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).targetId")

# 等待页面加载后输入搜索词
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=$TARGET" \
  -d 'document.querySelector("input[name=q]").value = "transformer attention mechanism"'

# 点击搜索按钮
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/click?target=$TARGET" -d 'button[type=submit]'

# 等待结果（可用 /info 确认 URL 已变更）
sleep 2

# 提取结果（最多 10 条）
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=$TARGET" -d '
JSON.stringify(Array.from(document.querySelectorAll(".gs_ri")).slice(0,10).map(el => ({
  title: el.querySelector(".gs_rt")?.textContent?.replace(/^\[.*?\]\s*/, "").trim(),
  url: el.querySelector(".gs_rt a")?.href,
  meta: el.querySelector(".gs_a")?.textContent?.trim(),
  snippet: el.querySelector(".gs_rs")?.textContent?.trim(),
  cited_by: el.querySelector(".gs_fl a[href*=cites]")?.textContent?.match(/\d+/)?.[0]
})))
'
```

### 结果选择器（截至 2026-04-01）

| 元素 | CSS 选择器 |
|------|-----------|
| 结果容器 | `.gs_ri` |
| 标题链接 | `.gs_rt a` |
| 作者/venue/年份行 | `.gs_a` |
| 摘要片段 | `.gs_rs` |
| "Cited by N" 链接 | `.gs_fl a[href*=cites]` |
| PDF 链接 | `.gs_or_ggsm a, [data-clk-atid]` |
| 下一页 | `#gs_n td:last-child a` |

### 作者主页

```javascript
// 作者主页 URL 格式
"https://scholar.google.com/citations?user={user_id}&sortby=pubdate"

// 论文列表选择器
Array.from(document.querySelectorAll(".gsc_a_tr")).map(tr => ({
  title: tr.querySelector(".gsc_a_at")?.textContent,
  year: tr.querySelector(".gsc_a_y span")?.textContent,
  cited_by: tr.querySelector(".gsc_a_c a")?.textContent
}))
```

### 操作节奏建议

- 相邻两次搜索之间间隔 5-10 秒
- 单次 session 搜索不超过 20 次
- 遇到 CAPTCHA 立即停止，等待用户手动完成验证

## 已知陷阱

- 直接构造 `/scholar?q=xxx` URL 比从首页搜索框触发更容易被识别为爬虫（发现于 2026-04-01）
- 引用数 "Cited by N" 中的 N 与 Semantic Scholar 的数值通常不一致（Scholar 更高，包含更多灰色文献）
- 页面使用 JavaScript 动态渲染，WebFetch 只能获取空页面或重定向到 CAPTCHA
- `.gs_a` 行格式为 "Author1, Author2 - Venue, Year - Publisher"，解析时需按 `-` 分割
- 已登录用户的 Scholar 页面可能出现个性化推荐，影响结果顺序
- 部分链接含 Google 重定向（`/url?q=...`），需提取 `q` 参数值才能获得真实 URL
