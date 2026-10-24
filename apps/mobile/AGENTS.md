# SaCode 移动端 - Agents 技术文档

> AI 开发助手的规则手册。详细 DSL 陷阱见 [docs/kuikly-dsl-gotchas.md](./docs/kuikly-dsl-gotchas.md)。
> **产品角色**：SaCode 移动工作台，正式入口为 RemoteDevicesPage + 独立本机设备档案 + daemon 配对，不要求 sa-idp/gateway-rs、手机号或 saai 账号。旧 Login/Chat/Account/Agent/BindAgent 源码仅供依赖审计，不注册 Android 正式路由；旧数据不清除或自动迁移。下方 saai 认证/网关说明仅为迁入历史，不能作为配对前提。applicationId 保留以兼容覆盖安装。

## 单仓库规则与验收边界（2026-10-23）

- 首先遵守仓库根 [AGENTS.md](../../AGENTS.md)、[PRD](../../docs/product/PRD.md)、[当前交付卡](../../docs/product/PRD-tracking.md) 与[交付主线](../../docs/plans/product-closure-goal-2026-10-15.md)。本文补充手机与 Kuikly 专用规则，不另立产品完成标准。
- 仓颉 `core/` 是共享任务、授权、取消、恢复与结算语义真源；KMP `shared/` 是客户端共享层，不复制后端 Agent 主循环或授权机制。远程连接只消费 daemon 已声明且合法授权的能力。
- 当前受保护移动接入只开放 `initialize`、`session/catalog`、`session/events`；执行、审批、多主体 SSE 隔离须独立验证，导入源码不构成开放授权。现状见 [接入实施记录](docs/sa-code-integration-progress.md) 与 [10 月 22 日复评](docs/sa-code-upgrade-assessment-2026-10-22.md)。
- 真实密钥、Token、密码、私钥、Cookie、认证头、`.env`、签名库及含秘密的配置均不得入库、回显或写测试日志；安全存储与账号/目标代次隔离继续保留。签名只由本机环境提供，无默认口令。
- 手机测试保留 KMP 的 `shared/src/commonTest/` 和 `shared/src/androidUnitTest/`；原 `kotlin/`、`kotlin-test/` 是同仓 JVM 协议代码，不是 Android 应用入口，不覆盖或改名。一次性日志、快照与验证报告统一放仓库根 `target/tmp/<用途>-<日期>/`；Gradle 的标准 `build/`、`.gradle/` 为忽略输出，禁止写 `dist/`。
- 本轮仅复制源码与路径适配，未构建、安装、启动服务或真机验收。单测、可编译、可安装、真实手机任务与发布分列；旧 PASS 不算迁入后通过。提交、安装依赖、联网、真实模型请求、发布均须另行授权。
- 行为或缺陷状态变化同步根 PRD 台账与分类索引；手机局部记录可写 `docs/PROGRESS.md`，不得替代根台账。保留旧源 `sa-app`，不移动其 Git，不覆盖其他会话改动。

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 语言/框架 | Kotlin KMP | 2.0.21 |
| UI | Kuikly (腾讯) | 2.6.0-2.0.21 |
| 设计系统 | SaUI | 自建 (基于 Kuikly 原生组件) |
| DI | Koin | 3.5.6 |
| Gradle / AGP / JDK | 8.9 / 8.5.0 / **17** |

## 构建命令

Android SDK 路径通过 `local.properties` 的 `sdk.dir` 配置（该文件已在 `.gitignore` 中，每人各自配置为本机 SDK 路径）：

```properties
sdk.dir=<本机 Android SDK 路径>
```

以下任务在 `apps/mobile/` 工程根执行；先配置本机 JDK 17（`JAVA_HOME`）与 Android SDK，离线验证前必须已有 wrapper 和依赖缓存，缺失时报告阻塞而非自动联网安装。

```powershell
# Windows PowerShell
.\gradlew.bat :shared:compileDebugKotlinAndroid --offline
.\gradlew.bat :shared:testDebugUnitTest --offline
.\gradlew.bat :androidApp:assembleDebug --offline
```

```bash
# Bash / Linux
./gradlew :shared:compileDebugKotlinAndroid --offline
./gradlew :shared:testDebugUnitTest --offline
./gradlew :androidApp:assembleDebug --offline
```

实际 wrapper 版本以 `gradle/wrapper/gradle-wrapper.properties` 为准（8.9）；默认 `settings.gradle.kts` 只包含 Android 三模块，OHOS 使用独立配置，不能由 Android 通过推定鸿蒙通过。

## SaApp 接入层（M0/M1 已落地代码）

| 包 | 职责 |
|---|---|
| `com.sa.demo.env.SaaiEnv` | IdP/Gateway/client_id/redirect_uri（Dev：`127.0.0.1:8080` / `:8090`） |
| `com.sa.demo.auth` | PKCE S256、Token 模型、AuthRepository（authorize→token→exchange→models）、OAuthBridge |
| `com.sa.demo.storage` | SecureStore（Android Keystore AES-GCM）；**禁止**明文 SP 存 token/key |
| `com.sa.demo.core.platform` | HTTP / 打开浏览器 / 页面路由桥 / 墙钟（expect-actual） |
| `LoginPage` | **App 内原生登录**：短信 / 密码 / 注册直调 sa-idp；OAuth 浏览器仅兜底 |
| `ChatPage` | 对话 + **本地历史/项目** + **云端任务**（接口未就绪时标 unsupported，不回退 chat） |
| `history/*` | LocalHistoryRepository / CloudSyncApi（用户级历史，云端契约见产品线 design-sa-app） |

深链：`saapp://oauth/callback`（Manifest 已注册，`launchMode=singleTask`）。
开发短信码：IdP 固定 `123456`。联调前 IdP/网关需本机就绪，issuer **必须** `http://127.0.0.1:8080`。

---

## 项目结构

```
/workspace/
├── framework/              # Kuikly 适配器框架模块
│   └── src/main/java/
│       └── com/sa/demo/kuikly/
│           ├── KuiklyFramework.kt      # 统一初始化入口
│           ├── ContextCodeHandler.kt   # 页面加载处理器
│           └── adapter/                # 7 个适配器
├── shared/                 # KMP 共享模块
│   └── src/commonMain/
│       ├── kotlin/
│       │   └── com/sa/demo/
│       │       ├── saui/                # SaUI 组件库 (26 基础 + 2 业务)
│       │       │   ├── SaUI.kt          # 入口聚合 (SaUIComponents / SaUITokens)
│       │       │   ├── token/           # SaUIColors / Typography / Spacing / Radius / Shadow
│       │       │   ├── base|form|data|feedback|foundation|navigation/
│       │       │   ├── chat/            # ChatMessageBubble / StreamingInputBar
│       │       ├── core/               # 核心平台代码
│       │       ├── feature/            # 业务页面 (login/chat/agent)
│       │       └── App.kt              # 应用入口
├── androidApp/             # Android 应用入口
└── docs/                   # 文档中心
    ├── framework/          # Framework 文档
    └── saui/               # SaUI 组件库文档
```

---

## 包名

包名与 Android applicationId 保留 `com.sa.demo`。应用由 `AndroidApplication` / `MainActivity` 启动，`resolveStartPage()` 返回 `LoginPage`；登录后进入 `ChatPage`，设备与账号导航共用 `HomeTabs`，不把组件 Demo 当产品入口。

---

## 初始化顺序

AndroidApplication.onCreate() 中必须按此顺序：
1. NapierInitializer.init()（日志）
2. PlatformContext 初始化
3. initAndroidApp() → Koin DI
4. KuiklyFramework.initAdapters() → 6 个适配器（图片为 placeholder）
5. 内联 initCoreEntry() → KuiklyCoreEntry（在 AndroidApplication 中直接 new）

**图片适配器必须无条件覆盖**：Application 设置了 placeholder，Activity 必须调用 `KuiklyFramework.setImageAdapter(this)` 覆盖（不能用 `if == null` 判断）。

---

## Kuikly 开发强制流程

用户指定开发入口：[Kuikly AI](https://kuikly.tds.qq.com/AI/)。官方技能来源为 [Tencent-TDS/KuiklyUI-AI](https://github.com/Tencent-TDS/KuiklyUI-AI)，不是名为“mobile端开发”的通用 AI SDK。UI/响应式任务先读取 `skills/kuikly-ui-framework/SKILL.md`、`skills/kuikly-reactive-observer/SKILL.md` 及所引用规则；从官网/仓库读取不等于已安装到本机，未经实际安装不得宣称自动加载。官方最新示例须与本工程 Kuikly 2.6.0 源码对照：该版本没有 `ObservableList.diffUpdate`，不要直接套用新版本 API。KuiklyChatUI/Markdown 是渲染组件，不能替代 daemon RPC、SSE、TLS 与审批。

**所有 Kuikly UI 开发必须查阅官方文档，禁止凭记忆编写：**

1. 已导入的本地资料：`docs/kuikly-official-api-index.md`、`docs/components/`、`docs/kuikly-dsl-gotchas.md`。原 `.agents/skills/kuikly-ui-framework/references/KuiklyUI/docs/` 属工具目录，未随工程导入；找不到资料时报告，不凭记忆编 API。
2. 官网文档: https://kuikly.tds.qq.com/API/components/
3. GitHub 源码: https://github.com/Tencent-TDS/KuiklyUI

> 详细 DSL 陷阱见 [docs/kuikly-dsl-gotchas.md](./docs/kuikly-dsl-gotchas.md)

## Kuikly DSL 快速自查

```
□ 组件:  Text { attr {} }          非  Text("...")
□ 属性:  attr { text("hi") }       非  text = "hi"
□ 事件:  event { click {} }         非  attr { onClick {} }
□ 颜色:  backgroundColor(Long)      Border(color=Color对象)
□ 边框:  border(Border(lw,SOLID,c)) 非 borderWidth()
□ 字重:  fontWeightBold()           非 fontWeight(700)
□ 尺寸:  size(100f, 50f)           非 100.dp (直接传 Float)
□ 枚举:  justifyContent(CENTER)   非 "center"
□ Button: titleAttr { text("btn") } 独有子块设置文本
```

## Kuikly 版本格式

Kuikly KMP 制品必须保持 `{KuiklyVersion}-{KotlinVersion}` 一致：
`core: 2.6.0-2.0.21` | `core-render-android: 2.6.0-2.0.21` | `core-ksp: 2.6.0-2.0.21`

Kuikly >= 2.5.0 必须使用腾讯镜像（已配置于 `settings.gradle.kts`）:
`https://mirrors.tencent.com/nexus/repository/maven-tencent/`

---

## SaUI 组件库

基于 Kuikly 原生组件封装的 SaUI 设计系统组件库，详见 [docs/saui/overview.md](./docs/saui/overview.md)。

### 设计原则

1. **Kuikly 原生可用的直接用**：Switch、AlertDialog、Slider、TextArea、DatePicker、Tabs、ActionSheet 等 15+ 原生组件无需封装
2. **只封装有实质注入的**：每个组件必须注入 SaUI Token（颜色/间距/圆角/字体），纯参数透传的薄包装应移除
3. **使用 `object` + `fun build(): ViewBuilder` 模式**：统一调用风格 `SaUIComponents.Button.build(...).invoke(this)`

### 组件清单 (26 个基础组件 + 3 个业务组件)

| 分类 | 组件 |
|------|------|
| Token (5) | SaUIColors, SaUITypography, SaUISpacing, SaUIRadius, SaUIShadow |
| Base (1) | SaButton (6 variants x 3 sizes) |
| Foundation (3) | SaIcon + SaIcons (49 个 Unicode 常量), SaDivider (横/竖/带文字), SaBadge (DOT/COUNT) |
| Form (5) | SaInput (label/prefix/suffix/error), SaSearchBar, SaCheckBox, SaRadio + SaRadioGroup, SaStepper |
| Data (4) | SaAvatar (3 类型 x 6 尺寸), SaCell + Group, SaTag (5 色 x 3 尺寸), SaCollapse |
| Feedback (10) | SaLoading, SaToast, SaEmpty, SaProgress, SaResult, SaRate, SaNoticeBar, SaSkeleton, SaPopup, SaDrawer |
| Navigation (3) | SaNavbar, SaTabBar, SaSteps (横/竖) |
| Chat 业务 (3) | ChatMessageBubble（消息气泡）, StreamingInputBar（流式输入栏）, MdParser（正文解析，纯函数） |

> 入口聚合对象：`SaUIComponents`（组件）/ `SaUITokens`（令牌），见 [saui/SaUI.kt](./shared/src/commonMain/kotlin/com/sa/demo/saui/SaUI.kt)。

### 统一入口

```kotlin
import com.sa.demo.saui.SaUIComponents
import com.sa.demo.saui.SaUITokens

// 使用 Token
SaUITokens.Colors.BrandPrimary   // "#0052D9"
SaUITokens.Spacing.md            // 12f

// 使用组件
SaUIComponents.Button.build(text = "确定", variant = SaButton.Variant.PRIMARY) {}
SaUIComponents.Input.build(label = "名称", placeholder = "请输入") { /* onChange */ }

// Kuikly 原生组件直接使用（无需 SaUI 封装）
Switch { attr { isOn(true); onColor(Color(...)) } }
AlertDialog { attr { title("..."); message("..."); actionButtons("确定") } }
```

### 产品页面与组件测试

组件目录 Demo 页面及其 Android 注册、登录入口已按用户要求删除；鸿蒙启动页指向 `LoginPage`，鸿蒙导航和构建仍须独立验收。不要重新向产品安装包加入演示页。

新增或修改组件须补充单测或 Kuikly 视图树回归，并在实际产品页面验证；保留共享 SaUI 组件与测试，不因 `com.sa.demo` 包名而整树删除。

---

## 代码解构规约

> 与 [kuikly-dsl-gotchas.md](./docs/kuikly-dsl-gotchas.md) 互补：那份记**语法陷阱**，这份记**怎么拆代码**。
> 下列每条都对应本项目 `saui/` 的既有实现，可直接对照源码。

### 1. 逻辑能从 ViewBuilder 里抽出来，就抽成纯函数

Kuikly 的 `ViewBuilder` 是 lambda，运行期才产出视图树——**写进 lambda 的逻辑无法单测**。

```kotlin
// ❌ 解析逻辑埋在渲染 lambda 里：只能靠真机点按验证
private fun renderContent(content: String, textColor: String): ViewBuilder = {
    val lines = content.split("\n"); /* ... 状态机 ... */
}

// ✅ 抽成 object + 纯函数，同文件渲染，单测直接断言
MdParser.parse(content): List<MdBlock>
```

已按此拆出：`MdParser`（Markdown 解析）、`RetryRewind`（重试回退）、`CancelToken`（取消令牌）。
抽出的纯函数放进 `commonTest` 即可跑——**它们无 Kuikly 依赖**是能测的前提。

### 2. `ViewBuilder` 不能当扩展接收者；容器扩展接收者要用「视图类型」

`ViewBuilder` = `ViewContainer<*, *>.() -> Unit`，是**函数类型**。拿它做扩展接收者时
`this` 是那个 lambda 而非容器，块内 `View{}` / `Text{}` 全部报 *receiver type mismatch*。
（2026-10-09 实测：`= apply { }` 与非 apply 两种写法**都编译不过**。）

```kotlin
// ❌ this 不是 ViewContainer
private fun ViewBuilder.renderContent(...) { View { } }
private fun ViewBuilder.renderContent2() = apply { View { } }   // 同样不行

// ✅ 返回 ViewBuilder，调用点 .invoke(this)
private fun renderContent(...): ViewBuilder = { View { } }
```

容器内提取逻辑时，接收者是**视图类型**而非同名函数——`Column` 是工厂函数，类型叫 `ColumnView`：

```kotlin
// ❌ Unresolved reference 'Column'（Column 是函数，不是类型）
private fun Column.buildHeader() = apply { Text { attr { text("x") } } }

// ✅
private fun ColumnView.buildHeader() = apply { Text { attr { text("x") } } }
```

详见 [gotchas #09](./docs/kuikly-dsl-gotchas.md)。

### 3. 组件内不放状态，状态提升到调用方

Kuikly 组件是 `object`，无法持有每实例状态。需要开关/展开/输入态时，
由 Pager 用 `observable` 持有并以**带默认值的参数**回传——旧调用方行为不变。

```kotlin
// StreamingInputBar：默认 false = 收起，不传也能用
modelPickerOpen: Boolean = false,
onToggleModelPicker: (() -> Unit)? = null
```

**判据**：字段变化需要驱动界面重渲染 → `observable`；否则用普通字段。
如 `ChatPage.streamToken` 只是后台线程的控制句柄，用普通字段即可。

### 4. 平台能力先看 expect/actual，再考虑 Kuikly Module

Module 需在**每个 Pager 的 `createExternalModules()`** 注册，还要拿
`KuiklyRenderView.registerModule`，还要 Android/鸿蒙各写一份。**成本高。**

已有 expect/actual 桥时优先复用（`openUrlInBrowser` 就是这么拿 Context 的）：

```kotlin
expect fun copyToClipboard(label: String, text: String): Boolean
```

已有鸿蒙能力限制必须明确展示，不以占位实现宣称可用；本轮不新增占位行为。
新增 `expect` 时**必须同时核对 androidMain 与 ohosArm64Main 两份 actual**，并按各自工具链验证，不能把 Android 编译成功当成鸿蒙能力通过。

### 5. 回调是可选能力：不传就不绑手势、不渲染 UI

声明了却永不触发的回调是死代码；绑了却无实现的手势是坏交互。

```kotlin
// ✅ 有回调才绑 longPress，没有则连事件都不注册
if (onCopy != null) { event { longPress { onCopy() } } }
```

### 6. 状态标记用显式字段，不用字符串前缀匹配

曾想靠 `content.startsWith("错误：")` 判断能否重试——脆弱，且会把标记混进复制内容。
在数据类上加 `retryable: Boolean` 才是解法（见 `ChatUiMessage`）。

### 7. 跨路径的状态回退要抽出来测

重试要同时正确处理「发送失败」和「用户停止」两条路径，二者 history 状态不同
（失败时 user 轮已被删，停止时仍在）。这类分支极易漏写，
抽成 `RetryRewind.rewind()` 后用单测覆盖各条路径，比手动点按可靠。

### 8. 注释里别写会闭合注释的字符序列

Kotlin 的块注释**是嵌套的**——注释里的 `/*` 会开启一层嵌套，`*/` 只闭合最近那层。
所以 KDoc 里写 `` `turn/*` `` 或 `*/api/identity/*` 会报 `Unclosed comment`，
而且报错只说"未闭合"，**不会告诉你是哪一行里的字符干的**。

文档注释里避开连续的 `*` `/` 组合；要说通配符就写 `turn/…`、`turn 开头的方法`。

### 9. ViewBuilder lambda 里必须显式取回 Pager

`ViewBuilder` 的接收者是 `ViewContainer`，不是 Pager。把视图片段抽成成员函数
返回 `ViewBuilder` 后，lambda 里直接写 `status` / `mode` 会报
*cannot be called in this context with an implicit receiver*。

```kotlin
// ❌ 这里的 this 是 ViewContainer，status/mode 解析不到
private fun statusCard(): ViewBuilder = { Text { attr { text(status) } } }

// ✅ lambda 开头显式取回 page
private fun statusCard(): ViewBuilder = {
    val page = this@AgentPage
    Text { attr { text(page.status) } }
}
```

---

## 验证命令

```bash
# 编译
./gradlew :shared:compileDebugKotlinAndroid

# 单测（改动纯逻辑后必跑）
./gradlew :shared:testDebugUnitTest

# Android Debug APK + 共享单测；不自动清理既有产物
./gradlew :androidApp:assembleDebug :shared:testDebugUnitTest --offline
```

迁移后的工程不携带旧 `build/`、`.gradle/`、`.kotlin/`。若遇跨根缓存错误，先记录真实路径与归属；仅在确认属于当前工程的生成缓存且获准清理后处理，不自动删除源项目或并发会话产物。

---

## 已知问题

- **KSP 页面注册遗漏**：KSP 增量编译可能遗漏非变更文件的页面注册。MainActivity 显式注册产品页面，新增 @Page 页面需同步核对；已删除的演示页不得重新注册。

---

*最后更新: 2026-10-23（同仓源码导入，运行验收待验证）*
