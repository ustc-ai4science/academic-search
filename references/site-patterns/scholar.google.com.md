---
domain: scholar.google.com
aliases: [Google Scholar, GS]
operations: [search, citations, author, full_text]
status: unverified
environment: browser-dom
updated: 2026-09-05
last_verified: null
---

# Google Scholar

以下选择器来自历史经验，本次仅整理文档，未做线上复验。`updated` 是编辑日期，不是成功访问日期。按 [浏览器工作流](../browser-workflow.md) 操作；协议见 [CDP API](../cdp-api.md)。用户指定 Scholar 时使用当前环境可用的浏览器；无需为其他 API 平台启动 Scholar。

## 检索与引用

```yaml
id: scholar-search-dom
operations: [search, citations]
status: unverified
environment: browser-dom
preconditions: [当前页面为 Scholar 检索界面, 已核对控件唯一性]
recorded: 2026-04-01
last_verified: null
evidence: historical-selectors-only
failure_signals: [结果区域未出现, 查询词不一致, 挑战页, 选择器多匹配]
fallback: 重新观察当前 DOM 并定位一次；仍受阻则记录来源限制
supersedes: null
```

从当前入口或已观察的查询链接进入，先检查搜索词与页面类型；不能断言“搜索框比 URL 一定更稳定”。提交后等待 `results_ready`、明确 `empty`、`blocked`、`login_required` 或 `rate_limited`，而不是固定 sleep 后直接提取。挑战条件先于可能残留的旧列表条件。

| 历史候选控件 | 选择器 / 线索 |
|---|---|
| 搜索框 | `input[name=q]` |
| 结果区域 | `.gs_ri` |
| 标题链接 | `.gs_rt a` |
| 作者 / 来源 / 年份原始行 | `.gs_a` |
| 搜索片段 | `.gs_rs` |
| 被引链接 | `.gs_fl a[href*=cites]` |
| 全文候选链接 | `.gs_or_ggsm a` |
| 下一页 | `#gs_n td:last-child a` |

先检查这些结构仍匹配当前页面，再在各论文行内提取字段。`.gs_a` 是混合文本，不用简单按连字符拆分推断完整作者和 venue；详情或官方元数据可补齐。`.gs_rs` 是搜索片段，不能作为完整摘要。引用数显示缺失或无法解析时保留原始文本与空值，不填 0。

提取前核对查询词、年份筛选和当前排序。翻页前保存当前页码与首条论文链接，翻页后等到记录变化；重复页面不计入新增论文。所有“引用 / PDF”动作都限定到已确认的论文行，遇多匹配先收窄选择器。

Scholar 引用数按平台与检查时间记录；与 S2、CNKI 计数不同不意味着某个来源错误，不宣称任一平台的值天然是唯一真值。重定向链接只在确认目标参数后解析，保存实际来源和目标 URL。

## 作者页

```yaml
id: scholar-author-pagination
operations: [author]
status: unverified
environment: browser-dom
preconditions: [已通过姓名之外的信息确认作者身份]
recorded: 2026-04-01
last_verified: null
evidence: historical-selectors-only
failure_signals: [同名作者, 列表未变化, 加载更多受阻]
fallback: 保留已取记录及覆盖范围，换作者官方主页或其他来源核对
supersedes: null
```

历史入口为 `https://scholar.google.com/citations?user={user_id}`；先比对机构、领域、主页链接等身份信息。历史列表行为 `.gsc_a_tr`，标题 `.gsc_a_at`、年份 `.gsc_a_y span`、被引 `.gsc_a_c a`。每次加载更多都核对累计唯一论文数和控件状态；到达限制时报告“已获取 N 条”，不能声称作者全部论文已获取。

## 全文与访问限制

PDF 标记、链接文本或 arXiv ID 只是发现线索；依 [全文工作流](../full-text-workflow.md) 核对 OA 来源和文件。遇 CAPTCHA/挑战停止该路径，不尝试用真实鼠标点击绕过；继续其他合法来源，只有指定来源确实不可替代且需要用户操作时报告阻塞。

未在线校准任何固定“安全搜索次数”或请求间隔，不把历史 20 次/session 等数字当平台保证。平台明示限流时遵守等待信息和任务预算。只关闭本任务创建的 target；经验的 verified 状态需实际复验，不自动写回全局记忆。
