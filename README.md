<p align="center">
  <img src="assets/logo.png" alt="academic-search" width="80" style="vertical-align:middle; margin-right:12px;" />
  <strong style="font-size:2em; vertical-align:middle;">Academic-Search Skill</strong>
</p>

<p align="center">面向 Claude Code 的学术搜索与论文元数据提取 Skill</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v1.1.0-0f766e" />
  <img src="https://img.shields.io/badge/license-MIT-1f2937" />
  <img src="https://img.shields.io/github/stars/Mingyue-Cheng/academic-search?style=social" />
</p>

<p align="center">🌐 <a href="README.en.md">English</a> | 简体中文</p>

---

给 Claude Code 装上完整学术搜索能力的 skill。覆盖 **arXiv、Semantic Scholar、Google Scholar、ACM DL、IEEE Xplore、PubMed、Papers with Code** 七大平台，支持论文检索、引用分析、PDF 获取、BibTeX 导出与多来源结果整合。

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
- 两遍策略：先输出轻量摘要表（引用数 + CCF 等级），确认核心论文后再深拉完整元数据
- 按引用数 / 年份 / venue 等级 / 开放 PDF / 代码可用性多维筛选
- 多平台结果以 DOI 为主键自动去重合并

**数据获取**
- PDF 级联：arXiv 直链 → S2 OpenAccess → Unpaywall，不绕付费墙
- BibTeX：平台原生导出 + 字段拼装双路径
- 引用关系：S2 引用/被引 API，Google Scholar 引用数补充

**自动化与扩展**
- CDP 浏览器模式：直连用户日常 Chrome，天然携带登录态，用于 Google Scholar 等反爬平台
- 并行分治：多目标分发子 Agent 并行执行，共享 Proxy，tab 级隔离
- 站点经验预置：7 个平台预置操作经验，跨 session 积累更新

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

6 个平台直接调用开放 API，仅 Google Scholar 需要 Chrome 远程调试：

| 平台 | 访问方式 |
|------|---------|
| arXiv | REST API |
| Semantic Scholar | REST API |
| PubMed | NCBI E-utilities |
| Papers with Code | REST API |
| ACM DL | WebFetch + Jina |
| IEEE Xplore | WebFetch / Jina / 官方 API |
| **Google Scholar** | **CDP 浏览器（需 Chrome 调试）** |

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
├── SKILL.md                    # 主指令文件（搜索哲学、平台矩阵、核心能力）
├── scripts/
│   ├── cdp-proxy.mjs           # CDP Proxy（直连用户 Chrome）
│   ├── check-deps.sh           # 环境检查 + 自动启动 Proxy
│   ├── self-test.sh            # 本地回归测试
│   └── release-test.sh         # 发布前测试
├── references/
│   ├── api-cookbook.md         # 7 平台 API 调用速查
│   ├── metadata-schema.md      # 跨平台统一元数据 schema
│   ├── venue-rankings.md       # CS 会议/期刊 CCF 分级速查
│   ├── cdp-api.md              # CDP Proxy HTTP API 完整参考
│   └── site-patterns/          # 7 个平台的操作经验文件
└── docs/
    └── skill-usage-comparison.md  # 使用/未使用 Skill 的搜索对比实验
```

测试：`make test` / `make test-release`（端口冲突时加 `CDP_PROXY_PORT=4570`）

---

## 设计理念

> Skill = 哲学 + 技术事实，不是操作手册。讲清 tradeoff 让 AI 自己选，不替它推理。

搜索的瓶颈不在"搜"，在"筛"。本 skill 的核心策略是先输出轻量摘要表，让用户确认核心论文后再深拉，避免无效的完整元数据抓取。API 优先、CDP 作为兜底，结果统一结构化输出。

📋 [使用 Skill vs 未使用 Skill 的搜索对比实验](docs/skill-usage-comparison.md) — 以 "Time Series Agent" 为例，完整记录两次执行差异与关键结论。

---

## License

MIT · 作者：Mingyue Cheng
