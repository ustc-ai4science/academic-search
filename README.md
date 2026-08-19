<p align="center">
  <img src="assets/logo.png" alt="academic-search" width="80" style="vertical-align:middle; margin-right:12px;" />
  <strong style="font-size:2em; vertical-align:middle;">Academic-Search Skill</strong>
</p>

<p align="center">想要在 Claude Code 里直接调研顶刊论文？Academic-Search Skill 帮你实现。</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v1.2.0-0f766e" />
  <img src="https://img.shields.io/badge/license-MIT-1f2937" />
  <img src="https://img.shields.io/github/stars/Mingyue-Cheng/academic-search?style=social" />
</p>

<p align="center">📈 <a href="https://star-history.dera.page/#ustc-ai4science/academic-search&type=date&legend=top-left">Star History</a></p>

<p align="center">🌐 <a href="README.en.md">English</a> | 简体中文</p>

---

## News

- `2026-05-08` 新增 OA PDF 下载 manifest 与开放 PDF 批量下载 helper：只处理 `open_pdf` 合法来源，不绕过付费墙
- `2026-05-01` 新增多学科使用指引：学科路由、开放获取 PDF 状态、Crossref/OpenAlex/Unpaywall 跨学科底座与主要出版商访问限制
- `2026-04-05` 新增 CNKI（知网）支持文档：补充检索策略、metadata schema 字段与 site pattern 经验文件
- `2026-04-02` 发布 `v1.2.0`：新增前沿性优先排序、Query 扩展、PDF 直取、意图感知两遍搜索
- `2026-04-02` 新增案例文档：[使用 Skill vs 未使用 Skill 的搜索对比实验](docs/skill-usage-comparison.md)
- `2026-04-02` README 视觉与说明同步刷新

---

🚀 **覆盖全**：arXiv、Semantic Scholar、OpenAlex、Crossref、Unpaywall、Google Scholar、CNKI... 多学科平台协同检索。
📊 **功能强**：论文检索、引用追踪、BibTeX 导出、多源去重，一气呵成。  
📑 **获取稳**：开放获取 PDF 级联获取，明确标注机构权限和反爬限制。  
🧾 **下载清楚**：先生成 manifest，再按确认下载开放 PDF，保留跳过、失败和非 PDF 状态。
🎯 **策略精**：时效性优先排序，自带 CCF 等级标注，只看最值得看的顶会干货。

> **Academic-Search：重新定义 AI 驱动的学术研究。**

## Quick Start

```bash
git clone https://github.com/Mingyue-Cheng/academic-search ~/.claude/skills/academic-search
bash ~/.claude/skills/academic-search/scripts/check-deps.sh
```

然后直接对 Claude Code 说：

```
搜索 2023 年以来关于 graph neural network 的顶会论文，给我前 10 篇
```

---

## 核心能力

**检索与筛选**
- 学科路由：按 CS/AI、医学/生命科学、物理/数学、化学/材料、社科/经济、人文/法律选择检索源和评价标准
- 两遍策略：先输出轻量摘要表，用户确认核心论文后再深拉完整元数据；用户明确数量时直接输出，无需二次确认
- Query 扩展：自动展开 2-3 个互补 query（同义词 / 子概念 / 缩写全称），覆盖率比单 query 提升 30-50%
- 前沿性排序：**时效性优先**（近 6 月 `[新]` 置顶）→ 引用数 → CCF 等级（参考项），不因引用数低埋没最新进展
- 多平台结果以 DOI/arXiv ID 为主键自动去重合并

**数据获取**
- PDF：开放获取 PDF 级联获取；arXiv ID 存在即直接构造链接，不依赖 S2 `openAccessPdf`（该字段经常为 null）
- 全文状态：标注 `open_pdf` / `needs_institution` / `no_open_pdf` / `anti_bot_blocked` / `html_not_pdf`，不绕过付费墙
- OA PDF 下载：可生成下载 manifest，并只下载 `open_pdf` 状态的合法开放 PDF；不绕过付费墙，不处理 Sci-Hub/WebVPN/Tor。
- BibTeX：平台原生导出 + 字段拼装双路径
- 跨学科元数据：Crossref / OpenAlex / Unpaywall 补 DOI、作者机构、开放获取状态和引用关系
- 代码：Papers with Code API 自动补全代码可用性列
- 引用关系：S2 引用/被引 API，Google Scholar 引用数补充

**可靠性与扩展**
- 失败信号处理：429 / 超时 / 空结果各有对应调整策略，不在同一条路上盲目重试
- CDP 浏览器模式：直连用户日常 Chrome，天然携带登录态，用于 Google Scholar 等反爬平台
- 并行分治：多目标分发子 Agent 并行执行，共享 Proxy，tab 级隔离
- 站点经验预置：平台与出版商操作经验预置，跨 session 积累更新

## 多学科使用方式

Academic-Search 现在按学科选择检索源、query expansion、排序规则和输出字段：

| 学科 | 重点能力 |
|------|----------|
| CS / AI | arXiv、Semantic Scholar、ACM/IEEE、Papers with Code、CCF/顶会标注 |
| 医学 / 生命科学 | PubMed、Europe PMC、MeSH、系统综述/RCT 等证据等级 |
| 物理 / 数学 | arXiv 分类、MSC、NASA ADS / INSPIRE HEP 方向预留 |
| 化学 / 材料 | Crossref、OpenAlex、ChemRxiv、ACS/RSC/Springer/Wiley 访问状态 |
| 社科 / 经济 | JEL、RePEc/NBER/SSRN、方法类型和工作论文状态 |
| 人文 / 法律 | 图书/章节/档案/法律来源优先，引用数仅作辅助 |

详细规划见 [Academic-Search 面向多学科用户的完善建议](docs/multidisciplinary-improvement-analysis.md)。执行系统综述、核心论文清单、开放全文判断等任务时，Skill 会按 `references/disciplines/`、`references/rankings/`、`references/workflows/` 和 `references/site-patterns/` 逐步加载需要的参考文件。

<details>
<summary>v1.2.0 更新内容</summary>

- **前沿性排序** — 时效性优先：近 6 月论文 `[新]` 置顶，引用数次之，CCF 等级作参考项
- **Query 扩展策略** — 自动展开同义词 / 子概念 / 缩写全称，多 query 去重合并
- **PDF 直取** — arXiv ID 存在即直接构造链接，不依赖经常为 null 的 `openAccessPdf`
- **意图感知两遍策略** — 用户明确说"前 N 篇"时直接输出，无需停下等确认
- **失败信号处理** — 429 / 超时 / 空结果各对应明确调整方向
- **成功标准定义** — 执行前先明确字段需求和数量，作为全程决策锚点
- **S2 API Key 提示** — 建议申请免费 Key 避免单 session 频繁 429

</details>

<details>
<summary>v1.1.0 更新内容</summary>

- **两遍搜索策略** — 轻量摘要表先行，避免无效完整抓取
- **Venue 等级标注** — 新增 `references/venue-rankings.md`，覆盖 AI/CV/NLP/数据挖掘等方向 CCF 分级
- **结果筛选能力** — 5 个筛选维度 + 结论格式模板

</details>

---

## 安装

```bash
# 方式一：手动安装
git clone https://github.com/Mingyue-Cheng/academic-search ~/.claude/skills/academic-search

# 方式二：让 Claude 安装
# 帮我安装这个 skill：https://github.com/Mingyue-Cheng/academic-search

# 方式三：本地开发软链接（在项目目录内执行）
ln -sfn "$(pwd)" ~/.claude/skills/academic-search
```

**前置要求（仅 CDP 模式需要）**：arXiv / S2 / PubMed 等 API 平台直接可用，无需配置。如需访问 Google Scholar，需开启 Chrome 远程调试：

1. 打开 `chrome://inspect/#remote-debugging`
2. 勾选 **Allow remote debugging for this browser instance**

---

## 平台访问策略

Open API 优先，Google Scholar 与 CNKI 等无公开 API 或强反爬平台需要 Chrome 远程调试：

| 平台 | 访问方式 |
|------|---------|
| arXiv | REST API |
| Semantic Scholar | REST API |
| Crossref | REST API |
| OpenAlex | REST API |
| Unpaywall | REST API |
| PubMed | NCBI E-utilities |
| Papers with Code | REST API |
| ACM DL | WebFetch + Jina |
| IEEE Xplore | WebFetch / Jina / 官方 API |
| ScienceDirect / Wiley / Springer / ACS | 开放获取判定 + 机构访问提示 |
| **Google Scholar** | **CDP 浏览器（需 Chrome 调试）** |
| **CNKI（知网）** | **CDP 浏览器（需 Chrome 调试）** |

全文获取只针对合法开放访问来源。商业出版商页面可访问不代表 PDF 可下载；遇到需要机构权限、Cloudflare、验证码或 PDF 路由返回 HTML 时，Skill 会报告状态而不是继续尝试绕过限制。

---

## 使用示例

```
帮我找 Yann LeCun 在 Semantic Scholar 上的所有论文，按引用数排序
```
```
这篇论文的 BibTeX：https://arxiv.org/abs/1706.03762
```
```
同时调研 BERT、GPT-3、T5 的元数据和引用数，做对比表格
```
```
去 Google Scholar 查一下 "attention is all you need" 的引用数
```
```
搜索 time series agent 近两年的论文，生成开放 PDF 下载清单
```

### 开放 PDF 下载清单

Academic-Search 可以把检索结果转换成开放 PDF 下载清单：

```bash
node scripts/oa-pdf-download.mjs \
  --input results.json \
  --manifest download-manifest.json
```

确认后只下载 `open_pdf` 记录：

```bash
node scripts/oa-pdf-download.mjs \
  --input results.json \
  --manifest download-manifest.json \
  --download \
  --out-dir ./papers
```

该功能只处理合法开放 PDF，不使用 Sci-Hub、LibGen、WebVPN、Tor 或 Cloudflare 绕过。Manifest 会保留每条记录的处理结果：

| 字段 | 含义 |
|------|------|
| `download_status` | `eligible` / `downloaded` / `skipped` / `failed` / `not_pdf` |
| `download_error` | 跳过或失败原因 |
| `local_pdf_path` | 已下载 PDF 的本地路径，仅 `downloaded` 时填写 |

### 与 scansci-pdf 的分工

Academic-Search 负责检索、筛选、元数据、开放获取状态和开放 PDF 下载清单。
如果任务目标是“尽可能下载论文 PDF”，尤其涉及 WebVPN、机构代理、多源竞速或非开放来源，应交给 scansci-pdf 这类专门的论文获取工具处理。

---

## CDP Proxy API

Proxy 通过 WebSocket 直连 Chrome，提供 HTTP API（Agent 自动管理生命周期）：

```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/new?url=URL"                              # 新建 tab
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=ID" -d 'JS 表达式'    # 执行 JS
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/click?target=ID" -d 'CSS 选择器'  # 点击元素
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/screenshot?target=ID&file=/tmp/shot.png"  # 截图
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/close?target=ID"                          # 关闭 tab
```

完整参考见 [`references/cdp-api.md`](references/cdp-api.md)。

---

## 项目结构

```
academic-search/
├── Makefile                    # 标准测试入口（make test / make test-release）
├── SKILL.md                    # 主指令文件（搜索哲学、平台矩阵、核心能力）
├── scripts/
│   ├── cdp-proxy.mjs           # CDP Proxy（直连用户 Chrome）
│   ├── check-deps.sh           # 环境检查 + 自动启动 Proxy
│   ├── oa-pdf-download.mjs     # OA PDF manifest 生成与开放 PDF 下载
│   ├── oa-pdf-download-self-test.sh # OA PDF 下载 helper 回归测试
│   ├── self-test.sh            # 本地回归测试
│   └── release-test.sh         # 发布前测试
├── references/
│   ├── api-cookbook.md         # 多平台调用速查
│   ├── metadata-schema.md      # 跨平台统一元数据 schema
│   ├── venue-rankings.md       # CS 会议/期刊 CCF 分级速查
│   ├── cdp-api.md              # CDP Proxy HTTP API 完整参考
│   ├── disciplines/            # 多学科学科路由与 query expansion
│   ├── rankings/               # 非 CS 学科评价/证据等级
│   ├── workflows/              # 系统综述、核心论文清单等工作流
│   └── site-patterns/          # 平台与出版商操作经验文件
└── docs/
    ├── skill-usage-comparison.md                  # 使用/未使用 Skill 的搜索对比实验
    └── multidisciplinary-improvement-analysis.md  # 多学科能力完善建议
```

测试：`make test` / `make test-release`（端口冲突时加 `CDP_PROXY_PORT=4570`）

---

## 设计理念

> Skill = 哲学 + 技术事实，不是操作手册。讲清 tradeoff 让 AI 自己选，不替它推理。

搜索的瓶颈不在"搜"，在"筛"。核心策略是先输出轻量摘要表，让用户确认核心论文后再深拉，避免无效的完整元数据抓取。

排序优先级：**时效性（近 6 月 `[新]` 置顶）→ 引用数 → CCF 等级（参考项）**。前沿方向的新论文引用数天然偏低，以时效性为首要维度确保最新进展不被埋没。API 优先、CDP 作为兜底，结果统一结构化输出。

📋 [使用 Skill vs 未使用 Skill 的搜索对比实验](docs/skill-usage-comparison.md) — 以 "Time Series Agent" 为例，完整记录两次执行差异与关键结论。

---

## License

MIT · 作者：[Mingyue Cheng](https://mingyue-cheng.github.io/)

---

## Star History

<p align="center">
  <a href="https://star-history.dera.page/#ustc-ai4science/academic-search&type=date&legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=ustc-ai4science/academic-search&amp;type=Date&amp;theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=ustc-ai4science/academic-search&amp;type=Date" />
      <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=ustc-ai4science/academic-search&amp;type=Date" />
    </picture>
  </a>
</p>
