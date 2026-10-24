# 移动端 M03：Markdown 流式渲染与主题/安全边界验证（2026-10-23）

取证日：2026-10-23。类别：⑦历史证据（冻结区，只增不改）。本记录登记 M03「Markdown / ChatUI 渲染」阶段的实现与离线验证读数；按项目规则，**未提交、未上真机 GUI 复验，不标记功能已完成/已验证**。

## 0. 本轮结论（一句话）

M03 代码实现完成（流式状态入口、深浅色主题、非可信图片/链接安全边界），离线 `:shared:testDebugUnitTest` + `:androidApp:assembleDebug` 构建通过（**160 项测试 0 失败 / 0 错误 / 0 跳过**），APK `androidApp-debug.apk` 9,381,611 B；**真机深色渲染与流式视觉效果仍待用户实机复验**，不能因单测通过宣称 GUI 验收完成。

## 1. 实现范围（6 处文件，均在 `apps/mobile/shared/src`）

| 文件 | 改动要点 |
|---|---|
| `saui/chat/SaMarkdown.kt`（新增） | 唯一 Markdown 接入点；每条消息独占 `ChatMessageRenderer`（持有 `MarkdownStreamingState` + 块级 `observableList`）；`KuiklyStreamingMarkdown(state, block, config)` 单块渲染；`MarkdownConfig` 深浅色完整色板与代码高亮开关；图片安全：递归 AST 检测含 `IMAGE` 节点 → 整块降级为原文 `Text`，不创建 `Image`/`ImageSpan`；链接 `onLinkClick/onLinkLongPress = null`，不注入点击/长按回调 |
| `chat/ChatModels.kt` | `ChatUiMessage` 增加仅 UI 用的 `renderKey: Any = Any()`（`copy` 保留、不序列化），作为消息渲染状态稳定身份 |
| `feature/chat/ChatPage.kt` | 旧 `messages` 普通 `forEach` 改为持久 `messageRenderers`（`observableList<ChatMessageRenderer>`）+ 外层 `vfor`；面板用 `vbind` 切换；新增气泡主题切换入口与 `messageTheme`；`requestMessageKey` 防错目标/跨消息污染；`StreamingInputBar` 调用点局部 `vbind`（draft/busy/useStream/model/streamCancellable，不绑消息或正文 delta） |
| `saui/chat/ChatMessageBubble.kt` | 用户消息真正纯文本（`Text` 原文，保留空行/围栏，不走 MdParser）；AI 消息走 `SaMarkdown`；流式光标与重试按钮独立 `vbind`；长按复制读取最新未 trim 原文 |
| `chat/ChatPageRegressionTest.kt` | 适配新增 `renderKey`/`requestMessageKey`；新增错目标/取消状态身份断言 |
| `saui/chat/MarkdownRenderingTest.kt`（新增） | 11 个真实 `ChatPage` 挂载用例：delta 跨阶段稳定块、完成时统一失效重绘一次、缩短/重置/隔离、用户原文空行围栏、初始空态+历史切换、主题实际点击、长按复制最新原文、完成重试回退、后置引用变更失效旧块、库块 hash 碰撞不误复用、含图/表格/链接图片与 `javascript:`/`file:` 链接不创建 `Image`/`ImageSpan` 且无点击回调 |

## 2. 关键 API 契约（以实际源码为准，非官方文档示例）

- **流式语义**：`MarkdownStreamingState.update(text, force)` —— 第二参数实际是 `force: Boolean`（非文档示例的 `isEnd`）；`text` 必须是当前**完整快照**，不是追加 delta；相同文本且非 `force` 返回 `null`；每次调用**全量 `parseMarkdown`**，所以本轮实现的是「消息状态复用 + 块级 UI 差分」，不是真正的增量 AST 解析。
- **单块渲染**：`KuiklyStreamingMarkdown(state, block, config)` 只渲染一个 block，必须外层 `observableList` + `vfor` 做块级 UI 增量，不能单调用渲染整 state。
- **core 2.6.0 无 `diffUpdate`、无 `key` 参数**：`vfor(itemList: () -> ObservableList<T>, itemCreator)` 仅收 `ObservableList`；`vbind(bindValue)` 是整片 children 删重建，不能绑完整消息内容包整条 Markdown；`ComposeView.body()` 仅执行一次，`attr{}` 中读取的 observable 才自动收集订阅。
- **图片两条加载路径都被封闭**：`markdownComponents(image=...)` 仅覆盖块级 `IMAGE`，段落/标题/表格内图片由 `MarkdownAnnotatedStringBuilder` 产生 `ImageSpan.src` 绕过该覆盖；更稳妥做法是 AST 递归检测含 `IMAGE` 节点后整块降级为纯文本（本轮采用），彻底不建 `Image`/`ImageSpan`。
- **默认链接无导航**：`onLinkClick/onLinkLongPress = null` 时只着色、不自动打开 URI/WebView。
- 源码包 SHA256（已与 Gradle 缓存声明一致）：d29e619e…（KuiklyMarkdown sources）、core 2.6.0-2.0.21 sources。

## 3. 验证读数

- 命令（离线）：`:shared:testDebugUnitTest :androidApp:assembleDebug`
- 结果：`BUILD SUCCESSFUL in 2m 28s`；测试 **160 项 / 失败 0 / 错误 0 / 跳过 0**（含 `MarkdownRenderingTest` 11 项）
- APK：`apps/mobile/androidApp/build/outputs/apk/debug/androidApp-debug.apk`，9,381,611 B，SHA256 `861d2da8146efce61645fb8d0d996754e84f64dba7f169c2a36bb29a70e1c022`
- 本轮源码 SHA256（5 个可读文件）：SaMarkdown `a5e58c69…`、MarkdownRenderingTest `551a362a…`、ChatModels `88bc207f…`、ChatPage `a8f4e989…`、ChatMessageBubble `fb7eeb49…`
- 同行评审（只读）：`target/tmp/mobile-markdown-20261023/validation/review.txt`，确认 R1（递归引用签名）与 R2（final 统一失效一次）代码缺陷关闭；结论区分代码/执行/GUI 三层。

## 4. 明确未验证 / 不宣称（重要边界）

- **真机渲染效果**：深色配色、代码高亮、流式打字机视觉未经真实设备复验；单测只证明挂载后属性变化，不证明像素/视觉正确。
- **流式入口的「流式」仍是全量重排**：库每次全量解析，完成（final）时统一失效一次全消息重绘；非「真正增量 AST 解析」，不能对外宣称增量解析。
- **鸿蒙 `-ohos` 变体**：未构建/未验。
- **KuiklyChatUI 五模块**：在 `maven-tencent` 无版本，未接入。
- **M04 daemon 直连真实任务**：本轮未触碰；ChatPage 当前仍走网关 `/v1/chat/completions`，`kind=task` 存在「任务失败却被标 done」的语义风险（见 `mobile-route-audit` 盘点），属后续阶段，不混入本轮。
- UI / Markdown 组件**不替代** daemon 远程网络层（RPC/SSE/TLS）。

## 5. 相关记录

- 采纳前提：[Kuikly AI 参考资料采纳](2026-10-23-kuikly-ai-reference-adoption.txt)
- 路线台账：[PRD-tracking「移动端与 Web 路线台账」](../../product/PRD-tracking.md#移动端与-web-路线台账2026-10-23-补录)
- 导航/daemon 只读盘点：`target/tmp/mobile-markdown-20261023/route-audit.txt`（建议下一切片，未改源码）
- 本轮未提交、未推送、未安装、未发布。
