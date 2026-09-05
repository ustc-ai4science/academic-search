# 学术浏览器工作流

在 API 不满足任务、页面需要交互，或用户明确指定浏览器来源时读取。优先复用宿主可用的浏览器工具；使用 bundled CDP 时按 [cdp-api](cdp-api.md) 的配置与协议操作。API-only 任务不启动浏览器。

## 专用浏览器与登录

默认运行时使用本机已安装的 Chrome，自动启动独立持久 profile：`~/.local/share/academic-search/chrome-profile`。只读取此 profile 的 `DevToolsActivePort`，不扫描日常 Chrome 的 profile 或常用调试端口。网站首次登录在此独立窗口中完成；后续能否保持登录取决于网站会话，不复制日常 Chrome 的 cookies 或登录状态。

`ACADEMIC_CHROME_PROFILE` 可指定另一个专用 profile，`ACADEMIC_CHROME_EXECUTABLE` 可指定浏览器可执行文件。只有显式设置 `ACADEMIC_CHROME_ENDPOINT` 时，才连接已运行的外部浏览器（例如 WebUse）；该模式不自动启动浏览器，连接失败不回退至其他 Chrome。示例端口不代表当前机器已经有服务运行。

`CDP_PROXY_PORT` 是 HTTP 代理端口，v1.4.0 默认仍为 3457（v1.3.1 从 3456 迁移）；未知端口占用应报错，不接管或终止其他工具。Chrome 调试端口由系统动态分配，二者不可混用。`/health` 只读取当前连接与配置，不启动或连接浏览器。代理初次后台连接未完成时 `connected:false` 可以是启动中；按有界启动流程检查后续状态，超时报告原因。

这项隔离消除了默认连接日常 Chrome 的流程；网站登录、验证码或操作系统提示仍可能出现，不能承诺网页验证永不弹出。不要为恢复旧流程而要求用户在日常 Chrome 开启远程调试。

`/handleJsDialog` 只处理当前页面的 JavaScript `alert`、`confirm` 或 `prompt`。它不能关闭 Chrome 的远程调试许可提示、自动化横幅、浏览器权限提示或操作系统对话框。默认专用 profile 通过避免接管日常 Chrome 来消除远程调试许可流程；网页和浏览器自身仍决定其他提示是否出现。

## 结构化页面读取

正文型页面优先使用 `/readPage`，而不是每个站点重复编写 `document.body.innerText`。默认提取可见的 article/main 等语义区域，回退到 body；返回页面标题、实际 URL、语言、正文、标题列表、去重后的 HTTP(S) 链接、原始 `citation_*` 页面声明、提取方式和独立截断标记。限定 `selector` 时必须恰好匹配一个可见区域；`citation_meta` 始终来自 document head，键对应小写 meta name，值为保留重复作者等情况的字符串数组。

`/readPage` 是启发式 DOM 观察，不是论文全文或身份匹配证明；`citation_meta` 只是页面声明，仍需按标识符与来源核验。`extraction.scope:"current_frame_light_dom"` 表示它不自动穿透 iframe、Shadow DOM，也不做 OCR；`candidate_scan_truncated` 表示语义候选扫描是否触及预算。它也不保证动态列表已经加载完整。`truncated` 会分别报告 title、URL、lang、正文、标题、链接、citation meta 与自动生成的 extraction selector；任何截断都应写入本次证据，需要完整记录时继续分页、使用站点 API 或读取合法全文来源。显式 selector 在 50000 个元素内无法证明唯一时返回 `SELECTOR_SCAN_LIMIT`，不要把它降级解释为不存在。

## 观察 → 动作 → 等待 → 核验

1. **观察目标。** 保存本任务创建的 target ID，检查当前 URL、标题与页面类型。正文观察可先调用 `/readPage`；结构化卡片字段仍按当前 DOM 或 API 提取。读取该域名对应操作的经验；历史选择器先与当前 DOM 核对。用户指定已有页面时只操作获授权页面，不在结束时关闭它。
2. **定位并动作。** 选择器应唯一匹配预期控件。元素动作沿祖先链检查可见、enabled、非 inert、非 `aria-disabled`；点击还检查非零布局、pointer-events 与中心点遮挡。`clickAt` 在派发前复检元素身份、坐标和遮挡，并捕获实际 mouse event 目标。`insertText` 在一次页面执行中向精确对象派发 `beforeinput`、复检焦点并同步编辑，不使用真实键盘语义；Enter、Backspace 等使用 `/press`。遇到多匹配，限定到目标论文行或表单后再操作，不改为随意选择首个元素。按坐标点击前需要当前截图或已核对的元素坐标。
3. **等待业务终态。** 导航的 load 状态只证明文档加载进度。按当前页面观察为结果、明确空结果、挑战、登录、限流分别指定条件，使用 `/wait` 的有界等待；字段与错误结构以 [cdp-api](cdp-api.md) 为准。
4. **核验动作效果。** `status:"dispatched"` 表示动作已派发，`outcome_verified:false` 明确表示业务结果未核验。`immediate_value_verified` / `immediate_text_verified` 只证明即时 DOM 值，`focus_verified` 只证明聚焦检查，`insert_target_verified` / `dispatch_target_verified` 只证明工具观察到的动作目标；这些字段都不证明网站接收、保存或提交。页面脚本仍可主动执行自身副作用。`clickAt` 捕获 mouse events，但覆盖层在最终复检后出现时，更早注册的 window capture handler 或 pointerdown handler 仍可能先运行页面自己的代码。搜索核对输入词、筛选控件/查询参数与结果区域；排序核对当前排序状态；翻页核对页码、首条论文标识或结果集合发生变化；导出核对文件内容和记录数。

结果页上可能同时残留旧列表和挑战提示。`/wait` 按提供的条件顺序返回首个匹配状态，通常将 `blocked`、`login_required`、`rate_limited` 放在结果之前；选择器须来自当前观察。`results_ready` 条件可以使用结果区域的可见选择器，但返回后仍需核对它属于本次查询。翻页时尤其不能仅等待一个始终存在的列表容器。

## 状态与恢复

| 状态 / 症状 | 证据 | 行动 |
|---|---|---|
| `results_ready` | 本次查询的结果已出现 | 核对范围与字段后提取，保留来源 |
| `empty` | 当前查询有明确零结果提示 | 记录该次查询零结果；需要时调整词或来源 |
| `blocked` | 验证码、挑战或访问阻拦信息 | 停止原地重试，记录受阻并继续其他合法来源 |
| `login_required` | 页面明确要求登录或机构权限 | 记录所缺权限；依既有授权处理，或交付可获得的部分 |
| `rate_limited` | 页面/API 明确限流 | 遵守重试信息与总预算，协调并发；参见 API cookbook |
| HTTP 408 / `WAIT_TIMEOUT` | 等待预算耗尽 | 记录 URL、最后观察与条件，不能改报“无论文” |
| 选择器失效 | 页面可读但旧结构不再匹配 | 重新观察一次并改用当前结构；仍失败则报告提取受阻 |
| target 失效 | tab 已关闭或 session 不存在 | 查目标列表，只重建本任务需要的页面，不借用任意用户 tab |

空数组不是 `empty` 的充分证据；可能是内容尚未出现、列表改版、登录页或挑战页。对同一故障进行一次有依据的修正后若仍无进展，停止该路径并选择其他来源，不无限延长等待。`/health` 检查代理连接，`/info` 检查目标页面；它们不替代业务终态。

## 证据、截图与清理

正常 DOM 提取不要求每次截图。页面状态含糊、遮挡/坐标操作、图像信息或用户需要视觉证据时截图；保存 URL、时间和必要的状态摘要即可，避免收集无关用户页面内容。

多代理各自持有 target ID，不并发控制同一页面，也不同时争用桌面焦点。任务结束只关闭自己创建的 target；不要关闭用户原有标签页、批量关闭浏览器或停止共享代理。连接中断时验证代理与 target 的当前状态，再选择重连或重建；过去一次 ready 不是持续可用的证明。

## 经验复验

站点文件中的 `status` 指经验是否验证，不是本次页面结果。复验需记录实际操作、环境、观察到的后置状态与日期，才可填写 `last_verified`。修改选择器但未执行，只能标记 `unverified`；已知失效的旧规则标记 `deprecated` 并指向替代规则。普通检索保留本次证据即可，写回内置经验须已有维护授权，不自动写全局记忆。
