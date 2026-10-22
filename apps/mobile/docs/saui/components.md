# SaUI 组件 API 参考

> 26 个 SaUI 基础组件的完整 API 文档。部分概念由 Kuikly 原生组件直接覆盖，标注为"原生可用"。
> 聊天业务组件（`ChatMessageBubble` / `StreamingInputBar`）见 [overview.md](./overview.md)。

---

## 统一入口

```kotlin
import com.sa.demo.saui.SaUIComponents
import com.sa.demo.saui.SaUITokens
```

所有组件通过 `SaUIComponents.Xxx.build(...).invoke(this)` 或直接导入对应 object 调用。

---

## Token

### SaUIColors

| Token | 值 | 用途 |
|-------|-----|------|
| `BrandPrimary` | `#0052D9` | 品牌主色 |
| `BrandFocus` | `#ECF2FE` | 品牌浅底色 |
| `BgPage` | `#F5F5F5` | 页面背景 |
| `BgContainer` | `#FFFFFF` | 容器背景 |
| `BgComponent` | `#E7E7E7` | 组件默认背景 |
| `BgComponentActive` | `#DCDCDC` | 组件按下背景 |
| `TextPrimarySolid` | `#000000` | 主文字色 |
| `TextSecondarySolid` | `#999999` | 次要文字色 |
| `TextPlaceholderSolid` | `#BBBBBB` | 占位文字色 |
| `TextDisabledSolid` | `#DCDCDC` | 禁用文字色 |
| `TextAnti` | `#FFFFFF` | 反色文字（深底浅字） |
| `BorderLevel1` | `#E7E7E7` | 一级边框 |
| `Success` | `#2BA471` | 成功 |
| `SuccessLight` | `#E8F8F2` | 成功浅底色 |
| `Warning` | `#E37318` | 警告 |
| `WarningLight` | `#FEF3E6` | 警告浅底色 |
| `Error` | `#D54941` | 错误 |
| `ErrorLight` | `#FDECEE` | 错误浅底色 |
| `Overlay` | `#000000` | 遮罩 |

### SaUISpacing

| Token | 值 (px) |
|-------|---------|
| `xxs` | 2f |
| `xs` | 4f |
| `sm` | 8f |
| `md` | 12f |
| `lg` | 16f |
| `xl` | 20f |
| `xxl` | 24f |
| `xxxl` | 32f |
| `huge` | 48f |
| `massive` | 64f |

### SaUIRadius

| Token | 值 (px) |
|-------|---------|
| `Small` | 4f |
| `Medium` | 8f |
| `Large` | 12f |
| `ExtraLarge` | 16f |
| `Round` | 999f |
| `Circle` | 999f |

---

## Base 基础

### SaButton

```kotlin
SaButton.build(
    text: String,                                   // 按钮文字
    variant: Variant = Variant.PRIMARY,             // PRIMARY|PRIMARY_OUTLINE|SECONDARY|TEXT|DANGER|DANGER_OUTLINE
    size: ButtonSize = ButtonSize.MEDIUM,           // SMALL(32)|MEDIUM(40)|LARGE(48)
    disabled: Boolean = false,
    block: Boolean = false,                         // true=撑满父容器宽度
    icon: String? = null,                           // 图标字符，取 SaIcons 常量
    onClick: () -> Unit = {}
): ViewBuilder
```

**6 种变体 x 3 种尺寸 = 18 种组合**，每种自动计算 bg/text/border 颜色。

---

## Foundation 基础元素

### SaIcon

```kotlin
// Unicode 字符图标
SaIcon.buildChar(
    char: String,                                   // SaIcons.SEARCH 等
    size: Size = MD,                                // XS(16)|SM(20)|MD(24)|LG(32)|XL(48)
    tintColor: String = TextPrimarySolid            // 颜色 Token
): ViewBuilder

// 图片图标
SaIcon.buildSrc(
    src: String,                                    // 图片 URL
    size: Size = MD
): ViewBuilder
```

### SaIcons (49 个 Unicode 字符)

> `SaIcons` 与 `SaIcon` 同文件定义（`foundation/SaIcon.kt`），通过 `SaUIComponents.Icons.X` 访问。

| 类别 | 常量 |
|------|------|
| 方向 | `ARROW_RIGHT` `ARROW_LEFT` `ARROW_DOWN` `ARROW_UP` `CHEVRON_*` |
| 操作 | `CLOSE` `CHECK` `PLUS` `MINUS` `SEARCH` `EDIT` `DELETE` `REFRESH` `FILTER` `SORT` |
| 评星 | `STAR` `STAR_OUTLINE` `HEART` `HEART_OUTLINE` |
| 状态 | `INFO` `WARNING` `ERROR` `SUCCESS` |
| 用户 | `USER` `SETTINGS` `HOME` `BELL` `MENU` `MORE` |
| 媒体 | `CAMERA` `PHOTO` `PLAY` `PAUSE` `STOP` `MICROPHONE` `VOLUME` `VOLUME_OFF` |
| 其他 | `LOCATION` `PHONE` `MAIL` `LOCK` `UNLOCK` `EYE` `EYE_OFF` `CALENDAR` `CLOCK` `CHAT` `SHARE` `DOWNLOAD` `UPLOAD` |

### SaDivider

```kotlin
SaDivider.build(
    direction: Direction = HORIZONTAL,              // HORIZONTAL|VERTICAL
    text: String? = null,                           // 居中文字（横向时）
    inset: Float = 0f                               // 缩进
): ViewBuilder
```

### SaBadge

```kotlin
SaBadge.build(
    text: String? = null,                           // 计数值（字符串，如 "99+"）
    variant: Variant = COUNT,                       // DOT|COUNT
    maxCount: Int = 99                              // COUNT 溢出显示 "99+"
): ViewBuilder
```

---

## Form 表单

### SaInput

```kotlin
SaInput.build(
    placeholder: String = "请输入",                  // 占位文字
    value: String = "",
    label: String? = null,                          // 标签文字
    required: Boolean = false,                      // 红*标记
    maxLength: Int = 140,
    state: InputState = InputState.NORMAL,          // NORMAL|FOCUS|ERROR|DISABLED
    keyboardType: KeyboardType = KeyboardType.DEFAULT, // DEFAULT|PASSWORD|NUMBER|EMAIL
    errorMessage: String? = null,                   // 错误文案（state=ERROR 时展示）
    prefixIcon: String? = null,                     // 前缀图标
    suffixIcon: String? = null,                     // 后缀图标
    onTextChange: (String) -> Unit = {},
    onFocus: () -> Unit = {},
    onBlur: () -> Unit = {}
): ViewBuilder
```

**4 种状态**：NORMAL (BgComponent 边框) / FOCUS (BrandPrimary 边框) / ERROR (Error 边框 + 错误文案) / DISABLED (TextDisabledSolid 边框)。

### SaSearchBar

```kotlin
SaSearchBar.build(
    placeholder: String = "搜索",
    value: String = "",
    shape: Shape = CAPSULE,                         // ROUNDED|CAPSULE
    showCancel: Boolean = false,
    onTextChange: (String) -> Unit = {},
    onSearch: (String) -> Unit = {},                // 回车触发
    onCancel: () -> Unit = {},
    onClear: () -> Unit = {}
): ViewBuilder
```

**基于 Kuikly Input 组件**，支持真实的文字输入和键盘事件。

### SaCheckBox

```kotlin
SaCheckBox.build(
    label: String = "",                             // 显示文字
    checked: Boolean = false,
    size: CheckBoxSize = MEDIUM,                    // SMALL(18)|MEDIUM(22)|LARGE(26)
    disabled: Boolean = false,                      // 禁用态 label 变灰
    onCheckedChanged: (Boolean) -> Unit = {}
): ViewBuilder
```

**Row + CheckBox + Text 布局**，比原生 CheckBox 增加了 label 能力。

### SaRadio / SaRadioGroup

```kotlin
// 单选项
SaRadio.build(
    label: String,
    selected: Boolean = false,
    size: Size = MEDIUM,                            // SMALL(16)|MEDIUM(20)|LARGE(24)
    disabled: Boolean = false,
    onClick: () -> Unit = {}
): ViewBuilder

// 选项组
SaRadioGroup.build(
    options: List<RadioOption>,                     // RadioOption(label, value)
    selectedValue: String,
    direction: String = "vertical",                 // "horizontal" 横向排列
    disabled: Boolean = false,
    onSelect: (String) -> Unit = {}                 // 返回选中的 value
): ViewBuilder
```

**自建组件**（Kuikly 无原生 Radio），基于 View 绘制圆点 + 选中态内圈。

### SaStepper

```kotlin
SaStepper.build(
    value: Int = 0,
    min: Int = 0,
    max: Int = 99,
    step: Int = 1,
    disabled: Boolean = false,
    onChange: (Int) -> Unit = {}
): ViewBuilder
```

**自建组件**，View + Text(-/+/值) 布局，边界自动禁用。

---

## Data 数据展示

### SaAvatar

```kotlin
// 图片头像
SaAvatar.buildSrc(src: String, size: AvatarSize = MD, shape: Shape = CIRCLE): ViewBuilder

// 文字头像 (取前 2 字符)
SaAvatar.buildText(text: String, backgroundColor: String = BrandPrimary, size: AvatarSize = MD): ViewBuilder

// 图标头像
SaAvatar.buildIcon(icon: String, backgroundColor: String = BrandPrimary, size: AvatarSize = MD): ViewBuilder
```

**6 种尺寸**：XS(24)/SM(32)/MD(40)/LG(48)/XL(64)/XXL(96)，**2 种形状**：CIRCLE/ROUNDED。

### SaCell

```kotlin
// 单元格
SaCell.build(
    title: String,
    subtitle: String? = null,
    leftIcon: String? = null,                       // 左侧图标字符，取 SaIcons 常量
    rightText: String? = null,
    showArrow: Boolean = true,
    dividerInset: Float = SaUISpacing.lg,           // 分割线左侧缩进
    onClick: () -> Unit = {}
): ViewBuilder

// 分组容器
SaCell.buildGroup(
    cells: List<CellData>,
    dividerInset: Float = SaUISpacing.lg
): ViewBuilder
```

**Row 布局**：左图标 + 标题/副标题 + 右文本/箭头，48px 高度。`buildGroup` 提供圆角白色背景 + 分割线。

### SaTag

```kotlin
SaTag.build(
    text: String,
    variant: Variant = DEFAULT,                     // DEFAULT|PRIMARY|SUCCESS|WARNING|DANGER
    size: TagSize = MEDIUM,                         // SMALL(20)|MEDIUM(24)|LARGE(28)
    closable: Boolean = false,
    onClose: () -> Unit = {}
): ViewBuilder
```

**5 色 x 3 尺寸**，可选关闭按钮。

### SaCollapse

```kotlin
SaCollapse.build(
    panels: List<Panel>,                            // Panel(header, content, disabled?)
    expandedIndex: Int? = null,                     // null = 全部折叠
    onExpandedChange: (Int?) -> Unit = {}           // null = 用户折叠了当前项
): ViewBuilder
```

**手风琴模式**（同一时刻只能展开一项），点击 header 展开/折叠 content。禁用项不可展开。

---

## Feedback 反馈

### SaLoading

```kotlin
SaLoading.build(
    message: String = "加载中...",
    variant: Variant = CIRCLE,                      // CIRCLE(ActivityIndicator)|DOTS(静态条)
    overlay: Boolean = false                        // 全屏遮罩模式
): ViewBuilder
```

CIRCLE 使用 Kuikly `ActivityIndicator` 原生组件。

### SaToast

```kotlin
SaToast.build(
    message: String,
    type: Type = INFO,                              // SUCCESS|ERROR|WARNING|INFO|LOADING
    duration: Int = 2000,                           // ms（暂由外部 visible 控制）
    visible: Boolean = true                         // 控制显隐
): ViewBuilder
```

绝对定位居中显示，5 种类型各映射不同 Unicode 图标。

### SaEmpty

```kotlin
SaEmpty.build(
    message: String,
    subMessage: String = "",
    iconType: IconType = EMPTY,                     // 6 种类型
    actionText: String? = null,
    onAction: () -> Unit = {}
): ViewBuilder
```

**完整结构**：80x80 圆形图标容器 + 主消息 + 副消息 + 可选操作按钮。

### SaProgress

```kotlin
SaProgress.build(
    percentage: Float = 0f,                         // 0-100
    variant: Variant = LINE,                        // LINE|CIRCLE
    status: Status = DEFAULT,                       // DEFAULT|SUCCESS|ERROR|WARNING
    strokeWidth: Float = 6f
): ViewBuilder
```

### SaResult

```kotlin
SaResult.build(
    variant: Variant = INFO,                        // SUCCESS|ERROR|WARNING|INFO|EMPTY
    title: String,
    description: String = "",
    actionText: String? = null,
    onAction: () -> Unit = {}
): ViewBuilder
```

### SaRate

```kotlin
SaRate.build(
    value: Int = 0,
    max: Int = 5,
    size: Float = 24f,                              // 星标字号
    disabled: Boolean = false,
    onChange: (Int) -> Unit = {}
): ViewBuilder
```

### SaNoticeBar

```kotlin
SaNoticeBar.build(
    text: String,
    variant: Variant = INFO,                        // INFO|SUCCESS|WARNING|ERROR
    prefixIcon: Boolean = true,
    closable: Boolean = false,
    onClose: (() -> Unit)? = null
): ViewBuilder
```

4 种语义色（bg + text 配对）。

### SaSkeleton

```kotlin
SaSkeleton.build(
    variant: Variant = RECT,                        // RECT|CIRCLE|TEXT|CARD
    width: Float = 200f,
    height: Float = 16f,
    count: Int = 1,                                 // 重复数量
    animated: Boolean = true                        // 预留参数（暂不生效）
): ViewBuilder
```

### SaPopup

```kotlin
SaPopup.build(
    visible: Boolean,
    placement: Placement = BOTTOM,                  // BOTTOM|TOP|CENTER|LEFT|RIGHT
    title: String? = null,
    onClose: () -> Unit = {},
    content: ViewBuilder
): ViewBuilder
```

**自建遮罩 + 绝对定位**，背景半透明覆盖层，点击 mask 关闭，点击内容区不关闭。

### SaDrawer

```kotlin
SaDrawer.build(
    visible: Boolean,
    placement: Placement = RIGHT,                   // LEFT|RIGHT
    header: String? = null,
    onClose: () -> Unit = {},
    content: ViewBuilder
): ViewBuilder
```

---

## Navigation 导航

### SaNavbar

```kotlin
SaNavbar.build(
    title: String,
    leftIcon: String = SaIcons.ARROW_LEFT,
    onLeftClick: (() -> Unit)? = null,
    rightText: String? = null,
    onRightClick: (() -> Unit)? = null
): ViewBuilder
```

44px 高，三区域布局：左返回箭头 + 居中标题 + 右操作文本。

### SaTabBar

```kotlin
SaTabBar.build(
    items: List<TabItem>,                           // TabItem(key, label, icon)
    selectedKey: String,
    onSelect: (String) -> Unit = {}
): ViewBuilder
```

56px 高，底部固定，品牌蓝选中态。

### SaSteps

```kotlin
SaSteps.build(
    steps: List<Step>,                              // Step(label, description?)
    current: Int = 0,
    direction: Direction = HORIZONTAL               // HORIZONTAL|VERTICAL
): ViewBuilder
```

编号圆点 + 连接线，completed 显示 ✓，current 蓝色实心，pending 灰色。

---

## Chat 业务组件

> 聊天场景专用组合组件，Kuikly 原生无对应能力。签名见源码 `saui/chat/`。

### ChatMessageBubble

```kotlin
ChatMessageBubble.build(
    content: String,                                // 消息正文，支持 ``` 围栏代码块
    role: Role,                                     // Role.USER | Role.ASSISTANT
    streaming: Boolean = false,                     // true=显示流式光标 ▍
    onCopy: (() -> Unit)? = null,                   // 传入则长按气泡复制
    onRetry: (() -> Unit)? = null                   // 传入则渲染「重试」入口
): ViewBuilder
```

USER 右对齐、品牌蓝底、白字；ASSISTANT 左对齐、灰底、深字。代码块用等宽字体 + 深色底。

交互均为**可选**，不传回调则不绑定手势、不渲染按钮：
- 传入 `onCopy` → 长按气泡触发复制（移动端聊天通用手势）
- 传入 `onRetry` → 气泡下方渲染「重试」入口（`RETRY_LABEL` 可替换文案）

正文解析走 [`MdParser`](#mdparser)（纯函数，有单测覆盖）。

### MdParser

```kotlin
MdParser.parse(content: String): List<MdBlock>      // MdBlock.Text(text) | MdBlock.Code(code)
```

只识别 ``` 围栏代码块，其余非空行按正文。兼容 CRLF；流式下末尾 ``` 未闭合时，已缓存代码仍会输出。

### 平台能力

聊天页用到两项平台能力，均走 `core/platform` 的 expect/actual 桥（非 Kuikly Module）：

| 能力 | 签名 | Android | 鸿蒙 |
|---|---|---|---|
| 剪贴板 | `copyToClipboard(label, text): Boolean` | `ClipboardManager` | M4 接入（返回 false） |
| 中断流式 | `CancelToken` + `httpStreamSse(request, token, onLine)` | `disconnect()` 打断阻塞读 | M4 接入 |

「重试」由 `RetryRewind.rewind()` 回退会话尾部（助手轮 + 用户轮）后重发，
避免「用户停止」路径把 user 轮追加两次——该逻辑有单测覆盖。

### StreamingInputBar

```kotlin
StreamingInputBar.build(
    draft: String,
    busy: Boolean,                                  // true=发送键变 ⏹ 停止
    useStream: Boolean,
    selectedModel: String,
    models: List<String>,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: (() -> Unit)? = null,
    onModelSelect: ((String) -> Unit)? = null,
    onToggleStream: ((Boolean) -> Unit)? = null,
    modelPickerOpen: Boolean = false,               // 模型下拉是否展开
    onToggleModelPicker: (() -> Unit)? = null       // 为 null 时点击模型按钮退化为轮询切换
): ViewBuilder
```

组件本身无内部状态（Kuikly 约定），展开态由调用方用 `observable` 持有并回传。

`onStop` 在 `busy=true` 时由 ⏹ 按钮触发。真实页面（`ChatPage`）据此中断 SSE：
`CancelToken.cancel()` → Android 侧 `HttpURLConnection.disconnect()` 打断阻塞读 →
读取循环静默退出并返回**已生成的部分内容**（不丢弃已消耗的 token），标记为「已停止」而非「完成」。

---

## Kuikly 原生可用组件（无需封装）

| 概念 | Kuikly API | 备注 |
|------|-----------|------|
| Switch 开关 | `Switch { attr { isOn(...); onColor(...) } }` | 直接使用 |
| Dialog 对话框 | `AlertDialog { attr { title(...); message(...); actionButtons(...) } }` | 已移除 SaDialog 薄包装 |
| Slider 滑块 | `Slider { attr { ... } }` | 直接使用 |
| TextArea 多行输入 | `TextArea { attr { ... } }` | 直接使用 |
| DatePicker 日期选择 | `DatePicker { attr { ... } }` | 直接使用 |
| ScrollPicker 滚动选择 | `ScrollPicker { attr { ... } }` | 直接使用 |
| ActionSheet 操作表 | `ActionSheet { attr { ... } }` | 直接使用 |
| Tabs 标签页 | `Tabs { attr { ... } }` | 直接使用 |
| Refresh 下拉刷新 | `Refresh { attr { ... } }` | 直接使用 |
| SliderPage 轮播 | `SliderPage { attr { ... } }` | 直接使用 |
| Mask 遮罩 | `Mask { attr { ... } }` | 直接使用 |
| Hover 吸顶 | `Hover { attr { ... } }` | 直接使用 |
| ActivityIndicator | `ActivityIndicator { attr { ... } }` | SaLoading CIRCLE 内部使用 |
| Modal 模态 | `Modal { attr { ... } }` | 不推荐（API 受限），用 SaPopup/SaDrawer 替代 |
