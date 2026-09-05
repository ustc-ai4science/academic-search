# Academic-Search 项目介绍

> 基于本仓库 `README.md`、`SKILL.md`、`docs/` 与 `references/` 内容整理。
> 项目地址：https://github.com/ustc-ai4science/academic-search

## 一句话定位

Academic-Search 是一个面向 Claude Code / AI Agent 的学术搜索与论文元数据提取 Skill。它不是通用网页搜索工具，而是把学术检索中的平台选择、查询扩展、结果筛选、元数据规范化、开放全文判断和必要的浏览器自动化沉淀成一套可复用的 Agent 能力。

它解决的核心问题是：让 Agent 不只是“能联网搜索”，而是“懂得如何做学术检索”。

## 它解决什么问题

普通 Web 搜索在学术场景里经常会遇到几个问题：

- 搜索结果混杂普通网页、博客、新闻和论文页面，筛选成本高。
- 查引用数、PDF、BibTeX、代码链接时，需要在多个平台之间手动切换。
- 不同平台字段不统一，结果很难去重、合并和导出。
- Google Scholar、CNKI、ACM DL、IEEE Xplore 等平台访问方式差异大，Agent 容易卡在反爬、登录态或页面结构上。
- 不同学科的评价标准不同，不能只用 CS 顶会或引用数评价所有论文。

Academic-Search 的目标是把这些经验转化为可执行的 Skill 指令和工程辅助脚本，让 Agent 按学术任务的逻辑工作。

## 核心设计

### 1. API 优先，浏览器兜底

项目优先使用稳定的公开 API 获取结构化数据，例如：

- arXiv
- Semantic Scholar
- Crossref
- OpenAlex
- Unpaywall
- PubMed
- Papers with Code

对于需要浏览器的平台，例如 Google Scholar、CNKI，项目默认自动启动本机 Chrome 的专用持久 profile，并在任务自己的 tab 中完成访问。网站首次登录在专用 profile 中完成，不复制日常 Chrome 登录态；也可通过显式端点连接已运行的浏览器。配置见 [CDP API](references/cdp-api.md)。

核心原则是：能用 API 就不打开浏览器；必须浏览器时才使用 CDP。

### 2. 学术任务导向，而不是网页导向

Academic-Search 关心的对象不是网页，而是论文和论文元数据。它默认输出结构化字段，而不是把页面正文简单摘出来。

典型字段包括：

- 标题
- 作者
- 年份
- venue
- DOI
- arXiv ID
- PMID / PMCID
- 引用数
- 摘要
- 开放获取状态
- PDF 链接
- BibTeX
- 代码仓库
- 数据来源平台

这些字段统一到 `references/metadata-schema.md`，便于跨平台去重、合并、导出和后续分析。

### 3. 两遍搜索策略

项目强调“搜索的瓶颈不在搜，而在筛”。

因此默认采用两遍策略：

1. 第一遍：轻量扫描 20-30 条结果，只输出标题、作者、年份、venue、引用数、PDF / 代码状态。
2. 第二遍：用户确认核心论文后，再深拉摘要、BibTeX、PDF、引用关系等完整元数据。

如果用户明确要求“前 N 篇”或“只要摘要表”，Skill 会直接输出第一遍结果，不额外停下确认。

### 4. Query 扩展与多源去重

用户自然语言里的关键词往往不够覆盖整个研究方向。Academic-Search 会按任务自动扩展 2-3 个互补 query，例如：

- 同义词替换
- 子概念拆分
- 缩写与全称并用
- 学科受控词表，如 MeSH、JEL、MSC、ACM CCS

不同 query、不同平台拿到的结果会按 DOI、arXiv ID、PubMed ID 或标题相似度进行合并去重。

### 5. 学科路由

项目从单纯平台矩阵升级为学科化检索策略。不同学科会使用不同的数据源、排序规则和输出字段。

| 学科 | 重点平台与能力 |
| --- | --- |
| CS / AI | arXiv、Semantic Scholar、ACM / IEEE、Papers with Code、CCF / 顶会标注 |
| 医学 / 生命科学 | PubMed、Europe PMC、MeSH、系统综述和 RCT 等证据等级 |
| 物理 / 数学 | arXiv 分类、MSC、NASA ADS / INSPIRE HEP 方向预留 |
| 化学 / 材料 | Crossref、OpenAlex、ChemRxiv、ACS / RSC / Springer / Wiley 访问状态 |
| 社科 / 经济 | JEL、RePEc / NBER / SSRN、方法类型和工作论文状态 |
| 人文 / 法律 | 图书、章节、档案、法律来源，引用数只作为辅助信号 |

这个设计避免把计算机领域的 CCF / 顶会规则硬套到医学、社科、人文等学科。

## 核心能力

### 检索与筛选

- 按关键词搜索论文。
- 查找某篇论文的精确元数据。
- 查询作者论文列表。
- 按引用数、年份、venue、开放 PDF、代码可用性筛选。
- 对 CS 论文标注 CCF 等级。
- 对近 6 个月新论文进行 `[新]` 标注，采用时效性优先排序。

### 元数据与引用

- 输出统一 metadata schema。
- 多平台结果去重合并。
- 查询引用数、引用关系和被引关系。
- 导出 BibTeX。
- 对 ML 论文补充 Papers with Code 代码链接。

### 开放全文判断

项目强调合法开放获取，不绕过付费墙。全文状态会明确标注为：

- `open_pdf`：找到公开 PDF。
- `needs_institution`：需要机构权限。
- `no_open_pdf`：没有发现开放全文。
- `anti_bot_blocked`：被 Cloudflare、验证码或反爬限制拦截。
- `html_not_pdf`：PDF 路由返回 HTML，而不是 PDF 文件。
- `unknown`：证据不足，无法可靠判断。

这比简单报告“下载失败”更适合科研工作流，因为用户可以知道下一步该找 OA 版本、机构图书馆，还是作者自存档。

### 浏览器自动化

项目内置 CDP Proxy 脚本，通过 WebSocket 连接用户本机 Chrome，并提供 HTTP API：

- 新建 tab
- 页面跳转
- 执行 JS
- 点击元素
- 滚动页面
- 截图
- 文件上传
- 关闭 tab

这个能力主要用于 Google Scholar、CNKI 等无公开 API 或需要登录态的平台。

### 站点经验沉淀

`references/site-patterns/` 目录保存了多个学术平台和出版商的访问经验，例如：

- arXiv
- Semantic Scholar
- Google Scholar
- PubMed
- ACM DL
- IEEE Xplore
- Papers with Code
- CNKI
- ScienceDirect
- Springer
- Wiley
- ACS

这些文件记录 URL 结构、字段陷阱、选择器、反爬行为和访问限制，减少 Agent 每次临时猜页面结构的成本。

## 项目结构

```text
academic-search/
├── Makefile                    # 标准测试入口
├── SKILL.md                    # 主 Skill 指令：搜索哲学、平台矩阵、学科路由、执行策略
├── README.md                   # 中文说明
├── README.en.md                # 英文说明
├── wechat-promo.md             # 推广介绍文案
├── scripts/
│   ├── cdp-proxy.mjs           # CDP Proxy，专用 Chrome / 显式端点
│   ├── check-deps.sh           # 环境检查
│   ├── oa-pdf-download.mjs     # 开放 PDF manifest 生成与下载
│   ├── oa-pdf-download-self-test.sh # 开放 PDF 下载 helper 回归测试
│   ├── self-test.sh            # 本地回归测试
│   └── release-test.sh         # 发布前测试
├── references/
│   ├── api-cookbook.md         # 多平台 API 调用模板
│   ├── metadata-schema.md      # 统一论文元数据 schema
│   ├── venue-rankings.md       # CS 会议 / 期刊 CCF 分级
│   ├── cdp-api.md              # CDP Proxy API 说明
│   ├── disciplines/            # 多学科学科 profile
│   ├── rankings/               # 学科评价和证据等级
│   ├── workflows/              # 系统综述等研究工作流
│   └── site-patterns/          # 平台和出版商经验文件
└── docs/
    ├── skill-usage-comparison.md
    └── multidisciplinary-improvement-analysis.md
```

## 适用场景

- 快速搜索某个方向的代表论文。
- 查某篇论文的引用数、BibTeX、PDF、代码链接。
- 做多篇论文元数据对比。
- 查询某位学者的论文列表并按引用数排序。
- 做系统综述或快速领域综述的第一轮文献筛选。
- 判断论文是否存在合法开放全文。
- 通过 Google Scholar 或 CNKI 查询需要浏览器登录态的数据。
- 研究如何设计一个高质量 Agent Skill。

## 与普通搜索工具的区别

Academic-Search 最大的不同在于，它不是把搜索引擎包装成命令，而是把学术检索的方法论写进 Skill：

1. 知道不同学术任务该选哪个平台。
2. 知道什么时候用 API，什么时候用浏览器。
3. 知道输出应该是论文元数据，而不是网页摘要。
4. 知道如何对多平台结果做去重合并。
5. 知道不同学科有不同评价标准。
6. 知道失败信号意味着什么，并能切换策略而不是盲目重试。

## 边界与限制

- 它不是通用论文下载器；只支持合法开放 PDF 的 manifest 生成和可选下载，不承诺获取所有 PDF。
- 它只处理合法开放访问全文，不绕过付费墙。
- Google Scholar、CNKI 等平台使用专用 Chrome 或显式指定的已运行端点；网站登录和访问权限以该 profile 的当前状态为准。
- Semantic Scholar 高频使用建议配置 API Key，否则容易遇到 429。
- 学科路由和站点经验仍需要持续补充，尤其是非 CS 学科和商业出版商平台。

## 项目价值

Academic-Search 的价值不只是“能搜论文”，而是提供了一个可复用的学术检索工作流框架。

对研究者来说，它能减少在多个平台之间手工切换、复制、整理的成本。对 Agent 开发者来说，它展示了一个 Skill 应该如何把领域知识、平台经验、结构化 schema 和工程测试结合起来。

一句话总结：Academic-Search 给 AI Agent 补上的不是浏览器，而是一套学术检索脑回路。
