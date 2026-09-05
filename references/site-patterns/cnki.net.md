---
domain: cnki.net
aliases: [中国知网, CNKI, kns.cnki.net]
operations: [search, metadata, citations, full_text]
status: unverified
environment: browser-dom
updated: 2026-09-05
last_verified: null
---

# CNKI（知网）

本文件保留 KNS8 历史入口和选择器线索，本次未在线验证，不宣称其仍是当前主版本。访问范围与机构权限以当前页面为准。先读 [浏览器工作流](../browser-workflow.md)，协议见 [CDP API](../cdp-api.md)。

## 搜索、筛选和翻页

```yaml
id: cnki-kns8-search
operations: [search, citations]
status: unverified
environment: browser-dom-kns8-historical
preconditions: [当前页面结构与候选选择器相符, 已核对搜索控件唯一性]
recorded: 2026-04-05
last_verified: null
evidence: historical-selectors-only
failure_signals: [列表未出现, 查询条件未生效, 登录或挑战页, 翻页记录重复]
fallback: 从当前首页入口重新观察 DOM；仍不可用则报告该来源受阻
supersedes: null
```

历史检索入口为 `https://kns.cnki.net/kns8/defaultresult/index`，首页为 `https://www.cnki.net`。先确认实际落地 URL、页面类型与搜索框，不假定历史参数仍有效。不要将找不到指定输入框时的兜底写成“使用第一个文本框”。

| 历史候选元素 | 选择器 |
|---|---|
| 搜索框 | `#txt_SearchText` 或 `.search-input input`，须核对唯一目标 |
| 检索按钮 | `#btnSearch` |
| 结果行 | `.result-table-list tbody tr` |
| 标题链接 / 作者 | `td.name a` / `td.author` |
| 来源 / 日期 / 数据库 | `td.source a` / `td.date` / `td.db` |
| 被引 / 下载数 | `td.quote a` / `td.download a` |
| 总数提示 | `#countPageDiv .countText` |
| 下一页 | `.page-next` 或 `.icon-next`，须核对当前控件 |

填词或更改筛选后核对控件显示和提交的查询；使用有界条件等待，区分 `results_ready`、明确 `empty`、`blocked`、`login_required`、`rate_limited` 及 `WAIT_TIMEOUT`。不再用固定 sleep 秒数作为结果可提取的保证。

结果区域存在后核对查询词、年份、数据库范围和排序。翻页前记录页码和首条论文链接，翻页后检查标识变化；页数和累计唯一记录数可核对时应一致。被引/下载数为空时保留空值，不直接解释成 0。被引数保留 CNKI 来源和日期，与国际平台计数分别保存。

高级检索历史字段代码包括主题 SU、标题 TI、关键词 KY、作者 AU 等；具体控件、字段和排序选项以当前界面为准。不要依靠未经复验的 URL 参数假定过滤已经生效。

## 详情、摘要和全文

```yaml
id: cnki-detail-and-files
operations: [metadata, full_text]
status: unverified
environment: browser-dom-kns8-historical
preconditions: [详情页与目标论文身份一致]
recorded: 2026-04-05
last_verified: null
evidence: historical-selectors-only
failure_signals: [摘要截断, 动态链接为空, 权限提示, 非 PDF 文件]
fallback: 保留元数据与访问状态，按全文工作流尝试其他合法开放来源
supersedes: null
```

| 历史候选字段 | 选择器 / 核对要求 |
|---|---|
| 标题 | `h1.title` 或 `.doc-top h1` |
| 作者 / 来源 | `.author a` / `.source a` |
| 中文摘要 | `#ChDivSummary` 或 `.abstract-text`，确认是否截断 |
| 英文摘要 | `#EnDivSummary`，缺失不推断不存在 |
| 关键词 / 基金 / DOI | `.keyword a` / `.fund a` / `.doi a` |
| PDF 候选 | `.btn-pdfdown` |
| CAJ 候选 | `.btn-dlcaj`，不能写入 PDF 字段充当替代 |

先确认详情页标题、作者与标识，再提取完整元数据。需要完整摘要时核对展开状态和截断提示；不能把片段当全文摘要交付。PDF 按钮或动态 href 的出现不证明开放获取；即使当前浏览器有机构登录态，也不能把机构可下载资源标记成 OA。

按 [全文工作流](../full-text-workflow.md) 分别记录候选 URL、开放获取依据、响应验证和论文身份。遇机构权限提示记录 `needs_institution`；本 Skill 的 OA 下载器不自动获取受机构权限保护的文件。CAJ 保留实际格式，不改后缀或归类为 PDF。HTML 响应可能是落地页、登录或挑战，不能证明无 PDF。

## 访问限制与经验维护

遇挑战停止该路径并记录证据，继续已授权的其他合法来源；不要宣称固定搜索间隔或“每 session 10/20 页”能保证免限流。DOM 变化时按当前观察修正一次；仍失败则交付已取部分及限制，不报告“没有相关中文论文”。

只关闭本任务创建的 target。历史规则的复验需实际观察后置结果才可标 `verified` 并填写日期；仅编辑文档保持 `unverified`。写回内置经验需已有维护授权，不因日常检索自动更新全局个人记忆。
