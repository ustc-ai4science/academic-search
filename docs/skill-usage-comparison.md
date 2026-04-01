# academic-search Skill 使用对比实验报告

> 任务：搜索 "Time Series Agent" 相关论文，返回前 10 篇  
> 日期：2026-04-02

---

## 一、背景

`academic-search` Skill 安装在 `~/.claude/skills/academic-search/`，包含：
- `SKILL.md`：搜索哲学、平台选择矩阵、两遍搜索策略
- `references/venue-rankings.md`：CS 会议/期刊 CCF 分级速查
- `references/site-patterns/semanticscholar.org.md`：S2 平台经验（字段陷阱、API 模式）
- 其他参考文件和 CDP Proxy 脚本

**核心问题**：Skill 是 Markdown 指令文件，Claude 需要通过 `Skill` 工具**显式触发**才会加载 `SKILL.md` 进上下文。直接执行任务会绕过 Skill，导致指引未被读取。

---

## 二、第一次搜索（未使用 Skill）

### 执行过程

用户说"搜索 Time Series Agent 相关的论文"后，Claude **直接开始执行**，未调用 `Skill` 工具。

```
执行路径：
1. 直接调用 S2 API → 429 限速
2. 直接调用 arXiv API → 429 限速  
3. 尝试 Jina 抓 arXiv 搜索页 → 超时
4. 用 CDP 打开 Semantic Scholar → 提取页面数据
5. S2 batch API 补引用数 → 成功
6. 直接输出结果
```

### 结果（共 8 篇）

| 标题 | 年份 | Venue | 引用数 |
|------|------|-------|--------|
| From News to Forecast: LLM-Based Time Series Forecasting with Reflection | 2024 | NeurIPS [CCF-A] | 116 |
| BRIDGE: Multi-Agent Time-Series Generation | 2025 | ICML [CCF-A] | 15 |
| A Survey of Reasoning and Agentic Systems in Time Series | 2025 | arXiv | 11 |
| TimeSeriesScientist: A General-Purpose AI Agent | 2025 | arXiv | 8 |
| Empowering Time Series Forecasting with LLM-Agents | 2025 | BigData | 6 |
| Agentic RAG for Time Series Analysis | 2024 | arXiv | 23 |
| Domain-Oriented Time Series Inference Agents | 2024 | arXiv | 12 |
| FLAIRR-TS | 2025 | EMNLP [CCF-A] | 1 |

### 问题

| 问题项 | 说明 |
|--------|------|
| 未读 site-patterns | `semanticscholar.org.md` 中记录的字段陷阱（如 `externalIds.ArXiv` 大小写）未被参考 |
| 未读 venue-rankings.md | CCF 等级标注依赖 Claude 自身知识，偶有错误风险 |
| 未执行两遍策略 | 一次性拉完所有数据，未先输出轻量摘要表再询问用户 |
| 未加载 SKILL.md | 整个搜索策略框架（平台选择矩阵、筛选维度等）均未被加载 |

---

## 三、第二次搜索（正确使用 Skill）

### 执行过程

用户明确要求"重新走一遍"，Claude 先调用 `Skill("academic-search")` 触发 Skill 加载。

```
执行路径：
1. Skill("academic-search") → SKILL.md 加载进上下文
2. 读 references/site-patterns/semanticscholar.org.md → 了解平台陷阱
3. 读 references/venue-rankings.md → 加载 CCF 分级表
4. 调用 S2 API → 429 限速（上轮余波）
5. 调用 arXiv API → 仍限速
6. 按 Skill 策略切换 CDP 模式 → 打开 S2 搜索页
7. 第一次 CDP 搜索："time series LLM agent" → 10 篇
8. 第二次 CDP 搜索："time series agentic reasoning" → 10 篇（补充）
9. S2 batch API 批量拉引用数 → 14 篇有效结果
10. 对照 venue-rankings.md 标注 CCF 等级
11. 输出轻量摘要表，停下询问用户是否需要第二遍深拉
```

### 结果（共 14 篇，第一遍轻量摘要表）

| # | 标题 | 年份 | Venue | 引用数 |
|---|------|------|-------|--------|
| 1 | From News to Forecast: LLM-Based TS Forecasting with Reflection | 2024 | NeurIPS **[CCF-A]** | **116** |
| 2 | BRIDGE: Multi-Agent TS Generation | 2025 | ICML **[CCF-A]** | 15 |
| 3 | A Survey of Reasoning and Agentic Systems in TS with LLMs | 2025 | arXiv [预印本] | 11 |
| 4 | TimeSeriesScientist: General-Purpose AI Agent | 2025 | arXiv [预印本] | 8 |
| 5 | Empowering TS Forecasting with LLM-Agents | 2025 | BigData [未收录] | 6 |
| 6 | ZARA: Zero-shot Motion TS via LLM Agents | 2025 | arXiv [预印本] | 6 |
| 7 | TimeART: Agentic TS Reasoning via Tool-Augmentation | 2026 | arXiv [预印本] | 5 |
| 8 | FLAIRR-TS: Forecasting LLM-Agents with Iterative Refinement | 2025 | EMNLP **[CCF-A]** | 1 |
| 9 | Cast-R1: Tool-Augmented Sequential Decision for TS | 2026 | arXiv [预印本] | 2 |
| 10 | Position: Beyond Model-Centric — Agentic TS Forecasting | 2026 | arXiv [预印本] | 1 |
| 11 | Structured Agentic Workflows for Financial TS with LLMs | 2025 | ICAIF [未收录] | 3 |
| 12 | CastMind: Interaction-Driven Agentic Reasoning for TS | 2025 | arXiv [预印本] | 0 |
| 13 | AnomaMind: Agentic TS Anomaly Detection | 2026 | arXiv [预印本] | 0 |
| 14 | Training-Free TS Classification via In-Context Reasoning | 2025 | arXiv [预印本] | 2 |

第一遍结束后停止，等待用户确认哪些论文需要第二遍深拉（完整摘要 + BibTeX）。

---

## 四、两次对比总结

| 对比维度 | 第一次（未用 Skill） | 第二次（正确用 Skill） |
|---------|--------------------|--------------------|
| Skill 工具调用 | ❌ | ✅ |
| SKILL.md 加载 | ❌ | ✅ |
| site-patterns 读取 | ❌ | ✅ semanticscholar.org.md |
| venue-rankings.md 读取 | ❌ | ✅ CCF 等级从文件查询 |
| 两遍搜索策略 | ❌ 一次拉完 | ✅ 轻量表 → 等用户确认 |
| API 限速兜底策略 | 临时换平台 | ✅ 按 Skill 策略切 CDP |
| 搜索覆盖 query 数 | 1 个 | ✅ 2 个（补充 agentic reasoning）|
| 结果数量 | 8 篇 | **14 篇** |
| CCF 标注来源 | Claude 自身知识 | ✅ venue-rankings.md 文件 |
| 输出格式 | 直接给最终列表 | ✅ 摘要表 + 筛选建议 + 等待确认 |

---

## 五、关键结论

**Skill 不会自动触发**。Academic-search Skill 是 Markdown 指令文件，需要 Claude 主动调用 `Skill` 工具才会加载。用户说"搜索论文"时，Claude 应自动识别场景并触发 Skill，而不是等用户显式指定。

**正确触发方式**（任一）：
```
使用 academic-search skill 搜索 XXX 论文
/academic-search 搜索 XXX
```
或由 Claude 在识别到学术搜索需求时主动调用 `Skill("academic-search")`。

**Skill 带来的实质提升**：
1. CCF 标注有据可查，不依赖模型记忆
2. 两遍策略避免无效的完整元数据拉取
3. 多 query 搜索覆盖更广（本次多找到 6 篇 2025-2026 最新论文）
4. 站点经验减少字段错误（如 S2 `ArXiv` 大小写陷阱）
