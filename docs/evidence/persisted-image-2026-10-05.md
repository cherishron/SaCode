# 持久图片读取与原图预览验收（2026-10-05）

## 产品行为

仓颉共享核心新增 `sessionImageJson`，只从当前会话历史消息及当前 next-turn/next-step 队列收集图片引用。上传但未绑定的对象、已删除队列引用、通用文件引用均不开放图片读取；每次读取经 AttachmentStore 复核内容摘要及引用字节数。仅接受既有 PNG/JPEG/GIF 范围，单图上限 20 MiB。

宿主 `attachment/image-read` 必须匹配当前活动会话身份，读取路径及 MIME 不能由界面指定。Electron 使用固定 `attachmentImageRead(sessionId, attachmentId)` IPC；主进程拒绝额外字段、空会话和非法摘要引用。图片字节通过这条独立读接口返回，不写入消息或队列元数据投影。

队列和历史消息接真实图片读取，成功解码后显示缩略图，点击打开既有原图模态并在关闭后恢复焦点；失败显示中文重试入口。Blob URL 按视图租约释放；异步请求或 DOM 解码事件迟到时不能覆盖新会话或已卸载视图。缓存按会话和引用区分，在各构建 bundle 内合并读取，不宣称跨 bundle 单例缓存。

## 验证及范围

- 实际仓颉宿主隔离构建通过。图片读取测试覆盖未绑定拒绝、队列读取及删除、会话切换双向拒绝、历史持久重启、文件拒绝、对象篡改拒绝；与历史/队列回归、IPC 校验及页面资源生命周期合计 **11/11**。
- 隔离核心全套 **497 条、496 通过、1 凭据门控跳过、0 错误/失败**。快照包含当时工作树内并行的提示增强及目标驱动改动；计数是该快照验证，不冒称仅本提交的纯净源码测试。
- TypeScript strict 检查通过，十个页面构建及单 Vue/CSP 静态检查通过。
- 真实 Electron 独立图片切片使用真实 preload、仓颉宿主及 `script-src 'self'` 页面；完整 2×1 PNG 成功解码，原图、关闭焦点、会话切换与卸载检查通过，实际 rc=0。
- 同一隔离核心/宿主与桌面快照整页最终 **254 组 / 736 条 / 0 失败、实际 rc=0**，含产品队列及历史缩略图/原图。SSE 使用本地契约夹具，不记为新的真实提供商往返。
- 首轮整页错误使用 `querySelector('dialog')`，实际取到设置等关闭对话框；诊断确认图片模态已打开且原图宽度为 2，改为具体图片对话框选择器。另一轮历史探针将两句 JS 放入单表达式包装而语法错误，已改成 IIFE；隔离目录层级及 SSE_OPENSSL 配置遗漏也分别修正。未放宽断言或等待时限，失败日志保留。

## 交付边界

此批闭合 PNG/JPEG/GIF 的持久图片读取与预览切片；完整附件规范化、WebP、文件下载及历史翻页仍待实现。未重建 Setup/portable 或 npm CLI，未运行安装器、未签名、未发布 npm。上一版发布目录不含此批改动，不能以开发态回归替代新安装包验收。

原始证据位于 `D:/Temp/SaCode-persisted-image-20261005`：`host-build.log`、`core-test.log`、`focused-tests-final.log`、`image-smoke.stdout.log`/`stderr.log`、`frame-verified.stdout.log`/`stderr.log`。早期 `frame-*` 保留失败与诊断过程；最终整页用 `apps/desktop` 隔离副本和 `frame-session-verified` 新会话目录。
