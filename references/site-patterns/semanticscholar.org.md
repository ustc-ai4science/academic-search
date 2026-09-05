---
domain: semanticscholar.org
aliases: [Semantic Scholar, S2, api.semanticscholar.org]
operations: [search, metadata, citations, author, full_text]
status: unverified
environment: official-api
updated: 2026-09-05
last_verified: null
---

# Semantic Scholar

本文件整理历史 API 经验，未进行本次线上调用。当前参数、鉴权与额度以 [API cookbook](../api-cookbook.md) 指向的官方文档为准；`updated` 不是验证日期。正常结构化查询优先 API，无需浏览器环境。

## 精确查找与字段

```yaml
id: s2-paper-fields
operations: [search, metadata, citations, full_text]
status: unverified
environment: official-api
preconditions: [使用当前支持的 paper identifier 与 fields 参数]
recorded: 2026-04-01
last_verified: null
evidence: historical-api-notes
failure_signals: [未知字段错误, 非成功 HTTP 状态, ID 不匹配, 字段缺失]
fallback: 查官方参数说明；按 DOI/arXiv ID 转原始来源补齐
supersedes: null
```

历史 API 根为 `https://api.semanticscholar.org/graph/v1/`，常用精确标识为 `DOI:{doi}`、`ARXIV:{id}`、S2 paperId。按目标显式请求字段；完整元数据任务继续补摘要、作者、标识、venue 等已要求字段，不因默认轻量策略提前结束。

- `externalIds.ArXiv` 大小写敏感；仅有 ID 时构造的是候选 URL。
- `openAccessPdf.url` 可作为来源报告的开放 PDF 入口，记录来源与时间；实际字节和论文身份依 [全文工作流](../full-text-workflow.md) 单独核验。
- `openAccessPdf=null` 不代表没有 PDF；`abstract=null` 不代表原论文没有摘要；`citationCount` 缺失不等于 0。
- 引用数与关系边保留 S2 来源，不能用 Scholar 的数值覆盖后丢掉原计数。
- 多个已知 ID 的详情请求可用官方 batch 接口；关键词搜索仍需 search，不能用 batch 代替发现未知论文。批量大小按当前官方限制分段，不将历史 500 条当永久保证。

## 限流与故障

```yaml
id: s2-bounded-rate-limit-recovery
operations: [search, metadata, citations, author]
status: unverified
environment: official-api
preconditions: [已保留 HTTP 状态及可用响应头, 多执行者协调平台预算]
last_verified: null
evidence: workflow-policy-not-live-verified
failure_signals: [HTTP 429, 重试预算耗尽, 非法或过长的 Retry-After]
fallback: 停止该来源并记录限制；用原始论文来源、Crossref 或 OpenAlex 补全可得字段
supersedes: null
```

429 仅表明本次请求受限，不能凭状态码推断永久配额耗尽或一定是短暂波动。解析有效 `Retry-After`（秒数或 HTTP 日期）；没有可用提示时使用带抖动的指数退避。同一请求默认最多 2 次重试、总等待预算 30 秒，这是本 Skill 的操作预算，不是平台承诺。要求等待超过剩余预算时停止，不缩短后提前重试。

并行执行者共享平台限流预算，不能各自重试放大流量。先处理错误响应，再读取 `data`：429、401、403、5xx 或异常 JSON 不得当作空结果。只有合法成功响应中的零结果才表示该次查询未命中；必要时改写查询或换来源，记录覆盖范围。鉴权额度遵从官方规定，不假定申请 Key 一定解决所有限流。

## 作者消歧与分页

```yaml
id: s2-author-records
operations: [author]
status: unverified
environment: official-api
preconditions: [作者身份已通过机构或论文记录交叉确认]
recorded: 2026-04-01
last_verified: null
evidence: historical-api-notes
failure_signals: [同名作者, 分页重复, 返回数量与覆盖声明不符]
fallback: 核对作者主页及论文原始记录，保留未完成的分页范围
supersedes: null
```

搜索作者后先消歧，再按当前接口的分页信号获取论文。姓名相同不能自动视为同一作者；论文接口中的 authors 可能不含完整机构信息，按任务需要查作者详情。分页累计唯一标识并记录中断点；未取完时不写“全部论文”。

修改以上经验需要 Skill 维护授权。只改文档或未执行验证时，保持 `status: unverified`、`last_verified: null`；普通检索不自动写全局个人记忆。
