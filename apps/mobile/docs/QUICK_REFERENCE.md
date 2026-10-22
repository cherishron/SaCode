# KuiklyUI 快速参考卡片

> 开发时的快速查阅手册，打印出来放在手边！

---

## 🔥 铁律：永不简化

```
❌ 禁止：Button → View 替代
❌ 禁止：页面简化为空/单行 Text
❌ 禁止：删除报错属性/组件
❌ 禁止：凭记忆编写 Kuikly 代码

✅ 必须：查文档确认正确 API
✅ 必须：按设计稿完整实现
✅ 必须：使用 KuiklyUI AI Skills
```

---

## 📝 基础语法模板

### Pager 页面

```kotlin
@Page("routeName")
class MyPage : Pager() {
    override fun body(): ViewBuilder = {
        Column {
            attr {
                backgroundColor(Color.WHITE)
                flex(1f)
            }
            // 子组件
        }
    }
}
```

### Text 文本

```kotlin
Text {
    attr {
        text("Hello")
        fontSize(16f)
        color(Color.BLACK)
        fontWeightBold()
    }
}
```

### Button 按钮 ⭐

```kotlin
Button {
    attr {
        size(200f, 44f)
        backgroundColor(Color.BLUE)
        borderRadius(22f)
        titleAttr {              // ⚠️ 必须在 attr 内
            text("登录")
            color(Color.WHITE)
            fontSize(16f)
        }
    }
    event {
        click {                  // ⚠️ 必须在 event 内
            println("clicked")
        }
    }
}
```

### Image 图片

```kotlin
Image {
    attr {
        size(100f, 100f)
        src("https://example.com/image.png")
        borderRadius(8f)
    }
}
```

### Column 列容器

```kotlin
Column {
    attr {
        flex(1f)
        padding(16f)
        backgroundColor(Color.WHITE)
    }
    // 子组件
}
```

### Row 行容器

```kotlin
Row {
    attr {
        width(100f)
        height(50f)
        justifyContent(FlexJustifyContent.SPACE_BETWEEN)
    }
    // 子组件
}
```

---

## ⚠️ 常见错误

### 错误 1: onClick 在 attr 内

```kotlin
❌ Button {
    attr {
        onClick { }  // 错误！
    }
}

✅ Button {
    event {
        click { }    // 正确！
    }
}
```

### 错误 2: titleAttr 在 attr 外

```kotlin
❌ Button {
    attr { }
    titleAttr { }    // 错误！
}

✅ Button {
    attr {
        titleAttr { }  // 正确！
    }
}
```

### 错误 3: 属性赋值语法

```kotlin
❌ Text {
    attr {
        text = "Hello"  // 错误！
    }
}

✅ Text {
    attr {
        text("Hello")   // 正确！
    }
}
```

### 错误 4: 颜色类型错误

```kotlin
❌ backgroundColor(Color.parseString16ToLong("#07C160"))  // 返回 Long

✅ backgroundColor(Color(0xFF07C160))  // 返回 Color
```

---

## 🎨 常用颜色

```kotlin
// 系统颜色
Color.WHITE       // 白色
Color.BLACK       // 黑色
Color.RED         // 红色
Color.GREEN       // 绿色
Color.BLUE        // 蓝色
Color.GRAY        // 灰色
Color.TRANSPARENT // 透明

// 自定义颜色
Color(0xFF07C160)     // 微信绿
Color(0xFF1890FF)     // 蓝色
Color(0xFFFA5151)     // 红色
```

---

## 📐 常用布局

### 居中

```kotlin
attr {
    allCenter()  // 水平+垂直居中
}
```

### Flex 布局

```kotlin
attr {
    flex(1f)                              // 弹性比例
    flexDirectionColumn()                 // 垂直排列
    flexDirectionRow()                    // 水平排列
    justifyContent(FlexJustifyContent.CENTER)  // 主轴居中
    alignItemsCenter()                    // 交叉轴居中
}
```

### 尺寸

```kotlin
attr {
    size(100f, 50f)      // 宽高
    width(100f)          // 宽度
    height(50f)          // 高度
    padding(16f)         // 内边距
    margin(8f)           // 外边距
}
```

---

## 🔗 快速链接

| 资源 | 链接 |
|------|------|
| 本地文档索引 | `docs/index.md` |
| DSL 陷阱 | `docs/kuikly-dsl-gotchas.md` |
| 开发规则 | `AGENTS.md` |
| 官方 API | https://kuikly.tds.qq.com/API/components/ |
| 基础属性 | https://kuikly.tds.qq.com/API/components/basic-attr-event.html |

---

## 🚀 开发流程

```
1. 激活 KuiklyUI AI Skill
   ↓
2. 查阅文档 (本地 → 官网 → GitHub)
   ↓
3. 验证 API 存在性
   ↓
4. 编写代码 (严格复制语法)
   ↓
5. 遇到错误 → kuikly-dsl-gotchas.md
```

---

*打印此文档，放在手边随时查阅！*
