# 学术记录校验与保守去重

`scripts/academic-records.mjs` 是一个只使用 Node.js 标准库的 JSON CLI。它接受顶层数组或 `{ "results": [...] }`，输出完整 JSON 文件，并在 stdout 打印一行 JSON summary。数组位置和所有 `index` / `source_indices` 均从 0 开始。

## 校验

```bash
node scripts/academic-records.mjs validate \
  --input records.json \
  --output validation.json
```

输出文件结构：

```json
{
  "valid": false,
  "records": [
    {
      "index": 0,
      "valid": false,
      "errors": [{"code": "invalid_doi", "field": "doi", "message": "..."}],
      "warnings": [{"code": "missing_field_provenance", "field": "abstract", "message": "..."}]
    }
  ],
  "summary": {
    "total_records": 1,
    "valid_records": 0,
    "invalid_records": 1,
    "errors": 1,
    "warnings": 1
  }
}
```

校验范围：

- 必须保留 `title`、`authors`、`year`、`source_platforms`、`fetched_at` 五个键。未知的 `title` / `year` 可为 `null`；`authors` 可为 `null` 或字符串数组；`source_platforms` 始终是字符串数组。`fetched_at` 必须是非空且真实存在的 `YYYY-MM-DD` 日期，不能为 `null`。
- `year` 若有值必须是四位整数。日期、时间、非负整数、字符串和字符串数组按元数据 schema 做基础类型检查。
- DOI 接受裸 DOI、`doi:` 前缀和 `doi.org` / `dx.doi.org` URL。arXiv 接受新式、旧式学科 ID、`arXiv:` 前缀和版本号不小于 1 的后缀；URL 只接受 `arxiv.org/abs/ID` 或 `arxiv.org/pdf/ID[.pdf]`，序号全零、`v0` 及其他路径无效。PMID 接受正整数、`PMID:` 前缀和 PubMed URL；`0` 或全零值无效。
- `citation_counts[]` 的每项必须有非空 `platform`、非负整数 `count`、ISO 时间戳 `checked_at` 和 HTTP(S) `source_url`。
- `field_sources.<field>[]` 的每项必须有非空 `platform`、HTTP(S) `source_url`、ISO 时间戳 `checked_at` 和受支持的 `evidence_type`：`source_metadata`、`page_text`、`pdf_text`、`download_response` 或 `inference`。可选 `note` 必须是字符串；`inference` 必须用非空 `note` 说明推断依据。
- 结构或格式问题是 error。已填 `citation_count` 无对应 citation source，或摘要、OA / 全文判断、PDF URL、研究设计等证据敏感字段无有效 `field_sources` 时只产生 warning；工具不会补造来源。

稳定 error code：`invalid_record`、`missing_required_key`、`invalid_type`、`invalid_year`、`invalid_date`、`invalid_timestamp`、`invalid_doi`、`invalid_arxiv_id`、`invalid_pubmed_id`、`invalid_citation_source`、`invalid_field_sources`、`invalid_field_source`。

稳定 warning code：`missing_citation_provenance`、`citation_count_not_in_sources`、`missing_field_provenance`。

## 保守去重

建议先运行 `validate`，再对可接受的记录运行：

```bash
node scripts/academic-records.mjs dedupe \
  --input records.json \
  --output deduplicated.json
```

输出文件结构：

```json
{
  "results": [{"title": "...", "source_indices": [0, 2]}],
  "groups": [
    {
      "result_index": 0,
      "source_indices": [0, 2],
      "matched_by": [
        {"identifier": "doi", "value": "10.1000/example", "source_indices": [0, 2]}
      ],
      "arxiv_versions": []
    }
  ],
  "possible_duplicates": [],
  "conflicts": [],
  "summary": {
    "input_records": 2,
    "output_records": 1,
    "duplicate_groups": 1,
    "merged_records": 1,
    "possible_duplicates": 0,
    "conflicts": 0
  }
}
```

`possible_duplicates` 的 item 固定为：

```json
{
  "reason": "normalized_title",
  "normalized_title": "the same title",
  "result_indices": [0, 1],
  "source_indices": [[0, 2], [1]],
  "titles": ["The Same: Title!", "the same title"]
}
```

`conflicts` 的 item 固定为：

```json
{
  "result_index": 0,
  "field": "year",
  "kept_value": 2023,
  "values": [
    {"value": 2023, "source_indices": [0]},
    {"value": 2024, "source_indices": [2]}
  ],
  "source_indices": [0, 2]
}
```

自动归组只使用三类精确键：规范化 DOI、去掉版本后缀的 base arXiv ID、规范化 PMID。任一精确键形成的边都参与连通分组，因此 DOI、arXiv 与 PMID 可以传递连接同一组。格式无效或缺失的标识符不参与匹配。

合并保持输入顺序稳定：

- 标量使用组内最早的非空值，后续不同值不覆盖；`conflicts` 按 `result_index` 和字段保存采用值、所有不同值及对应源索引。
- 数组按首次出现顺序去重并集；`citation_counts` 和每个 `field_sources` 证据数组同样保留并集。
- 后续来源补齐字段后，从 `missing_fields` 删除该字段；其余缺失原因保留最早记录。
- 每条结果增加 `source_indices`。出现带版本的 arXiv ID 时，结果与 group 的 `arxiv_versions` 保存原始 ID、版本标签和源索引；原始标识符字段本身不被重写。
- `groups` 只列真正合并的连通组，并在 `matched_by` 中公开触发归组的规范化精确键。

工具不会仅凭标题自动合并。它会检查每个精确 ID 连通组内所有原始标题，而不只检查合并结果采用的标题。NFKC、大小写、标点和空白规范化后完全相同，但没有共享精确标识符的结果，以两两候选形式进入 `possible_duplicates`。`titles` 为每个 result 保存该规范化标题最先出现的一个代表性原始标题；对应的内层 `source_indices` 收集该 result 内所有规范化到 `normalized_title` 的源位置，因此标题和源索引不是按每条来源一一对应。这只是待核对线索，不是论文身份结论，也不是模糊标题相似度判断。

完整且自洽的 `dedupe` 输出可直接作为下一次 `dedupe` 的 `{results}` 输入；CLI 会原样保留整个输出，包括 `results` 中的 `source_indices` / `arxiv_versions`，以及顶层 `groups`、`possible_duplicates`、`conflicts` 和 `summary`。自洽检查包括源索引完整分区、合并结果与 group 一一对应、group 匹配依据连通、候选和冲突只引用对应 result 的有效源索引。每个 `matched_by` 规范化值还必须能在 result 采用的标识符或相应 identifier conflict 中找到；conflict 已公开来源时，匹配来源必须精确一致。result 或 identifier conflict 中仍可观察的带版本 arXiv 原值必须由 `arxiv_versions` 覆盖。该路径保证重复运行结构幂等。若输入含这些去重 provenance，却缺少完整且自洽的输出 envelope，CLI 以 `INVALID_INPUT` 拒绝处理，避免把已有源索引静默重编号或丢失。

## 退出码与写入保证

| 退出码 | 含义 | 输出文件 |
|---|---|---|
| `0` | `validate` 无 error，或 `dedupe` 完成 | 已原子写入 |
| `1` | `validate` 完成且发现一个或多个 error | 报告已原子写入 |
| `2` | 参数、读入、JSON、输入容器、写出或内部错误 | 不把部分结果写到目标路径 |

退出码 0 或 1 时，stdout 是与输出文件中 `summary` 完全相同的一行 JSON。退出码 2 时，stderr 是 `{"error":{"code":"...","message":"..."}}`；CLI 级 code 包括 `INVALID_ARGUMENT`、`INVALID_INPUT`、`INPUT_READ_ERROR`、`INVALID_JSON`、`OUTPUT_WRITE_ERROR` 和兜底的 `INTERNAL_ERROR`。参数、读入、输入容器或 JSON 失败发生在写入前；原子写入失败也不会破坏已有目标文件，同目录临时文件在失败时清理。

`dedupe` 不替代元数据校验，也不证明两个来源描述的是同一论文。冲突需要结合 `field_sources`、正文、作者、年份或权威来源人工裁决。
