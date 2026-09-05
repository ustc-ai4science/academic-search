---
name: academic-search
description: Use when the user asks to search or review academic papers, retrieve scholarly metadata or citation counts, validate or deduplicate scholarly records, find an author's publications, export BibTeX, or discover and download open-access full text. 适用于搜论文、文献综述、系统综述、引用分析、学术记录校验去重、DOI/arXiv 精确查找与开放 PDF 获取。
metadata:
  version: "1.4.0"
---

# Academic Search

按用户要求检索、筛选并交付可追溯的学术资料。优先官方 API 和论文来源；浏览器用于动态页面、交互或当前 API 无法满足的字段。

## 任务范围与完成标准

从请求确定学科、论文范围、年份、数量和所需字段；只有影响结果且无法合理推断的缺项才询问。开放式选题可先轻量检索、筛选，再补充核心论文；用户已经要求完整元数据、摘要、BibTeX 或下载时，直接完成相应步骤，不因“两遍策略”再次要求确认。

完成标准是所需记录、字段和文件均已交付，或逐项说明未完成部分的证据与原因。工具返回成功、页面加载完成、URL 看起来像 PDF 都不能单独证明任务完成。

## 学科路由与来源

读取与任务对应的学科 profile，跨学科任务以核心学科为主，并用 OpenAlex / Crossref 等补充。

| 学科 / 任务 | 优先来源 | 按需参考 |
|---|---|---|
| 计算机 / AI | arXiv、Semantic Scholar、ACM DL、IEEE、DBLP | [computer-science](references/disciplines/computer-science.md) |
| 医学 / 生命科学 | PubMed、PMC、Europe PMC、临床试验库 | [biomedicine](references/disciplines/biomedicine.md) |
| 物理 / 数学 | arXiv、NASA ADS、INSPIRE HEP | [physics-math](references/disciplines/physics-math.md) |
| 化学 / 材料 | Crossref、OpenAlex、ChemRxiv、出版商 | [chemistry-materials](references/disciplines/chemistry-materials.md) |
| 经济 / 社科 | RePEc、NBER、SSRN、OSF | [economics-social-science](references/disciplines/economics-social-science.md) |
| 人文 / 法律 | 学术搜索、图书馆目录、领域数据库 | [humanities-law](references/disciplines/humanities-law.md) |
| 精确论文 / 元数据 | DOI → Crossref / 出版商；arXiv ID → arXiv；S2 / OpenAlex 补全 | [API cookbook](references/api-cookbook.md) |
| 引用 / 作者论文 | S2 API；用户指定 Scholar 时使用浏览器 | [S2](references/site-patterns/semanticscholar.org.md)、[Scholar](references/site-patterns/scholar.google.com.md) |
| 中文文献 | CNKI 等中文数据库，按当前访问条件检索 | [CNKI](references/site-patterns/cnki.net.md) |
| OA PDF / 全文 | 论文来源、开放仓储、OpenAlex、Unpaywall、PMC | [全文工作流](references/full-text-workflow.md) |

只使用 API 时不启动浏览器或执行 CDP 环境检查。调用参数、鉴权与分页见 [API cookbook](references/api-cookbook.md)。代码链接优先核对论文或作者给出的仓库；第三方索引作为发现线索。

## 检索与核验

1. 根据研究问题选择互补查询词、受控词表与文献类型。记录实际查询、筛选条件和检索时间；按相关性及用户目标排序。CCF 只用于适用的 CS 任务，其他学科遵循 profile；分级需注明来源和版本。
2. 轻量筛选可暂不拉完整摘要；完整元数据任务应继续补齐已要求的字段。论文表明确区分搜索片段、摘要与全文证据。
3. 按 [metadata-schema](references/metadata-schema.md) 输出。需要交付或复用 JSON 记录时，按 [academic-records](references/academic-records.md) 运行可执行校验与保守去重：DOI/arXiv/PMID 等精确标识可归组，规范化后标题完全相同只产生待核对候选。预印本与正式版本保留对应关系，勿静默合并不同研究。
4. 引用数保留平台、数值、检索时间和来源；不同平台的计数分别保存，不求和、不把较大值当唯一真值。缺失字段用空值及原因，不补造。
5. API 429 只说明当前请求被限流，不能确定会话配额永久耗尽。遵守有效的 `Retry-After`，无提示时有界退避；同一请求默认最多 2 次重试、总等待预算 30 秒，预算不足则停止该来源并记录限制。并行任务共享平台请求预算；参数详见 [API cookbook](references/api-cookbook.md) 与 [S2 经验](references/site-patterns/semanticscholar.org.md)。

多篇独立论文或不同来源可并行，依赖查询结果的详情获取顺序执行；各执行者返回结构化结果及来源，不共享同一页面的操作控制。

## 浏览器、全文与导出

- 需要动态页面时，先读 [browser-workflow](references/browser-workflow.md) 及对应域名经验。正文型页面优先调用 `/readPage` 获取带来源、提取方式和截断标记的结构化观察；交互前检查唯一目标、可见性、禁用状态与遮挡。动作返回的 `status:"dispatched"` 只表示已派发，`outcome_verified:false` 表示仍须等待并核验查询、筛选、保存或提交结果。空结果、挑战页、登录要求和超时分别处理。
- 获取全文或开放 PDF 下载与 manifest 导出时，读 [full-text-workflow](references/full-text-workflow.md)。候选 URL、开放获取声明、实际文件验证、论文身份是不同证据；有 arXiv ID 不等于 PDF 已验证。HTML 响应不能证明没有 PDF，未找到 OA 匹配只能报告本次所查来源未发现。
- 已获授权的开放 PDF 下载直接执行；未要求下载时交付元数据或清单即可。不得调用 Sci-Hub、LibGen 或绕过付费墙、验证码和机构访问限制；遇到限制记录原因并继续其他合法来源。
- BibTeX 优先使用出版平台或 arXiv 导出，缺失时按 [metadata-schema](references/metadata-schema.md) 从已核对字段生成，保留缺失项。
- 系统综述与证据图谱读取 [systematic-review](references/workflows/systematic-review.md)，记录检索、去重、筛选与全文限制，按实际覆盖报告完成程度。

## 运行路径与站点经验

本文及 references 中的脚本路径均相对本 `SKILL.md` 所在目录。先将其绝对路径保存为 `ACADEMIC_SEARCH_ROOT`，再运行 `bash "$ACADEMIC_SEARCH_ROOT/scripts/check-deps.sh"`、`node "$ACADEMIC_SEARCH_ROOT/scripts/academic-records.mjs"` 或 `node "$ACADEMIC_SEARCH_ROOT/scripts/oa-pdf-download.mjs"`；不要假定安装在某个宿主的固定目录。仅在使用 bundled CDP 运行时时执行第一条命令。默认自动启动本机 Chrome，使用独立持久 profile（`~/.local/share/academic-search/chrome-profile`），不发现或连接日常 Chrome；首次网站登录需在专用 profile 中完成，日常登录态不会复制。显式设置 `ACADEMIC_CHROME_ENDPOINT` 时只连接该已运行端点，失败不自动启动或回退；`CDP_PROXY_PORT` 仅指定代理端口，v1.4.0 默认仍为 3457（v1.3.1 从 3456 迁移）；调用前核对新版代理身份，不接管旧端口服务。配置与协议见 [cdp-api](references/cdp-api.md)。

经验按“域名 → 操作 → 症状”按需读取。条目使用 `unverified` / `verified` / `deprecated` 状态，记录适用环境、前提、失败信号、回退和 `last_verified`。历史未复验条目保持 `last_verified: null`；只有实际观察到预期结果才能升级为 verified。选择器失效时以当前观察修正本次操作。仅在用户授权维护本 Skill 时更新内置经验；普通检索不自动改写 Skill 或全局个人记忆。
