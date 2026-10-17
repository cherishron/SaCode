# 附件草稿与原图预览首轮复刻（2026-10-04）

对照上游 `deepseek-ai/deepseek-harness` 冻结提交 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 `ComposerAttachments`、`AttachmentRail`、`FileCard`、`DropOverlay`、`drop-events` 和 `ui-primitives/ImageLightbox`。实现使用 Vue 3 的 TypeScript `h()`，构建期并入经典脚本，运行时复用唯一 Vue runtime。

## 已实现

- 受控草稿图片缩略图、移除动作、文件上传中/完成/失败与重试动作，进度限制在 0–100%。
- 横向附件列表、边缘翻页、垂直滚轮转横向浏览；已有草稿首次挂载保持起点，新增附件显示末尾。
- 文档级拖放覆盖层、嵌套拖入深度、禁止接收状态、目录入口元信息识别与监听清理。
- 独立附件选择控件，多文件选择后重置输入，支持再次选择相同文件。
- 原图模态覆盖视口，遮罩/关闭按钮/Escape 关闭，Tab 留在关闭控件，关闭时恢复仍存在的入口焦点。使用原生 dialog 顶层承载，避免父级变换截断。
- 真实会话页增加附件入口和阻止拖放的状态。上传服务未接入时入口禁用，不生成伪造上传成功记录。

CSP 只新增 `img-src 'self' blob:` 用于浏览器拥有的本地预览，`script-src 'self'` 保持原约束。URL 的创建、回收和上传真源由草稿所有者负责，展示组件不持有后端业务状态。

## 验证

- 七个页面模块的 `node scripts/pack-pages.mjs` 构建及静态运行时约束通过。
- `composer-attachments.ts`、`image-lightbox.ts` 严格 TypeScript 检查通过（ES2022、DOM、DOM.Iterable、ESNext/bundler）。检查发现可选预览 URL 类型不满足原图组件要求，已增加非空条件并复验。
- 最新隔离 Electron 冒烟：`D:\Temp\SaCode-ui-scroll-20261004\attachment-captures-verified\reports.json`，184 组、531 条检查，失败 0，实际进程退出码 0。
- 已查看 `composer-attachments-fixture.png` 与 `composer-image-lightbox.png`。测试图片是 32×24 像素的本地 Blob，原图保持自然尺寸。
- 目录识别用模拟 DataTransfer 入口元信息检查；不是操作系统原生目录拖放验收。文件选择使用浏览器 FileList 注入，不是手工文件选择器验收。

此前未修正目录模拟的运行有一项失败；直接调用 GUI 可执行文件的运行触发 EPIPE 且无最终报告，均不计为通过。最新运行使用持有进程句柄与独立文件重定向，已核真实退出码。

## 尚未完成

本批为受控前端视图，不证明真实上传、仓颉附件存储、会话历史图片、粘贴图片、模型多模态输入或附件发送已接入。隔离实例使用此前已构建 Host，不包含尚未完成的模型设置后端原型。安装包未重新生成。

全量页面复刻、仓颉后端补齐与双入口接入、真实模型自动化测试、最终安装即用交付仍为原定完整目标。
