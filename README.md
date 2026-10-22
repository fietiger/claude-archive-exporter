# Claude 会话归档导出

一个 Edge / Chrome 扩展（Manifest V3）。在任意 claude.ai 会话页点一下，把整个会话打包成一个 ZIP 下载：

```
会话名_日期.zip
├── index.html            自包含网页（离线可看）
├── conversation.json     原始会话数据
├── manifest.json         归档清单：文件列表、大小、SHA-256、资产来源、缺失项
└── files/
    ├── attachments/      你上传附件的原件或提取全文
    ├── artifacts/        Artifact 源文件（HTML 等，可预览）
    │   └── versions/     Artifact 每次写入/编辑的版本快照（v1/v2/…）
    └── deliveries/       Claude 发给你的文件
```

## 功能

- **完整消息时间线**：用户与 Claude 全部消息，Markdown 渲染（代码块、表格、列表、引用）
- **思考摘要**：保留官方返回的过程摘要，默认折叠
- **工具调用**：完整 input JSON 与对应 result，失败标红
- **附件原件**：优先保存附件原件；拿不到原件时保存提取全文，再拿不到则保留附件元信息
- **产物还原**：Artifact 按 Write/Edit 记录回放还原；zip 按目录重建，并标注来源与写入/编辑次数
- **Artifact 版本快照**：同一文件多次写入/编辑时，额外输出 `artifacts/versions/*.vN.*`
- **归档清单**：生成 `manifest.json`，记录文件列表、大小、SHA-256、资产来源和缺失项
- **网页内检索**：全文搜索、只看用户消息、仅看原件/仅看缺失、按类型折叠、目录跳转、下载 JSON

## 安装

1. 下载或克隆本仓库
2. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
3. 开启「开发人员模式」→「加载解压缩的扩展」→ 选择本目录
4. 打开任意 `https://claude.ai/chat/...` 页面，右下角出现「导出归档 ZIP」

## 市场发布

- 发布清单：[RELEASE.md](RELEASE.md)
- 隐私策略：[privacy.html](privacy.html)
- 构建可上传 ZIP：`python tools\package_release.py`，输出 `dist/claude-archive-exporter.zip`

## 文件说明

| 文件 | 作用 |
|---|---|
| `manifest.json` | MV3 清单，注入 `claude.ai/chat/*` |
| `content.js` | 主逻辑：读取会话、还原文件、生成网页与 ZIP |
| `zip.js` | 无依赖的 ZIP 打包实现（store 模式） |
| `privacy.html` | 市场隐私策略页 |
| `RELEASE.md` | Edge / Chrome 市场发布清单 |
| `tools/make_assets.py` | 生成图标与截图占位图 |
| `tools/package_release.py` | 打包商店上传 ZIP |

## 已知限制

- 站内没有通用文件下载接口：文本文件靠会话里的 Write/Edit 记录还原；脚本生成或原样转发的文件可能拿不到，会在页面上标为「未能自动获取」
- 附件目前保存的是“提取后的全文”或元信息，不是所有附件的原始二进制文件；`manifest.json` 会明确标记 `extracted-text`、`metadata-only`、`replayed`、`rebuilt`、`downloaded`
- 图片只能取到站内预览图（转成 PNG），分辨率可能低于原图
- Artifact 若在发布前被脚本二次加工，还原结果可能与最终版有差异
- 需要浏览器已登录 claude.ai

## 数据与隐私

所有解析都在本地浏览器内完成，不经过任何第三方服务器。
