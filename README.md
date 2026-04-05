<p align="center">
  <img src="assets/logo.png" alt="academic-search" width="80" style="vertical-align:middle; margin-right:12px;" />
  <strong style="font-size:2em; vertical-align:middle;">Academic-Search Skill</strong>
</p>

<p align="center">想要在 Claude Code 里直接调研顶刊论文？Academic-Search Skill 帮你实现。</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v1.2.0-0f766e" />
  <img src="https://img.shields.io/badge/license-MIT-1f2937" />
  <img src="https://img.shields.io/github/stars/ustc-ai4science/academic-search?style=social" />
</p>

<p align="center">🌐 <a href="README.en.md">English</a> | 简体中文</p>

---

## News

- `2026-04-02` 发布 `v1.2.0`：新增前沿性优先排序、Query 扩展、PDF 直取、意图感知两遍搜索
- `2026-04-02` 新增案例文档：[使用 Skill vs 未使用 Skill 的搜索对比实验](docs/skill-usage-comparison.md)
- `2026-04-02` 仓库链接统一切换到 `ustc-ai4science/academic-search`，README 视觉与说明同步刷新
---

🚀 **覆盖全**：arXiv、Semantic Scholar、Google Scholar... 七大平台火力全开。  
📊 **功能强**：论文检索、引用追踪、BibTeX 导出、多源去重，一气呵成。  
📑 **获取快**：PDF 级联获取，代码实现一键直达。  
🎯 **策略精**：时效性优先排序，自带 CCF 等级标注，只看最值得看的顶会干货。

> **Academic-Search：重新定义 AI 驱动的学术研究。**

## Quick Start

```bash
git clone https://github.com/ustc-ai4science/academic-search ~/.claude/skills/academic-search
bash ~/.claude/skills/academic-search/scripts/check-deps.sh
```

然后直接对 Claude Code 说：

```
搜索 2023 年以来关于 graph neural network 的顶会论文，给我前 10 篇
```

---

## 核心能力

**检索与筛选**
- 两遍策略：先输出轻量摘要表，用户确认核心论文后再深拉完整元数据；用户明确数量时直接输出，无需二次确认
- Query 扩展：自动展开 2-3 个互补 query（同义词 / 子概念 / 缩写全称），覆盖率比单 query 提升 30-50%
- 前沿性排序：**时效性优先**（近 6 月 `[新]` 置顶）→ 引用数 → CCF 等级（参考项），不因引用数低埋没最新进展
- 多平台结果以 DOI/arXiv ID 为主键自动去重合并

**数据获取**
- PDF：arXiv ID 存在即直接构造链接，不依赖 S2 `openAccessPdf`（该字段经常为 null）
- BibTeX：平台原生导出 + 字段拼装双路径
- 代码：Papers with Code API 自动补全代码可用性列
- 引用关系：S2 引用/被引 API，Google Scholar 引用数补充

**可靠性与扩展**
- 失败信号处理：429 / 超时 / 空结果各有对应调整策略，不在同一条路上盲目重试
- CDP 浏览器模式：直连用户日常 Chrome，天然携带登录态，用于 Google Scholar 等反爬平台
- 并行分治：多目标分发子 Agent 并行执行，共享 Proxy，tab 级隔离
- 站点经验预置：7 个平台预置操作经验，跨 session 积累更新

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
git clone https://github.com/ustc-ai4science/academic-search ~/.claude/skills/academic-search

# 方式二：让 Claude 安装
# 帮我安装这个 skill：https://github.com/ustc-ai4science/academic-search

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

搜索的瓶颈不在"搜"，在"筛"。核心策略是先输出轻量摘要表，让用户确认核心论文后再深拉，避免无效的完整元数据抓取。

排序优先级：**时效性（近 6 月 `[新]` 置顶）→ 引用数 → CCF 等级（参考项）**。前沿方向的新论文引用数天然偏低，以时效性为首要维度确保最新进展不被埋没。API 优先、CDP 作为兜底，结果统一结构化输出。

📋 [使用 Skill vs 未使用 Skill 的搜索对比实验](docs/skill-usage-comparison.md) — 以 "Time Series Agent" 为例，完整记录两次执行差异与关键结论。

---

## License

MIT · 作者：Mingyue Cheng
