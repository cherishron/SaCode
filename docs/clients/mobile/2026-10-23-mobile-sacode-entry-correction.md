# SaCode 手机入口与本机设备档案整改

日期：2026-10-23。未提交工作区；本批只改移动入口/本机隔离及关联文档，未修改 daemon 认证或扩大 RPC 白名单。

## 根因与变更

- 迁入的 Android 启动/OAuth 回调仍强制走 LoginPage，RemoteDevicesPage 用 `AuthRepository.storedUsername()` 作为登记前提；这把 SaCode 直连错误绑定到 saai IdP/gateway。
- Android 只注册 RemoteDevicesPage，统一 ProductRoutes 兜底；取消旧 OAuth 深链及回调，不再注册 Login/Chat/Account/Agent/BindAgent。移除正式设备页旧底栏，遗留 HomeTabs 路由收敛到受保护入口。应用显示名改 SaCode，applicationId 保持 `com.sa.demo`。
- LocalDeviceProfile 用平台随机源生成 32 字节安装级标识，经 SecureStore 持久化并回读确认，作为 registry/vault owner。格式/写入失败拒绝操作，不用空账号或伪造已登录状态。它不授予远端权限，不把档案值写入 idpSub；不迁移/删除旧账号绑定。
- 登记回执仍入原 RemoteCredentialVault，短 token 仅内存，服务端一次性票/实例检查/工作区授权不变。异步结果、登记保存及 SSE 回调校验本机档案和连接代次。票提交前清除页面值，field 改为响应式 getter，确保输入控件同步清票。
- OHOS Index 仅静态改为 RemoteDevicesPage；未构建/安装。其平台安全存储、网络、路由阻塞不因 Android 通过而消失。

## 测试与构建

先修改入口静态回归，旧实现 2 fail / 1 pass，随后改实现。

- `node --test apps/mobile/test/product-routes.test.mjs`：3 pass / 0 fail。
- `cd apps/mobile && gradlew.bat :shared:testDebugUnitTest :androidApp:assembleDebug --offline`：BUILD SUCCESSFUL。
- XML 汇总：26 suites，171 tests，0 failures / 0 errors / 0 skipped。
- 新增 LocalDeviceProfileTest（持久化/安装隔离/旧账号隔离/写入失败/无 IdP 登记与令牌边界）、ProductRoutesTest、RemoteDevicesEntryTest（真实 Kuikly Pager 首屏、存储失败、输入框响应式清票）。原只读方法拒绝和 workspace 初始化测试继续通过。
- 首次构建因新增测试误用不存在的 AgentTarget 类型失败，核对实际 BoundAgent 后修正，未改生产契约绕过。
- 构建日志：`target/tmp/mobile-entry-20261023-build-r3.log`。
- APK：`apps/mobile/androidApp/build/outputs/apk/debug/androidApp-debug.apk`，9,262,192 B。
- SHA256：`b03fdfe7e68b561799985d6cc671da12f3b7e7739ca92dbc70501bf0e88f49c7`。

## 真机与边界

在用户此前明确授权下，Honor TEL-AN10 执行 `adb install -r` 成功，保留数据，无 uninstall / pm clear；启动命令成功。UI 树检查时手机锁屏，**尚未核验新配对页真机显示**，已请求用户手动解锁；不尝试绕过锁屏，不把安装成功当 GUI 或远程任务通过。

未启动 sa-idp/gateway-rs；未创建旧测试账号；未输入真实票、凭据或启动远程任务；未声明扫码/Relay/SSH/执行/审批完成；未提交或推送。

## 技能与参考

已加载 kuikly-ui-framework、kuikly-reactive-observer、security-review。查阅本机 `C:/Users/jingg/.agents/skills/kuikly-ui-framework/references/KuiklyUI/docs/API/{components/basic-attr-event.md,components/input.md,modules/router.md}` 及 reactive-observer 的 `references/COMMON_MISTAKES.md`。技能更新检查提示需更新，更新脚本 fetch 超时，继续使用已存在的参考仓库，没有宣称更新成功。
