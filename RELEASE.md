# 市场发布清单

适用于 Microsoft Edge Add-ons 与 Chrome Web Store。

## 一、构建可上传 ZIP

在仓库根目录执行：

```powershell
python tools\package_release.py
```

生成：

```
dist/claude-archive-exporter.zip
```

上传商店时选择该 ZIP。

注意：ZIP 内扩展放在一级目录 `claude-archive-exporter/` 下。商店接受扁平结构或单根目录结构；若商店提示结构异常，重新打 ZIP 使文件直接位于根目录（去掉一级文件夹名）。

## 二、发布前核对

- [ ] `manifest.json` 中 `version` 已递增
- [ ] `manifest.json` 中 `name`、`description` 与商店中一致
- [ ] `icons/icon16.png`、`icon32.png`、`icon48.png`、`icon128.png` 存在
- [ ] `content.js`、`zip.js` 无依赖、无网络请求发往第三方
- [ ] 在 Edge / Chrome 上加载解压缩扩展手工测过
- [ ] 导出过的会话 ZIP 能正常打开 `index.html`
- [ ] `privacy.html` 已部署到可访问地址，或准备粘贴其内容到商店隐私策略栏

## 三、商店元数据建议

### 名称

`Claude 会话归档导出`（Chrome 市场名称字段为 45 字符内；如需英文版本可用 `Claude Archive Export`）

### 简介（短描述）

`把 Claude 会话一键导出为离线 ZIP：网页、附件、Artifact、原始 JSON，一次打包。`

### 完整描述

```
Claude 会话归档导出（Chrome/Edge 扩展）

在任意 claude.ai 会话页点一下，把整个会话打包成一个 ZIP 下载：

- index.html：自包含离线网页，含完整消息时间线、Markdown 渲染、思考摘要、工具调用
- conversation.json：原始会话数据
- manifest.json：归档清单：文件列表、大小、SHA-256、资产来源、缺失项
- files/attachments：你上传附件的原件或提取全文；拿不到原件时会明确标记
- files/artifacts：Artifact 源文件（HTML 等，可直接预览）
- files/artifacts/versions：Artifact 每次写入/编辑的版本快照（v1/v2/…）
- files/deliveries：Claude 发给你的文件

主要能力：
1. 消息导出：用户/Claude 全部消息，代码块、表格、列表、引用
2. 思考摘要：官方返回的过程摘要默认折叠、可展开
3. 工具调用：完整 input JSON 与 result，失败标红
4. 附件原件：优先下载附件原始文件；拿不到时保存提取全文，再拿不到则保留元信息
5. 产物还原：Artifact 按 Write/Edit 记录回放，zip 按目录重建，并标注来源
6. 版本快照：Artifact 每次写入/编辑都保留一份，可对比查看
7. 归档清单：生成 manifest.json，记录每个文件的 SHA-256、来源与缺失项
8. 检索：全文搜索、只看用户消息、仅看原件/仅看缺失、目录跳转、下载 JSON

数据与隐私：
所有解析都在本地浏览器内完成，不经过任何第三方服务器。

已知限制：
- 需要浏览器已登录 claude.ai
- 附件优先保存原件；拿不到原件时保存提取全文或元信息，并在 manifest.json 中明确标记来源
- 部分文件无法通过接口获取，扩展会按会话写入记录还原；仍取不到的会标为「未能自动获取」
- 图片只取到站内预览图并转 PNG，分辨率可能低于原图
- Artifact 在发布前被脚本二次加工时，还原结果可能与最终版有差异

支持：在 GitHub 提交 issue。
```

### 权限说明（商店中填写）

`host_permissions` 仅允许访问 `https://claude.ai/*`，用于读取会话内容并调用 claude.ai 自身接口生成归档。扩展不申请其他浏览器权限。

### 分类

- 主要：工作效率 / 开发者工具
- 次要：效率、生产力

## 四、Edge Add-ons 发布流程

1. 访问 https://developer.microsoft.com/en-us/microsoft-edge/developer/
2. 登录并创建（或选择）扩展项目
3. 上传 `dist/claude-archive-exporter.zip`
4. 填写：
   - 名称、短描述、完整描述（见上）
   - 版本：`1.3.0`
   - 分类：工作效率 / 开发者工具
   - 隐私政策 URL（`privacy.html` 的托管地址，或粘贴全文）
   - 支持 URL：`https://github.com/fietiger/claude-archive-exporter/issues`
   - 主页 URL：`https://github.com/fietiger/claude-archive-exporter`
5. 截图：上传 `icons/screenshot1.png`、`icons/screenshot2.png`（480x480 占位图，建议替换为真实界面截图）
6. 提交审核

## 五、Chrome Web Store 发布流程

1. 访问 https://chrome.google.com/webstore/developer/dashboard/
2. 首次发布需一次性开发者费用
3. 创建新扩展，上传 `dist/claude-archive-exporter.zip`
4. 填写：
   - 名称、简介、完整描述（见上）
   - 版本：`1.3.0`
   - 分类：Tools / Developer tools
   - 隐私政策：粘贴 `privacy.html` 全文或提供可访问 URL
   - 支持链接：GitHub issues
   - 主页链接：仓库地址
   - 截图：1280x800（Edge 截图为 480x480，建议为 Chrome 单独准备 1280x800 截图）
5. 提交审核

## 六、上架后维护

- 每次代码改动后递增 `manifest.json` 的 `version`
- 重新执行 `python tools/package_release.py`
- 在两个市场分别上传新 ZIP
- 市场审核期间保持 ZIP 内文件与仓库一致

