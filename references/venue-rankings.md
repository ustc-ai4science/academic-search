# Venue Rankings 速查

CS 领域会议/期刊等级参考，用于在搜索结果中标注 venue 质量。

**数据来源**：CCF（中国计算机学会）推荐列表 2022 版  
**更新时间**：2026-04  
**使用方式**：搜索结果的 venue 字段与下表匹配，标注为 `[CCF-A]`、`[CCF-B]`、`[CCF-C]`；未在列表中的标注为 `[未收录]`。

---

## 人工智能 / 机器学习

### CCF-A

| 会议/期刊 | 全称 |
|---------|------|
| NeurIPS | Conference on Neural Information Processing Systems |
| ICML | International Conference on Machine Learning |
| ICLR | International Conference on Learning Representations（CCF 未收录但业界认可度等同 A 类） |
| AAAI | AAAI Conference on Artificial Intelligence |
| IJCAI | International Joint Conference on Artificial Intelligence |
| ACM MM | ACM International Conference on Multimedia |
| AI | Artificial Intelligence（期刊） |
| TPAMI | IEEE Transactions on Pattern Analysis and Machine Intelligence（期刊） |
| JMLR | Journal of Machine Learning Research（期刊） |

### CCF-B

| 会议/期刊 | 全称 |
|---------|------|
| ECAI | European Conference on Artificial Intelligence |
| ECML-PKDD | European Conference on Machine Learning and PKDD |
| AISTATS | International Conference on Artificial Intelligence and Statistics |
| UAI | Conference on Uncertainty in Artificial Intelligence |
| TNNLS | IEEE Transactions on Neural Networks and Learning Systems（期刊） |
| Neural Networks | Neural Networks（期刊） |

---

## 计算机视觉

### CCF-A

| 会议/期刊 | 全称 |
|---------|------|
| CVPR | IEEE/CVF Conference on Computer Vision and Pattern Recognition |
| ICCV | IEEE/CVF International Conference on Computer Vision |
| ECCV | European Conference on Computer Vision |
| IJCV | International Journal of Computer Vision（期刊） |
| TIP | IEEE Transactions on Image Processing（期刊） |

---

## 自然语言处理

### CCF-A

| 会议/期刊 | 全称 |
|---------|------|
| ACL | Annual Meeting of the Association for Computational Linguistics |
| EMNLP | Conference on Empirical Methods in Natural Language Processing |
| NAACL | North American Chapter of the ACL |
| COLING | International Conference on Computational Linguistics |
| CL | Computational Linguistics（期刊） |
| TACL | Transactions of the Association for Computational Linguistics（期刊） |

### CCF-B

| 会议/期刊 | 全称 |
|---------|------|
| EACL | European Chapter of the ACL |
| CoNLL | Conference on Computational Natural Language Learning |

---

## 数据挖掘 / 数据库

### CCF-A

| 会议/期刊 | 全称 |
|---------|------|
| KDD | ACM SIGKDD Conference on Knowledge Discovery and Data Mining |
| SIGMOD | ACM International Conference on Management of Data |
| VLDB | International Conference on Very Large Data Bases |
| ICDE | IEEE International Conference on Data Engineering |
| WWW | The Web Conference（原 World Wide Web Conference） |
| TKDE | IEEE Transactions on Knowledge and Data Engineering（期刊） |
| VLDBJ | The VLDB Journal（期刊） |

### CCF-B

| 会议/期刊 | 全称 |
|---------|------|
| ICDM | IEEE International Conference on Data Mining |
| CIKM | ACM International Conference on Information and Knowledge Management |
| DASFAA | Database Systems for Advanced Applications |
| WSDM | ACM International Conference on Web Search and Data Mining |

---

## 信息检索

### CCF-A

| 会议/期刊 | 全称 |
|---------|------|
| SIGIR | ACM SIGIR Conference on Research and Development in Information Retrieval |
| TOIS | ACM Transactions on Information Systems（期刊） |

### CCF-B

| 会议/期刊 | 全称 |
|---------|------|
| ECIR | European Conference on Information Retrieval |
| RecSys | ACM Conference on Recommender Systems |

---

## 系统 / 网络

### CCF-A

| 会议/期刊 | 全称 |
|---------|------|
| OSDI | USENIX Symposium on Operating Systems Design and Implementation |
| SOSP | ACM Symposium on Operating Systems Principles |
| NSDI | USENIX Symposium on Networked Systems Design and Implementation |
| SIGCOMM | ACM Special Interest Group on Data Communication |
| SC | International Conference for High Performance Computing, Networking, Storage, and Analysis |
| TOCS | ACM Transactions on Computer Systems（期刊） |

---

## 软件工程

### CCF-A

| 会议/期刊 | 全称 |
|---------|------|
| ICSE | International Conference on Software Engineering |
| FSE / ESEC | ACM Joint European Software Engineering Conference and FSE |
| ASE | IEEE/ACM International Conference on Automated Software Engineering |
| TSE | IEEE Transactions on Software Engineering（期刊） |
| TOSEM | ACM Transactions on Software Engineering and Methodology（期刊） |

---

## 匹配说明

Semantic Scholar 返回的 `venue` 字段为缩写或全称，匹配时做模糊处理：

- `NeurIPS` / `Advances in Neural Information Processing Systems` → CCF-A
- `arXiv preprint` → 未经同行评审，标注为 `[预印本]`，不标 CCF 等级
- 未匹配到任何条目 → 标注为 `[未收录]`

**注意**：ICLR 未被 CCF 收录，但在 ML 领域业界认可度普遍等同 A 类，建议标注为 `[ICLR★]` 以示区分。
