# SaCode 移动端

[![Kotlin Version](https://img.shields.io/badge/Kotlin-2.0.21-blue.svg)](https://kotlinlang.org/)
[![KuiklyUI](https://img.shields.io/badge/KuiklyUI-2.6.0-green.svg)](https://github.com/Tencent-TDS/KuiklyUI)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20OHOS-green.svg)](https://kotlinlang.org/docs/multiplatform.html)

> SaCode 移动工作台：KMP + KuiklyUI + SaUI，与 SaCode 同仓管理。
> 正式入口为 `RemoteDevicesPage`：电脑 SaCode 出具一次性登记票 → 手机手动配对 → 设备凭据换取短期 token → 按工作区权限只读访问。不要求 sa-idp、gateway-rs、手机号或旧 saai 账号。
> 本地随机设备档案仅用于注册表/安全存储命名空间，不代表远程身份。旧账号绑定不自动迁移、旧数据不清除；重新配对进入独立档案。`com.sa.demo` applicationId 保留以兼容覆盖安装。
> 旧 Login/Chat/Account/Agent/BindAgent 源码暂留供依赖审计，但不注册 Android 产品路由；设备页不提供旧导航，旧 OAuth 深链已移除。共享组件与测试保留。
> 当前只开放 `initialize`、`session/catalog`、`session/events`；扫码、Relay、SSH、远程执行/审批尚未交付。鸿蒙仅调整入口源码，网络/安全存储/路由仍需单独实现和验收。

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Kotlin | 2.0.21 | 主要开发语言 |
| Kotlin Multiplatform | 2.0.21 | 跨平台共享代码 |
| KuiklyUI | 2.6.0-2.0.21 | 跨平台 UI 框架 |
| Koin | 3.5.6 | 依赖注入 |
| Napier | 2.6.1 | 日志框架 |
| Gradle / AGP / JDK | 8.9 / 8.5.0 / 17 | Android 构建 |

## 项目结构

```
├── framework/          # Kuikly 适配器框架（7 个适配器）
├── shared/             # KMP 共享模块
│   └── src/commonMain/kotlin/com/sa/demo/
│       ├── saui/       # SaUI 组件库 (26 基础 + 2 业务)
│       ├── feature/    # 业务页面 (login/chat/agent)
│       └── core/       # 平台核心代码
├── androidApp/         # Android 应用入口
└── docs/               # 文档中心
```

## SaUI 组件库

基于 Kuikly 原生组件封装的 SaUI 设计系统组件库，共 26 个基础组件 + 3 个聊天业务组件。

| 分类 | 组件 |
|------|------|
| Token (5) | SaUIColors, SaUITypography, SaUISpacing, SaUIRadius, SaUIShadow |
| Base (1) | SaButton (6 variants x 3 sizes) |
| Foundation (3) | SaIcon + SaIcons (49 常量), SaDivider, SaBadge |
| Form (5) | SaInput, SaSearchBar, SaCheckBox, SaRadio + SaRadioGroup, SaStepper |
| Data (4) | SaAvatar, SaCell + Group, SaTag, SaCollapse |
| Feedback (10) | SaLoading, SaToast, SaEmpty, SaProgress, SaResult, SaRate, SaNoticeBar, SaSkeleton, SaPopup, SaDrawer |
| Navigation (3) | SaNavbar, SaTabBar, SaSteps |
| Chat 业务 (3) | ChatMessageBubble, StreamingInputBar, MdParser |

### 使用示例

```kotlin
import com.sa.demo.saui.SaUIComponents
import com.sa.demo.saui.SaUITokens

SaUITokens.Colors.BrandPrimary   // "#0052D9"
SaUITokens.Spacing.md            // 12f

SaUIComponents.Button.build(text = "确定", variant = SaButton.Variant.PRIMARY) {}
SaUIComponents.Input.build(label = "名称", placeholder = "请输入") { /* onChange */ }
```

## 构建命令

在 `apps/mobile/` 工程根执行，先通过本机 `JAVA_HOME` 提供 JDK 17，通过 `ANDROID_HOME` 或被忽略的 `local.properties` 提供 Android SDK；不固定开发者机器路径。

```powershell
# Windows PowerShell；需要本机已有 wrapper 与依赖缓存
.\gradlew.bat :shared:compileDebugKotlinAndroid --offline
.\gradlew.bat :shared:testDebugUnitTest --offline
.\gradlew.bat :androidApp:assembleDebug --offline
```

```bash
# Bash / Linux
./gradlew :shared:compileDebugKotlinAndroid :shared:testDebugUnitTest :androidApp:assembleDebug --offline
```

Gradle 默认只装配 `framework`、`shared`、`androidApp`。`ohosApp/` 与 OHOS 配置保留源码，不代表鸿蒙构建或真机已验证。原 `kotlin/`、`kotlin-test/` 9 个文件原字节保留，属于独立 JVM 协议代码，不是 Android 应用模块。

签名库和原含硬编码签名口令的 Gradle 配置不导入；目标签名通过本机环境注入，无默认口令。本轮未构建、测试、安装或发布；源码/单测/可构建/可安装/真实手机任务分别验收。仓库总目标与交付状态见 [根规则](../../AGENTS.md) 和[当前交付卡](../../docs/product/PRD-tracking.md)。

## 接入 saai（M1）

以下为后续获准联调步骤，不在源码导入时自动启动服务或安装：

1. 部署方准备 sa-idp（`:8080`）与 **gateway-rs**（`:8090`），确认就绪。原产品线指南 `../docs/guides/local-dev.md` 为迁入前参考，未导入本仓。
2. `MainActivity.resolveStartPage()` 实际启动 `LoginPage`，提供 App 内短信/密码登录及注册，OAuth 浏览器登录保留为兜底；深链为 `saapp://oauth/callback`。开发固定短信码不是生产认证设计。
3. 登录后进入 `ChatPage`，底部 `HomeTabs` 在对话、设备、我的之间路由切换；组件目录 Demo 不再注册或打包。
4. 远程设备只读接入仍限 `initialize`、`session/catalog`、`session/events`；未验收授权、会话归属、SSE 服务端隔离与强制沙箱前，不开放执行和审批。见[接入实施记录](docs/sa-code-integration-progress.md)。

配置见 `shared/.../env/SaaiEnv.kt`（默认 Dev 环境）。

## 文档

- [AGENTS.md](./AGENTS.md) - 开发规则手册
- [docs/saui/overview.md](./docs/saui/overview.md) - SaUI 组件库总览
- [docs/saui/components.md](./docs/saui/components.md) - 26 个基础组件 API 参考
- [docs/kuikly-dsl-gotchas.md](./docs/kuikly-dsl-gotchas.md) - Kuikly DSL 陷阱与规则
- [docs/index.md](./docs/index.md) - 文档索引导航


