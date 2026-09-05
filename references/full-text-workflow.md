# 全文发现、验证与下载

当任务要求 PDF、全文、OA 判定或下载 manifest 时读取。输出字段及枚举以 [metadata-schema](metadata-schema.md) 为准，API 参数见 [API cookbook](api-cookbook.md)。

## 四层证据

| 层次 | 能支持的结论 | 不能推导的结论 |
|---|---|---|
| 候选 URL | 索引、页面或 arXiv ID 提供了可尝试地址 | 本次可访问、已下载、内容正确 |
| OA 声明 | 仓储、出版商或 OA 索引报告开放版本/许可 | 该 URL 当前可用，或下载文件对应目标论文 |
| 响应与文件 | 实际 HTTP 状态、最终 URL、内容类型、PDF 字节及可选解析结果 | 仅凭 MIME 或 PDF 格式便认定论文身份 |
| 论文身份 | 从正文/首页等核对标题、作者、DOI/arXiv ID 与目标一致 | 下载器已自动完成这种核对 |

只有 arXiv ID 时可构造 `https://arxiv.org/pdf/{id}` 作为候选，但 `full_text_status=unknown`、`pdf_verification_status=unverified`，不能在表格中标“已验证 ✓”。可信仓储页/API、出版商或 OA API 明确提供开放 PDF 入口时，可记录 `full_text_status=open_pdf` 并在 `field_sources` 标明来源，进入下载资格判断；尚未检查字节的验证状态仍为 `unverified`。访问暂时受阻不自动否定来源已有的 OA 声明。

## 发现与停止条件

1. 确认目标论文标识。已知 DOI/arXiv/PMID 优先精确查询，并保留预印本版本与正式发表版本差别。
2. 按现有线索寻找候选：原始论文页/仓储（arXiv、PMC 等）、S2 `openAccessPdf`、OpenAlex OA location、Unpaywall，以及相关领域仓储或作者自存档页。空 `openAccessPdf` 不代表无全文；使用需鉴权或有效邮箱的服务时遵从当前 API 要求，不提交占位凭据。
3. 对满足用户范围的候选核验实际响应；受阻或非 PDF 时按证据分类，再尝试其他合法来源。找到足以完成任务的全文即可停止，不必重复查询所有 OA 索引；用户要求全面 OA 审计时才逐一记录指定来源。
4. 所查来源均未发现时写“本次在 X、Y 来源未发现开放版本”，列明时间及访问限制。某索引的 `is_oa=false` 或空结果不能证明任何地方都不存在公开版本。

不调用 Sci-Hub、LibGen、shadow library，或绕过付费墙、验证码和机构访问控制的工具。需要机构权限时记录 `needs_institution`，可说明图书馆、作者公开存档或馆际互借路径；不自动发送索取邮件。

## 响应分类

- **登录要求：** 仅出现登录页时记录 `login_required`；只有明确机构订阅/权限提示才记录 `needs_institution`。保留原有 OA 声明，不推断论文无开放版本。
- **HTML 响应：** 记录本次候选返回 HTML；检查它是正文、登录、挑战、错误页还是普通落地页。确认正文可读时交付 HTML 链接及证据范围；任何一种 HTML 响应都不能证明“没有独立 PDF”。有明确阻拦原因时优先保留该原因。
- **HTTP 403 / 挑战：** 记录受阻并切换合法来源，不通过反复点击或换工具规避访问控制。
- **HTTP 429：** 遵守有效 `Retry-After`；没有提示时有界退避。同一请求默认最多 2 次重试、总等待预算 30 秒；服务要求的等待超过预算时停止当前来源，而非提前重试。下载器自身的请求超时与重试能力以 CLI 实现为准，不能假定它自动覆盖全部恢复步骤。
- **PDF 响应：** Content-Type、扩展名或 URL 都不足以验收。检查实际字节；需要更强格式保证且解析器可用时做解析检查，并如实记录是否运行。格式合格仍需单独核对论文身份；下载器不提供论文身份保证。

## 已授权下载与 manifest

用户只要元数据/清单时不额外下载；已经要求“下载这些论文”或“下载所有开放 PDF”时，在既有范围内生成 manifest 并继续下载，不再询问。只将有开放 PDF 来源依据及候选 URL 的记录提交为 eligible；未知、权限受限或受阻项保留在清单并注明原因。

脚本路径相对本 Skill 根目录；将其真实绝对路径设为 `ACADEMIC_SEARCH_ROOT`。输入、manifest 和输出目录使用本任务约定的路径：

```bash
node "$ACADEMIC_SEARCH_ROOT/scripts/oa-pdf-download.mjs" \
  --input "$PAPERS_JSON" --manifest "$MANIFEST_JSON"

node "$ACADEMIC_SEARCH_ROOT/scripts/oa-pdf-download.mjs" \
  --input "$PAPERS_JSON" --manifest "$MANIFEST_JSON" \
  --download --out-dir "$PDF_OUTPUT_DIR"
```

交付时读取实际 manifest 与生成文件，报告下载/跳过/失败数量、对应论文、本地路径和原因。`download_status`、`pdf_verification_status` 与论文身份核验结果分别表达；成功的文件转移不等于已经阅读全文。解析器缺失时明确保留解析未检查。下载器输出的 `paper_identity_status` 为 `unverified`；如任务需要身份核对，应另行核对并说明证据，不能声称脚本已经保证论文匹配。
