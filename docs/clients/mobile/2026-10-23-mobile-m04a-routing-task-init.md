# 2026-10-23 移动端 M04-A 三处根因修复（路由 / 任务语义 / initialize workspaceId）

- 日期：2026-10-23
- 工作区：未提交；本轮未 git add / commit / push / 安装 / 发布
- 范围：按 `target/tmp/mobile-m04a-20261023/handover.md` 做 TDD 红先后绿，仅修手机客户端三处已确认根因
- 不升级：M04 真实 daemon 直连、审批/执行/取消/结算、鸿蒙、真机 GUI

## 根因与修复

| Bug | 修复 |
|---|---|
| HomeTabs `DEVICES` 指向 `AgentPage` | `routeOf(DEVICES) = "RemoteDevicesPage"`；聊天页「我的电脑」「绑定电脑」同改 |
| 任务接口不支持仍调 chat 并标 `done` | `kind=="task" && !submit.supported` 时不调 chat；`finishRequest` 标 `unsupported`，detail 用 `submit.detail` |
| `RemoteDaemonClient.initialize()` 不传 workspaceId | 改为 `initialize(workspaceId)`，请求体 `params.workspaceId` 来自 `RemoteRequestContext`；`RemoteDevicesPage.connect()` 传入 `agent.workspaceId` |

`AgentPage` / `BindAgentPage` 仍注册，仅不再作为底部设备页与聊天辅助按钮入口。

## TDD

1. 已有红灯测试：`HomeTabsRouteTest`、`TaskUnsupportedSemanticsTest`
2. 新增 `initialize_sends_workspace_id_in_params`；同步既有 `initialize()` 调用为 `initialize("ws")`
3. 红灯：`:shared:compileDebugUnitTestKotlinAndroid --offline` 报 `Too many arguments for 'fun initialize(): RemoteInitialization'`（3 处）
4. 改源码后转绿

## 验证读数（本机 Windows，离线 Gradle）

- `:shared:testDebugUnitTest --offline` **BUILD SUCCESSFUL**
- 23 个 TEST-*.xml：**164 tests / 0 failures / 0 errors / 0 skipped**
- 关键用例：`devices_tab_routes_to_safe_remote_page`、`unsupported_task_does_not_fall_back_to_chat_or_mark_done`、`unsupported_task_with_404_marks_unsupported_not_done`、`initialize_sends_workspace_id_in_params` 均通过
- `:androidApp:assembleDebug --offline` **BUILD SUCCESSFUL**
- APK `apps/mobile/androidApp/build/outputs/apk/debug/androidApp-debug.apk` 9,360,394 B，SHA256 `b7b55c2c0d08c21b07bd47765811d4d1c03605e50b38be422f59e0757254d977`

`adb devices` 见 Honor `TEL-AN10`（`9WDNW20C19025752`）已连接；本轮未 `adb install`、未启动应用、未做 GUI 点击验收。

## 同日续修：任务提示与响应式回归

本节为后续验证批次；上方 APK 大小与摘要保留为首轮历史记录，不代表当前构建产物。

- 使用 `kuikly-ui-framework` 与 `kuikly-reactive-observer` skill，先查阅 `references/KuiklyUI/docs/DevGuide/directive.md` 的 `vbind`、`docs/DevGuide/reactive-update.md`、`docs/API/components/text.md`，并核对 `core/src/commonMain/kotlin/com/tencent/kuikly/core/directives/BindDirectivesView.kt`。
- 修正任务面板、任务空态及 404/405、401/403 返回提示，不再声称接口不可用时回退 chat；`unsupported` 状态栏明确显示“任务不受支持”。
- 任务卡区域用 `vbind({ page.tasks })` 订阅列表替换，任务异步更新时不必切换面板才能显示新状态；列表外“去发起任务”按钮保留。
- 扩充只读拒绝测试：`session/select`、`turn/start`、`host/cancel` 在读取令牌或发送网络之前拒绝，未扩大方法白名单。
- 红灯：新增提示常量断言后，编译报 `Unresolved reference 'TASK_PANEL_HINT' / 'TASK_EMPTY_HINT'`；实现后转绿。
- 新增实际 Kuikly Pager 渲染测试 `open_task_panel_updates_from_empty_to_running_to_unsupported`，验证空态→running→unsupported→空态及操作按钮存续；不是仅检查 Kotlin 数据字段。
- 最终 `:shared:testDebugUnitTest --offline`：**23 个测试套件，165 tests / 0 failures / 0 errors / 0 skipped**。
- `:androidApp:assembleDebug --offline` 成功；本批 APK **9,257,723 B**，SHA256 `3ed460e54dc9d83398ea195a3a2b90add4d6d520afcb4ee78d06f38a4f60a059`。后续新增项仅为测试，未改生产源码。
- 日志：`target/tmp/mobile-m04a-20261023/followup-gradle.log`、`followup-render-test.log`。带 `--tests` 的一次运行没有匹配到测试，未当成通过；随后无过滤重跑全部 shared 单测成功。
- 仍未安装 APK、未进行真机 GUI 或真实 daemon 闭环；JVM 视图树测试不等同真机视觉验证。

## 用户授权覆盖安装（同日后续）

- 用户明确选择“允许安装并验收”，范围为保留应用数据，不使用真实密钥，不触发真实远程任务。
- 设备 Honor TEL-AN10 在线；包名 `com.sa.demo`，新旧 APK 均为版本号 1。
- 新旧 APK 签名证书 SHA256 均为 `57fc73c0c2d52a26ee26bc46679dfb4f4a4523c2b109d5843baa862aae9b05d8`；原安装 APK 仅备份到 `target/tmp/mobile-m04a-20261023/preinstall-base.apk`，未读取应用私有凭据值。
- `adb install -r` 返回 **Success**，未卸载、未执行 `pm clear`；仅检查安全偏好键是否存在，access_token / refresh_token / api_key 均不存在，未解密、打印或保存凭据值。
- `am start -W` 等待超时，随后诊断确认应用 activity 已 resumed，但系统锁屏 `showing=true`、`SCREEN_STATE_OFF`；控件树属于 SystemUI，不属于应用。未绕过锁屏，等待用户手动解锁。
- 后续用户已手动解锁；去 Demo 的更新包保留数据安装成功，并确认登录页控件。详见[Demo 清理记录](2026-10-23-mobile-demo-removal.md)。当前未登录，不绕过认证；设备入口与任务面板仍待真机验收。
- **安装及登录页启动成功不等于登录后 GUI 通过**。

## 未做

- 真机 DEVICES 页视觉确认、任务卡 GUI 确认（已解锁，等待测试账号登录）
- daemon 实连、TLS 指纹、审批/执行/取消
- 鸿蒙构建、提交推送、发布
