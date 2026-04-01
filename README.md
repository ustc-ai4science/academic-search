# academic-search

给 Claude Code 装上完整学术搜索能力的 skill。

Claude Code 原本有 WebSearch、WebFetch，但缺少学术场景的检索策略、跨平台元数据整合和浏览器自动化能力。这个 skill 补上的是：**学术检索策略 + 结构化元数据提取 + CDP 浏览器操作 + 站点经验积累**。

---

## v1.1.0 能力

| 能力 | 说明 |
|------|------|
| 7 平台全覆盖 | arXiv / Semantic Scholar / Google Scholar / ACM DL / IEEE Xplore / PubMed / Papers with Code |
| API 优先策略 | 6 个平台直接调用开放 API，无需浏览器，速度快、稳定 |
| CDP 浏览器模式 | Google Scholar 等反爬平台直连用户日常 Chrome，天然携带登录态 |
| 两遍搜索策略 | 先输出轻量摘要表（引用数 + venue 等级），确认核心论文后再深拉完整元数据 |
| Venue 等级标注 | CS 会议/期刊自动标注 CCF 分级（A/B/C），ICLR 单独标注 |
| 结果筛选 | 按引用数 / 年份 / venue 等级 / 开放 PDF / 代码可用性多维筛选 |
| 结构化元数据 | 跨平台统一 schema，DOI 为主键自动去重合并 |
| PDF 级联获取 | arXiv 直链 → S2 OpenAccess → Unpaywall，不绕付费墙 |
| BibTeX 导出 | 平台原生导出 + 字段拼装双路径 |
| 引用关系查询 | S2 引用/被引 API，Google Scholar 引用数补充 |
| 并行分治 | 多目标分发子 Agent 并行执行，共享 Proxy，tab 级隔离 |
| 站点经验预置 | 7 个平台安装时即预置操作经验（URL 模式、选择器、已知陷阱） |

<details>
<summary>v1.1.0 更新</summary>

- **两遍搜索策略** — 第一遍拉轻量摘要表（引用数 + venue），确认核心论文后第二遍深拉，避免无效完整抓取
- **Venue 等级标注** — 新增 `references/venue-rankings.md`，覆盖 AI/ML/CV/NLP/数据挖掘/信息检索/系统/软工 CCF 分级速查
- **结果筛选能力** — 新增显式筛选节，5 个筛选维度 + 结论格式模板

</details>

---

## 安装

**方式一：让 Claude 自动安装**

```
帮我安装这个 skill：https://github.com/Mingyue-Cheng/academic-search
```

**方式二：手动**

```bash
git clone https://github.com/Mingyue-Cheng/academic-search ~/.claude/skills/academic-search
```

**方式三：本地软链接（开发用）**

```bash
# 在 academic-search/ 目录内执行
ln -sfn "$(pwd)" ~/.claude/skills/academic-search
```

---

## 前置配置（CDP 模式，仅 Google Scholar 等需要）

使用 arXiv、Semantic Scholar、PubMed 等 API 平台时无需任何配置，直接可用。

CDP 模式需要 **Node.js 22+** 和 Chrome 开启远程调试：

1. Chrome 地址栏打开 `chrome://inspect/#remote-debugging`
2. 勾选 **Allow remote debugging for this browser instance**（可能需要重启浏览器）

环境检查（Agent 运行时会自动完成，无需手动执行）：

```bash
bash ~/.claude/skills/academic-search/scripts/check-deps.sh
```

---

## 使用

安装后直接向 Claude Code 提出学术搜索任务，skill 自动接管：

```
搜索 2023 年以来关于 graph neural network 的顶会论文，给我前 10 篇
```

```
帮我找 Yann LeCun 在 Semantic Scholar 上的所有论文，按引用数排序
```

```
这篇论文的 BibTeX：https://arxiv.org/abs/1706.03762
```

```
同时调研 BERT、GPT-3、T5 的元数据和引用数，做一个对比表格
```

```
去 Google Scholar 查一下 "attention is all you need" 的引用数
```

---

## 平台访问策略

| 平台 | 访问方式 | 需要 Chrome 调试 |
|------|---------|:--------------:|
| arXiv | REST API | 否 |
| Semantic Scholar | REST API | 否 |
| PubMed | NCBI E-utilities | 否 |
| Papers with Code | REST API | 否 |
| ACM DL | WebFetch + Jina | 否 |
| IEEE Xplore | WebFetch / Jina / 官方 API | 否 |
| Google Scholar | CDP 浏览器 | **是** |

---

## CDP Proxy API

Proxy 通过 WebSocket 直连 Chrome（兼容 `chrome://inspect` 方式，无需命令行参数启动），提供 HTTP API：

```bash
# Agent 会自动管理 Proxy 生命周期，无需手动启动
bash ~/.claude/skills/academic-search/scripts/check-deps.sh

# 页面操作
curl -s "http://localhost:3456/new?url=https://scholar.google.com"           # 新建 tab
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'document.title'  # 执行 JS
curl -s -X POST "http://localhost:3456/click?target=ID" -d 'button.submit'  # 点击元素
curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/shot.png"      # 截图
curl -s "http://localhost:3456/scroll?target=ID&direction=bottom"            # 滚动
curl -s "http://localhost:3456/close?target=ID"                              # 关闭 tab
```

详见 `references/cdp-api.md`。

---

## 项目结构

```
academic-search/
├── SKILL.md                          # 主指令（搜索哲学 + 平台矩阵 + 核心能力）
├── README.md
├── scripts/
│   ├── cdp-proxy.mjs                 # CDP Proxy HTTP 服务（直连用户 Chrome）
│   └── check-deps.sh                 # 环境检查 + 自动启动 Proxy
└── references/
    ├── api-cookbook.md               # 7 平台 API 调用速查（curl 示例 + 字段映射）
    ├── metadata-schema.md            # 跨平台统一元数据结构 + 去重规则 + BibTeX 模板
    ├── venue-rankings.md             # CS 会议/期刊 CCF 分级速查
    ├── cdp-api.md                    # CDP Proxy HTTP API 完整参考
    └── site-patterns/
        ├── arxiv.org.md
        ├── semanticscholar.org.md
        ├── scholar.google.com.md
        ├── dl.acm.org.md
        ├── ieeexplore.ieee.org.md
        ├── pubmed.ncbi.nlm.nih.gov.md
        └── paperswithcode.com.md
```

---

## 设计理念

> Skill = 哲学 + 技术事实，不是操作手册。讲清 tradeoff 让 AI 自己选，不替它推理。

- **搜索的瓶颈在筛选，不在搜索本身**：先输出轻量摘要表，让用户确认核心论文后再深入，避免无效的完整抓取
- **API 优先**：有官方 API 的平台绝不用浏览器模拟，速度快、稳定、不触发反爬
- **CDP 是兜底而非首选**：仅在没有可靠 API 时（Google Scholar）才使用 CDP
- **结构化输出**：所有结果转为统一 schema，DOI 为主键去重，可直接导出 BibTeX
- **站点经验复用**：预置 7 个平台的操作经验，跨 session 积累更新

---

## License

MIT · 作者：Mingyue Cheng
