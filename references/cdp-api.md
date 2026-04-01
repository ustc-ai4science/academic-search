# CDP Proxy API 参考

## 基础信息

- 地址：`http://127.0.0.1:${CDP_PROXY_PORT:-3456}`
- 启动：`CDP_PROXY_PORT=3456 node ~/.claude/skills/academic-search/scripts/cdp-proxy.mjs &`
- 启动后持续运行，不建议主动停止（重启需 Chrome 重新授权）
- 强制停止：`pkill -f cdp-proxy.mjs`
- 健康检查：`curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/health"`

## API 端点

### GET /health
健康检查，返回连接状态与 session 数量。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/health"
```

### GET /targets
列出所有已打开的页面 tab。返回数组，每项含 `targetId`、`title`、`url`。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/targets"
```

### GET /new?url=URL
创建新后台 tab，自动等待页面加载完成。返回 `{ targetId }`。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/new?url=https://example.com"
```

### GET /close?target=ID
关闭指定 tab。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/close?target=TARGET_ID"
```

### GET /navigate?target=ID&url=URL
在已有 tab 中导航到新 URL，自动等待加载完成。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/navigate?target=ID&url=https://example.com"
```

### GET /back?target=ID
后退一页，等待加载完成。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/back?target=ID"
```

### GET /info?target=ID
获取页面基础信息（title、url、readyState）。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/info?target=ID"
```

### POST /eval?target=ID
执行 JavaScript 表达式，POST body 为 JS 代码。
```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/eval?target=ID" -d 'document.title'
```

### POST /click?target=ID
JS 层面点击（`el.click()`），POST body 为 CSS 选择器。自动 scrollIntoView 后点击。简单快速，覆盖大多数场景。
```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/click?target=ID" -d 'button.submit'
```

### POST /clickAt?target=ID
CDP 浏览器级真实鼠标点击（`Input.dispatchMouseEvent`），POST body 为 CSS 选择器。先获取元素坐标，再模拟鼠标按下/释放。算真实用户手势，能触发文件对话框、绕过部分反自动化检测。
```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/clickAt?target=ID" -d 'button.upload'
```

### POST /setFiles?target=ID
给 file input 设置本地文件路径（`DOM.setFileInputFiles`），完全绕过文件对话框。POST body 为 JSON。
```bash
curl -s -X POST "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/setFiles?target=ID" \
  -d '{"selector":"input[type=file]","files":["/path/to/file.pdf"]}'
```

### GET /scroll?target=ID&y=3000&direction=down
滚动页面。`direction` 可选 `down`（默认）、`up`、`top`、`bottom`。滚动后自动等待 800ms 供懒加载触发。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/scroll?target=ID&y=3000"
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/scroll?target=ID&direction=bottom"
```

### GET /screenshot?target=ID&file=/tmp/shot.png
截图。指定 `file` 参数保存到本地文件；不指定则返回图片二进制。可选 `format=jpeg`。
```bash
curl -s "http://127.0.0.1:${CDP_PROXY_PORT:-3456}/screenshot?target=ID&file=/tmp/shot.png"
```

---

## /eval 使用要点

- POST body 为任意 JS 表达式，返回 `{ value }` 或 `{ error }`
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

| 错误信息 | 原因 | 解决方法 |
|---------|------|---------|
| `Chrome 未开启远程调试端口` | Chrome 未开启远程调试 | 打开 `chrome://inspect/#remote-debugging`，勾选 Allow remote debugging |
| `attach 失败` | targetId 无效或 tab 已关闭 | 用 `/targets` 获取最新列表 |
| `CDP 命令超时` | 页面长时间未响应 | 重试或用 `/info` 检查 tab 状态 |
| `端口已被占用` | 另一个 proxy 实例在运行 | 已有实例可直接复用，用 `/health` 确认 |
| `WebSocket 未连接` | Proxy 启动后 Chrome 断连 | 重新运行 `check-deps.sh` 重连 |

---

## 任务结束规范

完成 CDP 操作后：
1. 用 `/close` 关闭自己创建的所有 tab
2. 不关闭用户原有 tab
3. 不主动停止 Proxy（持续运行供复用）
