# 2026-10-23 手机端组件 Demo 清理

## 授权与范围

用户明确提出“已解锁，demo应该删除了，我们不需要demo”。本次使用 `kuikly-ui-framework` skill，查阅其 `references/KuiklyUI/docs/DevGuide/multi-page.md` 的页面注册与导航说明；删除已确认只承载演示的组件目录，不改应用身份、不清手机数据。

引用核对结果：

| 位置 | 修改 |
|---|---|
| `shared/.../saui/catalog/SaUICatalogPage.kt` | 删除组件样例目录页（原 645 行），不删除 SaUI 共享组件 |
| `shared/.../feature/login/LoginPage.kt` | 删除“打开组件库 Demo”按钮与跳转 |
| `androidApp/.../MainActivity.kt` | 删除目录页手动路由注册和日志列举，保留正式页面 |
| `ohosApp/.../pages/Index.ets` | 原 Demo 启动路由改为 `LoginPage`，加载提示改 SaApp |
| 鸿蒙路由适配器及平台注释 | 不再声称单页样例无需导航，明确多页路由/Toast 未实现 |

同步手机 README、AGENTS、PROGRESS、MVP 与 SaUI/鸿蒙差异说明。不改历史变更日志中的旧事实。`com.sa.demo` applicationId/包名保留以维持同签名覆盖升级及数据连续性；不能按字符串 demo 整树删除。`AgentPage`、`BindAgentPage` 为旧设备协议功能，不作为组件样例混删；正式设备导航仍为 `RemoteDevicesPage`。

## TDD 与本地验证

- 新增 `apps/mobile/test/product-routes.test.mjs`，先运行得到 2 项失败（Demo 源码仍存在、鸿蒙仍启动目录页），1 项通过（共享组件/应用身份）。
- 修改后 `node --test apps/mobile/test/product-routes.test.mjs`：**3/3 通过**。
- `:shared:testDebugUnitTest :androidApp:assembleDebug --offline`：**BUILD SUCCESSFUL**。
- XML 汇总：23 套件，**165 tests / 0 failures / 0 errors / 0 skipped**。
- 生产 `.kt` / `.ets` 中搜索 `SaUICatalogPage` / `saui.catalog` / 旧按钮文案：无命中。
- 扫描新 APK 所有 `.dex`：`SaUICatalogPage` 类名命中 **0**，避免只删手动入口、增量 KSP 仍打包旧类。
- 当前 Debug APK：**9,236,504 B**，SHA256 `e4ff6de20eef0440054ecb470c220f84ec3f82d578c2912d60bde742af61125c`。
- `git diff --check -- apps/mobile` 无空白错误，仅 Git LF/CRLF 提示。

## 真机实际读数

- 在此前用户授权覆盖安装的范围内，向已确认的 Honor TEL-AN10 安装本次新 Debug APK，`adb install -r` 返回 **Success**，未卸载、未 `pm clear`。
- `am start -n com.sa.demo/.MainActivity` 返回 Starting Intent，未再发生启动等待超时。
- 解锁后两次应用控件树均识别到登录页的“手机号”“短信验证码”输入框。应用未登录；未输入凭据、未绕过登录、未发起真实模型/远程任务。
- 控件树不能完整识别 Kuikly 文本按钮，因此不把源码及 APK 检查写成完整视觉点击验收。
- **设备入口和任务卡的登录后真机 GUI 仍待用户测试账号/登录**，目前只有 JVM Kuikly 视图树回归通过。不升级 M04 闭环状态。
- 鸿蒙仅完成入口源码纠正和静态回归，**未构建、未真机验收**，现有多页导航仍不完整。

## 证据路径

`target/tmp/mobile-m04a-20261023/` 下：`demo-routes-red.log`、`demo-routes-green.log`、`demo-removal-gradle.log`、`check-apk-demo.py`、`device-window.xml`。运行输出不入库，未提交或推送。
