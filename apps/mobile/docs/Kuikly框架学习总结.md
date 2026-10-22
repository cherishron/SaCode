# Kuikly 框架完整学习总结

## 一、框架概述

### 1.1 什么是 Kuikly

Kuikly 是腾讯开源的**基于 Kotlin MultiPlatform (KMP) 构建的跨端开发框架**，具有以下核心特点：

- **跨平台能力**：支持 Android、iOS、鸿蒙、H5、微信小程序
- **高性能**：利用 KMP 逻辑跨平台能力，抽象出通用的跨平台 UI 渲染接口，复用平台的 UI 组件
- **轻量级**：Android 包增量仅 0.3m，iOS framework 1.2m 或 JS 0.3m
- **可动态化**：支持动态下发和热更新

### 1.2 两种开发模式

#### 标准 Kuikly DSL（稳定版）
```kotlin
@Page("demo_page")
internal class MyPage : BasePager() {
    override fun body(): ViewBuilder {
        return {
            View {
                attr {
                    size(100f, 100f)
                    backgroundColor(Color.GREEN)
                    borderRadius(20f)
                }
                event {
                    click { params ->
                        // 处理点击事件
                    }
                }
            }
        }
    }
}
```

#### Compose DSL
```kotlin
@Composable
fun MyScreen() {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(text = "Hello Kuikly", fontSize = 20.sp, color = Color.Blue)
        Button(onClick = { /* 处理点击 */ }) {
            Text("点击我")
        }
    }
}
```

---

## 二、核心 API 列表及其用途

### 2.1 响应式系统

| API | 用途 | 示例 |
|-----|------|------|
| `observable()` | 声明响应式单值 | `var count by observable(0)` |
| `observableList()` | 声明响应式列表（配合 vfor） | `var items by observableList<String>()` |
| `observableSet()` | 声明响应式集合 | `var tags by observableSet<String>()` |
| `diffUpdate()` | 高效更新列表（基于 Myers diff 算法） | `list.diffUpdate(newData)` |

**重要规则**：
- vfor 循环的 List **必须**使用 `observableList`，不能用 `observable`
- `observable` 内部使用 `==` 比较新旧值，相等时不触发更新

### 2.2 指令系统

| 指令 | 用途 | 示例 |
|------|------|------|
| `vfor()` | 循环渲染 | `vfor({ ctx.list }) { item -> ... }` |
| `vforIndex()` | 循环渲染（带索引） | `vforIndex({ ctx.list }) { item, index, count -> ... }` |
| `vforLazy()` | 超大列表懒加载 | `vforLazy({ ctx.list }, maxLoadItem = 50) { ... }` |
| `vif()` | 条件渲染 | `vif({ ctx.state == 1 }) { ... }` |
| `velseif()` | 条件分支 | `velseif({ ctx.state == 2 }) { ... }` |
| `velse` | 默认分支 | `velse { ... }` |
| `vbind()` | 值绑定渲染 | `vbind({ ctx.state }) { when (ctx.state) { ... } }` |

**重要规则**：
- vfor 必须传闭包 `{ ctx.list }`，不能直接传值 `ctx.list`
- vfor 闭包必须且仅生成一个根节点
- vforLazy 仅限 ListView 中使用
- velseif/velse 必须紧跟 vif 或 velseif

### 2.3 布局系统

Kuikly 使用 **FlexBox 布局**作为跨平台布局规则。

#### 核心布局属性

| 属性 | 说明 | 枚举值 |
|------|------|--------|
| `flexDirection` | 主轴方向 | COLUMN, ROW, COLUMN_REVERSE, ROW_REVERSE |
| `justifyContent` | 主轴对齐 | FLEX_START, CENTER, FLEX_END, SPACE_BETWEEN, SPACE_AROUND, SPACE_EVENLY |
| `alignItems` | 交叉轴对齐 | FLEX_START, CENTER, FLEX_END, STRETCH |
| `flexWrap` | 是否换行 | NOWRAP, WRAP |
| `positionType` | 定位类型 | RELATIVE, ABSOLUTE |

#### 尺寸控制

| 属性 | 说明 |
|------|------|
| `width()` / `height()` | 固定尺寸 |
| `flex()` | 弹性比例 |
| `maxWidth()` / `maxHeight()` | 最大尺寸 |
| `minWidth()` / `minHeight()` | 最小尺寸 |
| `margin()` / `padding()` | 外边距/内边距 |

### 2.4 动画系统

#### Animation 对象创建

```kotlin
// 基础曲线
Animation.linear(durationS, key = "")        // 线性
Animation.easeIn(durationS, key = "")        // 先慢后快
Animation.easeOut(durationS, key = "")       // 先快后慢
Animation.easeInOut(durationS, key = "")     // 两端慢中间快

// 弹簧曲线
Animation.springLinear(durationS, damping, velocity, key = "")
Animation.springEaseIn(durationS, damping, velocity, key = "")
Animation.springEaseOut(durationS, damping, velocity, key = "")
Animation.springEaseInOut(durationS, damping, velocity, key = "")
```

#### Transform 类型

| 类 | 构造参数 | 说明 |
|----|---------|------|
| `Translate(percentageX, percentageY)` | X/Y 位移百分比 | 位移 |
| `Scale(x, y)` | 缩放比例 | 缩放 |
| `Rotate(angle)` | 角度 | 2D 旋转 |
| `Rotate(angle, xAngle, yAngle)` | 各轴角度 | 3D 旋转 |
| `Skew(horizontalAngle, verticalAngle)` | 倾斜角度 | 倾斜 |
| `Anchor(x, y)` | 锚点 [0, 1] | transform 中心点 |

#### 声明式动画

```kotlin
var flag by observable(false)

View {
    attr {
        size(100f, 100f)
        backgroundColor(if (ctx.flag) Color.GREEN else Color.RED)
        animate(Animation.linear(0.5f), ctx.flag)
    }
}

// 触发动画
flag = true
```

#### 命令式动画

```kotlin
var viewRef: ViewRef<DivView>? = null

View {
    ref { ctx.viewRef = it }
    attr { size(100f, 100f); backgroundColor(Color.RED) }
}

// 触发动画
viewRef?.view?.animateToAttr(Animation.linear(0.5f), attrBlock = {
    backgroundColor(Color.GREEN)
}, completion = { finished ->
    // finished: true=完成, false=被取消
})
```

### 2.5 网络请求

```kotlin
val network = acquireModule<NetworkModule>(NetworkModule.MODULE_NAME)

// GET 请求
network.requestGet("https://api.example.com/data", JSONObject()) { data, success, errorMsg, response ->
    if (success) {
        val result = data.optString("result")
    }
}

// POST 请求
network.requestPost("https://api.example.com/submit", JSONObject().put("key", "value")) { ... }

// 通用请求（自定义 headers / cookie / timeout）
network.httpRequest(
    url = "https://api.example.com/data",
    isPost = true,
    param = JSONObject().put("key", "value"),
    headers = JSONObject().put("Content-Type", "application/json"),
    cookie = "session=abc123",
    timeout = 30
) { ... }

// 二进制请求
network.requestPostBinary("https://api.example.com/upload", byteArray) { ... }
network.requestGetBinary("https://api.example.com/file", JSONObject()) { ... }
```

### 2.6 内置模块

| 模块 | 用途 | 主要方法 |
|------|------|---------|
| `RouterModule` | 页面路由 | `openPage()`, `closePage()` |
| `NetworkModule` | 网络请求 | `requestGet()`, `requestPost()`, `httpRequest()` |
| `SharedPreferencesModule` | 本地存储 | `setString()`, `getString()`, `setInt()`, `getInt()` |
| `NotifyModule` | 事件通知 | `addNotify()`, `postNotify()`, `removeNotify()` |
| `CalendarModule` | 日历操作 | `newCalendarInstance()`, `formatTime()` |
| `CodecModule` | 编解码 | `urlEncode()`, `base64Encode()`, `md5()`, `sha256()` |
| `SnapshotModule` | 页面截图 | `snapshotPager()` |
| `MemoryCacheModule` | 内存缓存 | `setObject()`, `cacheImage()` |
| `PerformanceModule` | 性能监控 | `getPerformanceData()` |

---

## 三、常用组件及其属性/方法

### 3.1 基础容器与文本

#### View（容器）
- 基础容器组件，支持嵌套、背景图、触摸事件
- iOS 26+ 液态玻璃效果

#### Text（文本）
- 文本显示、字体样式、行数限制、对齐方式
- 文本装饰（下划线、删除线）、阴影、溢出处理

### 3.2 列表与滚动

| 组件 | 用途 |
|------|------|
| `List` | 垂直/水平滚动列表，配合 vfor 循环使用 |
| `Scroller` | 自由滚动容器，支持 setContentOffset |
| `WaterfallList` | 瀑布流布局列表 |
| `PageList` | 带分页功能的列表容器 |

### 3.3 输入与交互

| 组件 | 用途 |
|------|------|
| `Input` | 文本输入、密码输入、数字输入 |
| `TextArea` | 多行文本输入框 |
| `Button` | 可点击按钮组件 |
| `Checkbox` | 复选框选择组件 |
| `Switch` | 开关切换组件 |
| `Slider` | 滑动选择器 |

### 3.4 媒体与图形

| 组件 | 用途 |
|------|------|
| `Image` | 网络图片、本地图片、Base64 图片 |
| `Video` | 视频播放组件 |
| `Canvas` | 2D 绘图能力 |
| `APNG` | APNG 动画图片播放 |
| `PAG` | PAG 动画播放 |

### 3.5 弹窗与选择器

| 组件 | 用途 |
|------|------|
| `Modal` | 模态弹窗容器 |
| `AlertDialog` | 系统风格警告弹窗 |
| `ActionSheet` | 底部弹出选择菜单 |
| `DatePicker` | 日期时间选择 |
| `ScrollPicker` | 滚动选择器 |

### 3.6 高级布局与效果

| 组件 | 用途 |
|------|------|
| `Tabs` | 标签页切换 |
| `SliderPage` | 轮播图组件 |
| `Refresh` | 下拉刷新容器 |
| `FooterRefresh` | 上拉加载更多 |
| `Blur` | 高斯模糊效果 |
| `Mask` | 遮罩层 |
| `RichText` | HTML 富文本渲染 |

---

## 四、典型代码模式

### 4.1 页面定义

```kotlin
@Page("my_page")
internal class MyPage : BasePager() {
    
    // 响应式状态
    var count by observable(0)
    var items by observableList<String>()
    
    override fun body(): ViewBuilder {
        val ctx = this
        return {
            View {
                attr {
                    flex(1f)
                    flexDirection(FlexDirection.COLUMN)
                }
                
                // 内容...
            }
        }
    }
}
```

### 4.2 列表渲染

```kotlin
List {
    attr { flex(1f) }
    vfor({ ctx.items }) { item ->
        View {
            attr {
                height(60f)
                widthPercent(100f)
            }
            Text { attr { text(item) } }
        }
    }
}
```

### 4.3 条件渲染

```kotlin
View {
    vif({ ctx.state == 1 }) {
        Text { attr { text("状态1") } }
    }
    velseif({ ctx.state == 2 }) {
        View { attr { backgroundColor(Color.GREEN) } }
    }
    velse {
        Text { attr { text("其他状态") } }
    }
}
```

### 4.4 事件处理

```kotlin
View {
    attr {
        size(100f, 100f)
        backgroundColor(Color.GREEN)
    }
    event {
        click { params ->
            // 处理点击
        }
        longPress {
            // 处理长按
        }
    }
}
```

### 4.5 可见性事件（曝光上报）

```kotlin
View {
    event {
        didAppear {
            // 组件完全可见，执行曝光上报
        }
        willDisappear {
            // 组件将要不可见
        }
        appearPercentage { percentage01 ->
            // percentage01 为 [0,1] 的露出百分比
        }
    }
}
```

### 4.6 自定义组件

```kotlin
// Kuikly 侧定义
class MyImageView : DeclarativeBaseView<MyImageAttr, MyImageEvent>() {
    override fun createAttr() = MyImageAttr()
    override fun createEvent() = MyImageEvent()
    override fun viewName() = "HRImageView"
}

class MyImageAttr : Attr() {
    fun src(src: String): MyImageAttr {
        "src" with src
        return this
    }
}

// 声明式 API
fun ViewContainer<*, *>.MyImage(init: MyImageView.() -> Unit) {
    addChild(MyImageView(), init)
}
```

### 4.7 自定义模块

```kotlin
// Kuikly 侧定义
class MyLogModule : Module() {
    override fun moduleName() = "KRMyLogModule"
    
    fun log(content: String) {
        asyncToNativeMethod("log", JSONObject().put("content", content), null)
    }
}

// 注册
override fun createExternalModules(): Map<String, Module>? {
    return mapOf(MyLogModule.MODULE_NAME to MyLogModule())
}

// 使用
val myLogModule = acquireModule<MyLogModule>(MyLogModule.MODULE_NAME)
myLogModule.log("test log")
```

---

## 五、重要注意事项

### 5.1 响应式系统陷阱

| 错误做法 | 正确做法 |
|---------|---------|
| 提前取值到普通变量 | 在 attr 闭包中直接引用响应式字段 |
| 修改对象内部属性期望触发更新 | 整体替换 observable 字段，或让对象内部字段也声明为 observable |
| vfor 直接传值 `vfor(ctx.list)` | vfor 传闭包 `vfor({ ctx.list })` |
| vfor 闭包内生成多个根节点 | 用 View 包裹多个子节点 |
| observable 赋相同值期望触发更新 | 确保新值与旧值不相等 |

### 5.2 线程安全

- **Kuikly UI 操作只能在 Kuikly 线程调用**
- 异步任务完成后必须回到 Kuikly 线程才能更新 UI
- 动态化场景不支持 kotlinx 协程，只能使用 Module 机制或 Kuikly 内建协程

### 5.3 自定义扩展

- **组件名必须全端一致**：Kuikly 侧 `viewName()` 返回值必须与 Native 侧注册名完全一致
- **Module 名必须全端一致**：Kuikly 侧 `moduleName()` 返回值必须与 Native 侧注册名完全一致
- 自定义 View 必须显式设置宽高，否则可能不显示
- iOS 侧类名必须与 viewName/moduleName 一致（运行时动态创建）

### 5.4 Compose DSL 混用

- **仅支持 Compose DSL 中混用 Kuikly DSL**，不支持反向混用
- 使用 `MakeKuiklyComposeNode` API 桥接
- 原子组件用 `DeclarativeBaseView`，容器组件用 `ViewContainer`
- **禁止将 ComposeView 子类传入 factory**（会导致视图不可见）

### 5.5 多模块配置

- 子模块中有 `@Page` 页面才需要多模块设置
- `moduleId` 必须唯一，否则 KSP 生成的入口类会冲突
- `isMainModule`：主模块为 true，子模块为 false
- `subModules` 只在主模块配置，子模块不需要
- 子模块不能单独编译，必须通过主模块编译

---

## 六、资源文件管理

### 6.1 目录结构

```
shared/src/commonMain/
├── assets/
│   ├── MyPage/            # MyPage 页面资源（推荐）
│   │   ├── banner.png
│   │   └── icon.png
│   └── common/            # 公共资源（多页面共享）
│       └── logo.png
└── kotlin/
```

### 6.2 ImageUri API

```kotlin
// 页面 assets 资源（最常用）
ImageUri.pageAssets("banner.png")

// 公共 assets 资源
ImageUri.commonAssets("logo.png")

// 本地文件路径
ImageUri.file("/path/to/image.png")
```

---

## 七、调试与优化

### 7.1 线程安全验证

```kotlin
override fun willInit() {
    super.willInit()
    Pager.VERIFY_THREAD = true              // 开启线程校验
    Pager.VERIFY_REACTIVE_OBSERVER = true   // 开启 observable 校验
}
```

### 7.2 性能优化

- 使用 `vforLazy` 处理超大列表
- 使用 `diffUpdate` 高效更新列表
- 使用 `SnapshotModule` 实现首屏快照

---

## 八、官方资源

- **官方文档**：https://kuikly.tds.qq.com/DevGuide/
- **GitHub**：https://github.com/Tencent-TDS/Kuikly

---

这份学习总结涵盖了 Kuikly 框架的核心概念、主要 API、常用组件、典型代码模式和重要注意事项。在开发工作中，请参考这份总结来准确使用正确的方法名和 API。
