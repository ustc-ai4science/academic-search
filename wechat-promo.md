# 给 Claude Code 装上学术搜索能力：Academic-Search 开源了

如果你经常用 Claude Code、Codex 或其他 Agent 做研究辅助，应该很快会遇到一个问题：

它们会搜索，也会抓网页，但一到学术场景就开始“别扭”。

比如：

- 想找某个方向近两年的代表论文，结果返回一堆普通网页摘要
- 想查一篇论文的引用数、PDF、BibTeX、代码链接，往往要自己来回切多个站点
- 想比较几篇论文的元数据和来源差异，最后还是得手工整理
- 遇到 Google Scholar、ACM DL、IEEE Xplore 这类页面，Agent 往往缺少可靠的访问策略

所以我把这部分能力单独做成了一个开源 Skill：

## Academic-Search

一个面向 Claude Code 的学术搜索与论文元数据提取 Skill。

它补上的，不只是“联网能力”，而是**学术检索策略 + 多平台元数据整合 + 必要时的浏览器自动化能力**。

项目地址：

```text
https://github.com/ustc-ai4science/academic-search
```

---

## 它解决的是什么问题

Academic-Search 不是一个单纯的“搜索脚本”，而是一个专门为学术场景设计的 Agent Skill。

它关心的不是“怎么打开网页”，而是：

- 该去哪个平台找
- 什么时候优先走 API，什么时候需要浏览器
- 结果应该怎么结构化输出
- 多个来源的数据怎么去重、合并、对比
- 怎样把搜索变成真正可用于研究工作的信息整理流程

换句话说，它更像是给 Agent 加了一套“学术检索脑回路”。

---

## 当前支持哪些平台

目前已经覆盖 8 个常见学术平台：

- arXiv
- Semantic Scholar
- Google Scholar
- ACM Digital Library
- IEEE Xplore
- PubMed
- Papers with Code
- CNKI（中国知网）

其中：

- 对 arXiv、Semantic Scholar、PubMed、Papers with Code 这类开放平台，优先走 API
- 对 Google Scholar 这类没有稳定公开 API、且反爬严格的平台，使用 CDP 直连用户本机 Chrome
- 对 CNKI 这类中文文献平台，使用 CDP 直连用户本机 Chrome，复用机构登录态
- 对 ACM、IEEE 这类介于两者之间的平台，根据场景选择 WebFetch、Jina、页面抓取或 CDP 兜底

核心原则很简单：

> API 优先，结构化优先，浏览器作为兜底，而不是默认手段。

---

## 它能做什么

Academic-Search 目前已经支持这些高频任务：

- 关键词搜索某个研究方向的代表论文
- 查询某篇论文的标题、作者、年份、Venue、引用数、摘要、PDF、BibTeX
- 查询作者论文列表
- 做多篇论文的对比表格
- 调研某个方向最近几年的进展
- 查引用关系、开放 PDF、代码仓库
- 批量收集文献并输出统一 schema

项目内部默认采用“两遍搜索策略”：

- 第一遍先拉轻量摘要表，只看标题、年份、venue、引用数、PDF 可用性
- 第二遍再对核心论文深入提取摘要、PDF、BibTeX 和其他补充信息

这个设计很重要，因为学术检索真正耗时的地方通常不是“搜”，而是“筛”。

---

## 为什么它和普通 Web 搜索不一样

很多 Agent 项目都把“搜索网页”当成能力上限，但学术场景的关键其实不是网页本身，而是**论文对象**。

Academic-Search 在设计上更强调几件事：

### 1. 平台选择

不同任务应该优先走不同平台。

例如：

- 查开放 PDF，arXiv 很强
- 查引用数和作者信息，Semantic Scholar 更直接
- 查 Google Scholar 引用量，则必须走浏览器
- 查 ML 代码仓库，Papers with Code 更自然

### 2. 结构化结果

不是把网页内容“读一遍”就结束，而是尽量输出统一字段，例如：

- 标题
- 作者
- 年份
- venue
- DOI
- arXiv ID
- citation count
- PDF URL
- BibTeX

这样结果可以直接做去重、合并、导出和后续分析。

### 3. 站点经验

不同学术平台的页面结构、访问方式和坑都不一样。

这个项目把站点经验独立存放，作为 Skill 的一部分持续积累，而不是每次临时靠 prompt 硬猜。

---

## 工程上做了哪些事情

为了让它不只是“能跑”，而是“更适合开源复用”，最近我也补了不少工程工作：

- 统一了 CDP Proxy 的参数校验和错误返回
- 增加了基础回归测试和发布前回归测试
- 覆盖了 click、clickAt、scroll、screenshot、setFiles、navigate、back 等关键路径
- 补了 `make test` 和 `make test-release`
- 整理了中英文 README 和项目首页展示

也就是说，这个项目现在不只是一个想法验证，而是一个已经具备初步开源可用性的 Skill 项目。

---

## 适合谁使用

如果你属于下面几类人，这个项目应该会比较有用：

- 经常做论文调研的研究生、博士生、科研工作者
- 想把 Claude Code 用到研究工作流里的开发者
- 正在做 AI Agent + 科研辅助方向探索的人
- 想研究“Skill 应该怎么设计”而不仅仅是“prompt 怎么写”的工程师

它不只是一个具体工具，也可以当作一个 Skill 设计案例来看：

> 怎样把一个模糊任务域，拆成“哲学 + 平台矩阵 + 技术事实 + 工程测试”这一整套可复用能力。

---

## 一个典型使用方式

安装后，你可以直接对 Claude Code 说：

```text
搜索 2023 年以来关于 graph neural network 的顶会论文，给我前 10 篇
```

或者：

```text
帮我找 Yann LeCun 在 Semantic Scholar 上的所有论文，按引用数排序
```

再或者：

```text
同时调研 BERT、GPT-3、T5 的元数据和引用数，做一个对比表格
```

对用户来说，它不是一个“命令集合”，而是一个更懂学术搜索的 Agent 能力模块。

---

## 为什么选择开源

我一直觉得，Agent 的真正上限不只取决于模型本身，还取决于它背后的 Skill 设计。

一个高质量 Skill，至少应该同时具备：

- 任务域内的判断逻辑
- 对一手信息源的理解
- 适配不同平台的操作策略
- 可以被验证的工程实现

Academic-Search 开源出来，一方面是为了让更多人直接拿去用；另一方面也是想把“Skill 怎么设计得更有上限”这件事，做成一个可讨论、可复用的样例。

---

## 项目地址

GitHub：

```text
https://github.com/ustc-ai4science/academic-search
```

如果你也在做：

- Agent + Research
- Claude Code Skill 设计
- 学术检索自动化
- 论文工作流增强

欢迎关注、Star、试用，也欢迎交流反馈。

如果这类方向你感兴趣，后面我也会继续分享这个项目背后的设计思路、踩坑过程，以及更多 Agent Skill 的实践经验。

---

## 可选标题备选

如果你想换一个更偏传播风格的标题，可以考虑：

1. 我把 Claude Code 的学术搜索能力补齐了，一个开源 Skill
2. 让 Claude Code 真正会查论文：Academic-Search 开源了
3. 给 Agent 装上学术检索脑回路：Academic-Search 发布
4. 一个专为论文搜索设计的 Claude Code Skill，开源了
5. 从“会联网”到“会查论文”：Academic-Search 项目介绍

## 可选结尾文案

如果你想让结尾更适合公众号风格，可以直接用这段：

> 如果你也在探索 Agent 如何真正进入科研工作流，Academic-Search 也许能给你一个可直接上手的起点。  
> 欢迎 Star、试用、提 Issue，也欢迎把它分享给同样在做研究和开发的朋友。
