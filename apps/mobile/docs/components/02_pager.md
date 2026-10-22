# Pager（页面入口）

`Pager` 是 KuiklyUI 框架的核心页面入口类，类似于 Android 的 `Activity` 和 iOS 的 `ViewController`。

## 类概述

```kotlin
abstract class Pager : ComposeView<ComposeAttr, ComposeEvent>(), IPager
```

## 必需实现的方法

### body()

**必须实现**。返回页面的 UI 构建器，定义页面的视图结构。

```kotlin
override fun body(): ViewBuilder {
    return {
        attr {
            backgroundColor(Color.WHITE)
        }
        Text {
            attr {
                text("Hello Kuikly")
            }
        }
    }
}
```

## 生命周期方法

### created()

body 创建前调用，可用于初始化页面状态和数据。

```kotlin
override fun created() {
    super.created()
    loadData()
}
```

### pageDidAppear()

页面可见时回调��类似 Android 的 onResume 或 iOS 的 viewDidAppear）。

```kotlin
override fun pageDidAppear() {
    super.pageDidAppear()
    // 页面可见时的逻辑
}
```

### pageDidDisappear()

页面不可见时回调（类似 Android 的 onPause 或 iOS 的 viewDidDisappear）。

```kotlin
override fun pageDidDisappear() {
    super.pageDidDisappear()
    // 页面不可见时的逻辑
}
```

## 属性

| 属性 | 说明 | 类型 |
|------|------|------|
| pageData | 页面数据对象 | JSONObject |
| pageName | 页面名称 | String |
| lifecycleScope | 生命周期作用域 | LifecycleScope |
| isAppeared | 页面是否已显示 | Boolean |

## 示例

```kotlin
@Page("LoginPage")
class LoginPage : Pager() {
    
    override fun body(): ViewBuilder = {
        Column {
            attr {
                allCenter()
                backgroundColor(Color.WHITE)
            }
            
            Text {
                attr {
                    text("SaUI Demo")
                    fontSize(24f)
                    color(Color.BLACK)
                }
            }
        }
    }
}
```