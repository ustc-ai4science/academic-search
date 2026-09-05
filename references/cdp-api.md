# CDP Proxy API 参考

## 基础信息

- `ACADEMIC_SEARCH_ROOT` 指向本 Skill 的实际安装目录（`SKILL.md` 所在目录）。
- v1.4.0 的 Proxy 地址默认仍是 `http://127.0.0.1:3457`，可由 `CDP_PROXY_PORT` 覆盖。v1.3.1 从 3456 迁移到 3457；不接管旧端口上的其他服务。
- 仅在需要此包的浏览器模式时运行 `bash "$ACADEMIC_SEARCH_ROOT/scripts/check-deps.sh"`；API-only 任务不执行浏览器准备。
- `check-deps` 仅复用能核对为本工具记录的代理 PID、版本和配置的进程。未知端口占用明确失败，不自动采用或停止旧代理。
- 复用前先在本机核验随机进程标记与监听端口归属；macOS/Linux 需要 `ps` 和 `lsof`，Windows 使用 PowerShell。核验工具缺失或失败时拒绝复用，不通过请求未知 `/health` 来猜测身份。启动记录与日志默认保存在 `~/.local/share/academic-search/proxy-state`，可用 `ACADEMIC_PROXY_STATE_DIR` 指定其他目录。
- 测试或诊断需直接启动时可运行 `CDP_PROXY_PORT=3457 node "$ACADEMIC_SEARCH_ROOT/scripts/cdp-proxy.mjs"`，并由调用者管理该进程生命周期。
- 直接启动不产生 `check-deps` 的归属记录，不能随后通过 `check-deps` 自动接纳该实例；常规任务从 `check-deps` 启动。
- 停止任务自建的测试代理时仅停止已记录的 PID；不要批量停止用户代理。持久 profile 供后续任务复用，不在任务结束时删除。

## 浏览器配置

| 环境变量 | 默认值 / 语义 |
|---|---|
| `ACADEMIC_CHROME_PROFILE` | `~/.local/share/academic-search/chrome-profile`；managed 模式的专用持久 profile |
| `ACADEMIC_CHROME_EXECUTABLE` | 未指定时查找本机 Chrome；可设为实际可执行文件路径 |
| `ACADEMIC_CHROME_ENDPOINT` | 未设置时为 managed 模式；设置后仅连接指定已运行的 HTTP CDP 端点 |
| `ACADEMIC_CHROME_START_TIMEOUT_MS` | 15000；准备专用浏览器的等待上限 |
| `ACADEMIC_CDP_CONNECT_TIMEOUT_MS` | 5000；CDP 连接等待上限 |
| `CDP_PROXY_PORT` | 3457；本代理 HTTP 监听端口，与 Chrome 调试端口不同 |

managed 模式使用本机 Chrome，以专用 `--user-data-dir`、`--remote-debugging-port=0`、`--remote-debugging-address=127.0.0.1` 启动。只读取指定专用 profile 的 `DevToolsActivePort` 获取动态端口，不扫描日常 Chrome profile 或常用端口。`ACADEMIC_CHROME_PROFILE` 应指向专用目录，不要配置为日常浏览器的数据目录。首次网站登录在此 profile 中完成；它不复制日常浏览器的登录态，网站也可能要求重新登录或验证码。

endpoint 模式只连接明确给出的已运行端点，启动失败或连接失败时不自动启动浏览器、不切换 profile、不扫描其他端口。例如 WebUse 确实已运行于下列端点时：

```bash
ACADEMIC_CHROME_ENDPOINT=http://127.0.0.1:9334 \
  bash "$ACADEMIC_SEARCH_ROOT/scripts/check-deps.sh"
```

此命令不启动 WebUse；示例不表示该端点在当前机器运行。配置指纹或版本与现有代理不符时，应报告差异并使用独立代理端口，不把其他工具的代理当作本实例。

配置检查可以直接调用 `node "$ACADEMIC_SEARCH_ROOT/scripts/browser-runtime.mjs" config`：只输出配置，不访问网络、不启动浏览器。`ensure` 子命令会有界准备 managed 浏览器或检查显式 endpoint，并输出准备结果 JSON。

## API 端点

### GET /health
只读状态检查，不触发发现、启动或连接浏览器。返回 `status`、`connected`、`sessions`、`chromePort`、`pid`、`instance_id`、实际监听 `port`、`version:"1.4.0"` 与 `browser` 配置：

```json
{"mode":"managed","endpoint":null,"profile_dir":"/absolute/path/to/academic-search/chrome-profile"}
```

`browser.mode` 为 `managed` 或 `endpoint`。managed 准备完成前 `endpoint` 为 null，之后为动态 HTTP 调试地址；endpoint 模式显示配置的 HTTP 地址且 `profile_dir` 为 null。`status:"ok"` 表示 HTTP 服务存活，浏览器可用还需 `connected:true`。首次后台连接未完成时可能为 false；重复读取 health 本身不会启动或重连。测试必须核对新启动进程的 PID、实例标识和版本，不能仅凭旧代理响应判定通过。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/health"
```

### GET /targets
列出所有已打开的页面 tab。返回数组，每项含 `targetId`、`title`、`url`。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/targets"
```

### GET /new?url=URL
创建空白后台 tab，attach 后再导航到请求 URL，返回 `{ targetId, load_status }`。`load_status` 为 `complete`、`timeout` 或 `error`；错误时保留已创建的 `targetId` 以便检查和清理。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/new?url=https://example.com"
```

### GET /close?target=ID
关闭指定 tab。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/close?target=TARGET_ID"
```

### GET /navigate?target=ID&url=URL
在已有 tab 中导航到新 URL。保留 CDP 的 `frameId`、`loaderId` 等字段，增加 `load_status`；导航返回 `errorText` 时返回 HTTP 502、`code:"NAVIGATION_FAILED"` 和 `load_status:"error"`。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/navigate?target=ID&url=https://example.com"
```

### GET /back?target=ID
后退一页，返回 `{ ok:true, navigated:true, load_status }`。先观察主文档导航事件，再检查新文档加载，防止旧页面的 `complete` 状态被误判为后退完成。没有上一条历史时返回 `navigated:false`、`load_status:"complete"`。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/back?target=ID"
```

三个导航端点均接受可选查询参数 `timeout_ms`（整数 1–60000，默认 15000），用于限制文档加载检查。`complete` 仅表示 `document.readyState === "complete"`，不表示异步搜索结果已就绪。`timeout` 不取消导航，之后可通过 `/info` 或 `/wait` 检查。该时限从加载检查开始计算，连接、attach 和导航 CDP 命令仍使用各自的命令时限。

### POST /wait?target=ID

只读轮询显式 CSS 条件，识别当前页面状态；不会点击、滚动或修改 DOM。POST body 为 JSON：

```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/wait?target=ID" \
  -H 'Content-Type: application/json' \
  -d '{"conditions":[{"state":"blocked","selector":".challenge","visible":true},{"state":"empty","selector":".empty-results","visible":true},{"state":"results_ready","selector":".results","visible":true}],"timeout_ms":15000,"poll_ms":250}'
```

- `conditions`：1–20 个**有序备选条件**；每轮按数组顺序选中第一个满足条件的状态。建议把验证、登录、限流和空结果置于结果条件之前，以免已有旧结果遮盖新提示。
- 每个条件必须包含 `state` 和当前页面已观察到的 `selector`；代理没有内置跨网站选择器。状态名称限于 `results_ready`、`blocked`、`empty`、`login_required`、`rate_limited`。这些标签由调用者与选择器建立对应关系，不代表代理能判断提示的语义。
- `visible`：可选布尔值，默认 `true`。`true` 要求至少一个匹配元素具有非零布局尺寸，且 display/visibility 未隐藏；`false` 只要求 DOM 中存在元素。它不检查遮挡、视口内位置或文本真实性。
- `timeout_ms`：整数 1–60000，默认 15000；`poll_ms`：整数 1–5000，默认 250。轮询串行执行，每条观察 CDP 命令也受剩余等待时限约束。等待时限从 session 建立后的首次观察开始计算。
- 当前 document 中多个结果元素可以满足等待条件；等待不执行元素操作。选择器不自动穿透 iframe 或 Shadow DOM。

命中返回 HTTP 200：

```json
{"state":"results_ready","matched":true,"elapsed_ms":504,"condition":{"state":"results_ready","selector":".results","visible":true},"diagnostics":{"match_count":10,"visible_count":10}}
```

没有观察到条件时返回 HTTP 408；`diagnostics` 保留最近一次观察的各条件计数，若浏览器从未响应则为空数组：

```json
{"error":"等待页面条件超时","code":"WAIT_TIMEOUT","state":"timeout","matched":false,"elapsed_ms":15000,"diagnostics":[{"state":"results_ready","selector":".results","visible":true,"match_count":0,"visible_count":0}]}
```

格式错误或无效选择器返回 HTTP 400 与 `INVALID_ARGUMENT` / `INVALID_SELECTOR`；浏览器执行失败保留对应错误，不把执行失败当作空结果。WebSocket 断开时立即拒绝挂起命令，返回 HTTP 503 与 `CDP_DISCONNECTED`，不伪装成页面条件超时。`GET /wait` 返回 HTTP 405。超时后先观察当前 URL、DOM 或截图，更新证据后再决定是否继续等待；不要把超时写为“无结果”。

### GET /info?target=ID
获取页面基础信息（title、url、readyState）。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/info?target=ID"
```

### POST /readPage?target=ID

读取一个可见正文区域并收集 document head 中的原始 `citation_*` meta，返回有界、结构化的页面观察。POST body 为 JSON，可选 `selector`、`max_chars`（默认 20000，范围 1–200000）、`max_links`（默认 100，范围 1–1000）和 `max_citation_meta`（默认 100，范围 1–1000）。selector 是至多 2000 字符的非空 CSS 选择器；headings 固定最多返回 100 项：

```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/readPage?target=ID" \
  -H 'Content-Type: application/json' \
  -d '{"selector":"article","max_chars":20000,"max_links":100,"max_citation_meta":100}'
```

`selector` 省略时，对 article/main/role=main 等可见候选评分，找不到合适候选则回退到 body。显式 selector 必须恰好匹配一个可见区域。返回示例：

```json
{
  "title": "Paper title",
  "url": "https://example.org/paper",
  "lang": "en",
  "text": "Visible article text...",
  "headings": [{"level": 1, "text": "Paper title"}],
  "links": [{"text": "PDF", "url": "https://example.org/paper.pdf"}],
  "citation_meta": {
    "citation_title": ["Paper title"],
    "citation_author": ["First Author", "Second Author"],
    "citation_doi": ["10.1000/example"]
  },
  "extraction": {
    "method": "semantic",
    "selector": "article.paper",
    "heuristic": true,
    "scope": "current_frame_light_dom",
    "candidate_scan_truncated": false
  },
  "truncated": {
    "title": false,
    "url": false,
    "lang": false,
    "text": false,
    "headings": false,
    "links": false,
    "citation_meta": false,
    "extraction_selector": false
  }
}
```

正文清理会沿祖先链忽略表单、导航、侧栏、脚本、`hidden` / `aria-hidden` 与透明内容；body 回退同样检查 html/body 祖先。`citation_meta` 的键为小写 meta name，每个值均为去重后的字符串数组；它只记录页面声明，不验证论文身份。`extraction.heuristic:true` 和 `scope:"current_frame_light_dom"` 明确说明这是当前 frame 的 light DOM 启发式观察；`candidate_scan_truncated` 表示语义候选枚举是否触及预算。该端点不穿透 iframe 或 Shadow DOM、不做 OCR，也不证明论文全文或动态结果完整。八个 `truncated` 字段分别判断，不能用其中一个代替其他字段；`extraction_selector:true` 表示自动生成的来源描述被限长，不能把它当作可复用的完整 selector。

读取预算用于约束异常大页面：自动候选与 heading/link 收集分别最多遍历 10000 个元素；语义候选最多保留 200 项，每项评分最多读取 500 个节点和 5000 字符；最终正文最多访问 50000 个节点且受 `max_chars` 限制；document head 最多遍历 5000 个元素。单个文本节点最多规范化 65536 个原始字符；单个 heading/link 文本和 citation value 最多 4096 字符，link URL 与页面 URL 最多 8192 字符，citation name 与 lang 最多 256 字符，title 最多 4096 字符。相应内容被省略或截断时设置对应字段。

显式 selector 通过逐元素 `matches()` 在当前 light DOM 中最多遍历 50000 个元素：发现第二个匹配即返回 `SELECTOR_AMBIGUOUS`，并附 `match_count:2`、`match_count_truncated:true`，其中 2 是已确认的下界；遍历预算耗尽且尚不能证明唯一或不存在时返回 `SELECTOR_SCAN_LIMIT` 与 `selector_scan_truncated:true`。`:scope` 由浏览器按当前被测元素解释，因此需要 document-scoped `:scope` 语义时应改用不含 `:scope` 的等价唯一 selector。

### POST /eval?target=ID
执行 JavaScript 表达式，POST body 为 JS 代码。
```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/eval?target=ID" -d 'document.title'
```

### POST /click?target=ID
JS 层面点击（`el.click()`），POST body 为 CSS 选择器。要求恰好一个匹配元素，并在动作前检查可见、enabled、非 inert、非 `aria-disabled`、非 `pointer-events:none`、非零布局及中心点无遮挡；检查失败不点击。
```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/click?target=ID" -d 'button.submit'
```

成功响应保留 `clicked:true` 兼容字段，并返回 `status:"dispatched"`、`outcome_verified:false`。这些字段只证明点击已派发；仍须用 `/wait`、`/readPage` 或站点数据核验结果。

### POST /clickAt?target=ID
CDP 浏览器级鼠标点击（`Input.dispatchMouseEvent`），POST body 为 CSS 选择器。执行与 `/click` 相同的唯一性和可操作性检查，再使用中心坐标模拟鼠标按下/释放。
```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/clickAt?target=ID" -d 'button.upload'
```

代理在滚动后再次核对 DOM 对象身份、中心坐标与遮挡，再捕获实际 `mousedown`、`mouseup`、`click` 目标。成功响应返回坐标、`dispatch_target_verified:true|false`、`status:"dispatched"` 与 `outcome_verified:false`；只有捕获到三个事件都落在预期目标时该验证字段才为 true。首次操作性检查失败返回 HTTP 400；首次检查后发生位移、换元素或遮挡时返回 HTTP 409 `ELEMENT_CHANGED` / `ELEMENT_OCCLUDED`。若最终复检后才出现覆盖层，捕获守卫阻止错误目标的默认点击并返回 `status:"blocked"`、`clicked:false`、`dispatch_target_verified:false`。页面脚本自身主动执行的副作用仍不属于浏览器默认点击保证。

### POST /fill?target=ID

清空并填写唯一匹配的文本控件。POST body 为 JSON：

```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/fill?target=ID" \
  -H 'Content-Type: application/json' \
  -d '{"selector":"input[name=q]","text":"time series agents"}'
```

代理使用适用控件的原生 value setter，派发 `input` 和 `change` 事件，再读取即时值。成功返回 `status:"dispatched"`、`immediate_value_verified:true|false` 和 `outcome_verified:false`。即时值相等不证明网站已提交、保存或接受。

### POST /insertText?target=ID

确认唯一目标是可编辑的文本 input、textarea 或 contenteditable，然后在一次页面执行中同步完成精确目标编辑：

```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/insertText?target=ID" \
  -H 'Content-Type: application/json' \
  -d '{"selector":"[contenteditable=true]","text":"query"}'
```

代理在同一个 `Runtime.evaluate` 中重新核对唯一目标、聚焦、向该目标派发可取消的 `beforeinput`、再次检查目标与焦点，只编辑该对象，再派发 `input`。成功返回 `focus_verified:true`、`insert_target_verified:true`、`immediate_text_verified:true|false`、`insertion_method:"exact_target_dom_edit"`、`keyboard_semantics:false`、`status:"dispatched"` 与 `outcome_verified:false`。页面同步移动焦点时返回 HTTP 409 `FOCUS_LOST`，取消 `beforeinput` 时返回 HTTP 409 `INPUT_CANCELED`，两者都不执行工具的文本编辑。微任务只能在本次同步编辑完成后运行，因此不会让工具把文本写进 sibling 或 iframe。此端点不生成真实键盘事件；需要 Enter、Backspace 等默认键盘行为时使用 `/press`。这些即时字段均不证明网站业务结果。

### POST /press?target=ID

向当前页面派发一个受限按键名或一个 Unicode 字符。POST body 为 JSON：

```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/press?target=ID" \
  -H 'Content-Type: application/json' \
  -d '{"key":"Enter"}'
```

支持单个 Unicode 字符，或这些具名键：`Enter`、`Tab`、`Escape`、`Backspace`、`Delete`、`Insert`、`Home`、`End`、`PageUp`、`PageDown`、`ArrowUp`、`ArrowDown`、`ArrowLeft`、`ArrowRight`。组合键字符串和其他名称返回 `INVALID_ARGUMENT`。成功仍为动作派发证据，不等于表单提交成功。

### POST /handleJsDialog?target=ID

接受或拒绝当前页面的 JavaScript alert、confirm 或 prompt：

```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/handleJsDialog?target=ID" \
  -H 'Content-Type: application/json' \
  -d '{"accept":true,"prompt_text":"optional text"}'
```

成功还返回 `accepted` 与 `prompt_text_supplied`，并带 `status:"dispatched"`、`outcome_verified:false`。此端点不能处理 Chrome 原生许可提示、自动化横幅、文件选择器或操作系统对话框。

`/fill` 与 `/insertText` 的 selector 必须是至多 2000 字符的非空字符串，text 最多 100000 字符；`prompt_text` 同样最多 100000 字符。上述 JSON 动作端点拒绝未声明字段并返回 `INVALID_ARGUMENT`，避免拼写错误被静默忽略。所有 POST 请求体全局最多 1 MiB；超过时返回 HTTP 413 `PAYLOAD_TOO_LARGE`、`max_bytes:1048576` 与 `Connection: close`，不解析或执行该请求。客户端收到 JSON 错误后为后续请求建立新连接即可，代理进程不会停止。

### POST /setFiles?target=ID
给唯一匹配的 file input 设置本地文件路径（`DOM.setFileInputFiles`），无需系统文件对话框。支持隐藏 file input。POST body 为 JSON；files 必须是非空路径字符串数组。选择器无匹配、多个匹配或不是 file input 均返回错误。
```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/setFiles?target=ID" \
  -d '{"selector":"input[type=file]","files":["/path/to/file.pdf"]}'
```

元素操作端点保留既有兼容字段，并增加 `selector`、`match_count` 等诊断信息。无匹配返回 `ELEMENT_NOT_FOUND`，多个匹配返回 `SELECTOR_AMBIGUOUS`，均为 HTTP 400；不可见、禁用、inert、禁止 pointer 或被遮挡时不派发动作。错误示例：

```json
{"error":"选择器匹配多个元素: .cite","code":"SELECTOR_AMBIGUOUS","selector":".cite","match_count":2,"candidates":[{"tag":"BUTTON","id":"cite-a","text":"Cite"},{"tag":"BUTTON","id":"cite-b","text":"Cite"}]}
```

`candidates` 最多提供前 5 个元素的 tag、id、前 100 字符文本，供当前页面内消歧；应根据已确认的论文卡片重新构造唯一选择器。不要自动回退到第一个元素。`setFiles` 在实际 CDP 选择时再次检查数量；若 DOM 已改变则返回 `SELECTOR_CHANGED`。

### GET /scroll?target=ID&y=3000&direction=down
滚动页面。`direction` 可选 `down`（默认）、`up`、`top`、`bottom`。滚动后自动等待 800ms 供懒加载触发。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/scroll?target=ID&y=3000"
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/scroll?target=ID&direction=bottom"
```

### GET /screenshot?target=ID&file=/tmp/shot.png
截图。指定 `file` 参数保存到本地文件；不指定则返回图片二进制。可选 `format=jpeg`。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3457}/screenshot?target=ID&file=/tmp/shot.png"
```

---

## /eval 使用要点

- POST body 为任意 JS 表达式，返回 `{ value }` 或 `{ error, code }`；此端点保留原有行为，可能修改页面，条件观察优先用 `/wait`。
- 支持 `awaitPromise`：可以写 async 表达式
- 返回值必须可序列化（字符串、数字、对象），DOM 节点不能直接返回，需提取属性
- 提取大量数据时用 `JSON.stringify()` 包裹
- Shadow DOM / iframe 边界：eval 可递归穿透，见下方示例

### 常用 eval 模式

```javascript
// 提取页面所有文本
document.body.innerText

// 提取指定元素的属性
document.querySelector('meta[name=citation_doi]')?.content

// 批量提取结构化数据
JSON.stringify(Array.from(document.querySelectorAll('.result-item')).map(el => ({
  title: el.querySelector('h3')?.textContent?.trim(),
  link: el.querySelector('a')?.href
})))

// 穿透 iframe
JSON.stringify(Array.from(document.querySelectorAll('iframe')).map(f => {
  try { return f.contentDocument?.body?.innerText?.slice(0, 200) } catch { return null }
}))

// 检查页面是否加载完成
document.readyState
```

---

## 错误处理

错误响应保留可读的 `error`，增加机器可读的 `code`。CDP 原始数值错误码另存为 `cdp_code`，原始附加信息为 `data`（如有）。常见代码：`METHOD_NOT_ALLOWED`、`MISSING_PARAMETER`、`INVALID_ARGUMENT`、`PAYLOAD_TOO_LARGE`、`INVALID_SELECTOR`、`SELECTOR_SCAN_LIMIT`、`ELEMENT_NOT_FOUND`、`SELECTOR_AMBIGUOUS`、`ELEMENT_DETACHED`、`ELEMENT_CHANGED`、`ELEMENT_DISABLED`、`ELEMENT_INERT`、`ELEMENT_NOT_VISIBLE`、`ELEMENT_READONLY`、`POINTER_EVENTS_DISABLED`、`ELEMENT_OCCLUDED`、`FOCUS_FAILED`、`FOCUS_LOST`、`INPUT_CANCELED`、`INVALID_ELEMENT`、`SELECTOR_CHANGED`、`WAIT_TIMEOUT`、`TARGET_NOT_FOUND`、`NAVIGATION_FAILED`、`EVALUATION_FAILED`、`CDP_ERROR`、`CDP_TIMEOUT`、`CDP_DISCONNECTED`。

| 错误信息 | 原因 | 解决方法 |
|---------|------|---------|
| 浏览器准备失败 | 未找到可执行文件、专用 profile 不可用或启动超时 | 核对 Chrome 路径、专用 profile 和超时诊断；不要改连日常 Chrome |
| 显式 endpoint 不可达 | 指定浏览器未运行或地址不正确 | 启动/核对该独立浏览器；本代理不会启动它或回退至其他实例 |
| `attach 失败` | targetId 无效或 tab 已关闭 | 用 `/targets` 获取最新列表 |
| `CDP 命令超时` | 页面长时间未响应 | 重试或用 `/info` 检查 tab 状态 |
| `端口已被占用` | 指定代理端口已有服务 | 核对记录的进程身份；不属于本工具时选择其他 `CDP_PROXY_PORT`，不接管或停止该服务 |
| `WebSocket 未连接` | Proxy 与所选浏览器连接断开 | 核对当前 browser 配置与错误；只对该专用 profile 或显式 endpoint 做有界重连 |

---

## 本地验证

```bash
# 无浏览器、无互联网：真实 HTTP router + 内存 CDP/DOM fixture
node --test scripts/browser*.test.mjs
# 使用 Chrome，仅创建本地测试页，自动清理任务自建 target
bash scripts/self-test.sh
bash scripts/release-test.sh
```

浏览器 smoke 默认以 `CDP_PROXY_PORT=0` 启动独立代理，由系统分配端口；从启动日志提取实际端口，再核对 `/health.pid` 和 `instance_id`。显式指定已占用端口时应失败，不能让旧进程替新代码通过测试。

## 任务结束规范

完成 CDP 操作后：
1. 用 `/close` 关闭自己创建的所有 tab
2. 不关闭用户原有 tab
3. 不主动停止 Proxy（持续运行供复用）
