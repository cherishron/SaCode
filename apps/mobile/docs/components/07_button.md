# Button（按钮）

按钮组件

## 属性

### titleAttr

设置按钮文本

```kotlin
Button {
    titleAttr {
        text("登录")
        fontSize(16f)
        color(Color.WHITE)
    }
}
```

### imageAttr

设置按钮图标

```kotlin
Button {
    imageAttr {
        src("assets://icon.png")
        size(20f, 20f)
    }
}
```

### highlightBackgroundColor

设置按下态颜色

```kotlin
Button {
    attr {
        backgroundColor(Color.BLUE)
        highlightBackgroundColor(Color.DKGRAY)
    }
    titleAttr {
        text("按钮")
    }
}
```

### flexDirection

图标和文本排列方向

```kotlin
Button {
    attr {
        flexDirectionRow()  // 水平排列
    }
    imageAttr { src("icon.png") }
    titleAttr { text("文本") }
}
```

## 事件

### click

点击事件

```kotlin
Button {
    titleAttr { text("点击我") }
    event {
        click {
            android.util.Log.d("Button", "按钮被点击")
        }
    }
}
```

## 示例

```kotlin
@Page("ButtonDemo")
class ButtonDemo : Pager() {
    override fun body(): ViewBuilder = {
        Column {
            attr {
                allCenter()
                backgroundColor(Color.WHITE)
            }
            
            Button {
                attr {
                    backgroundColor(Color.BLUE)
                    borderRadius(22f)
                    paddingHorizontal(32f)
                    paddingVertical(12f)
                }
                titleAttr {
                    text("登 录")
                    fontSize(16f)
                    color(Color.WHITE)
                    fontWeightSemiBold()
                }
                event {
                    click {
                        android.util.Log.d("Login", "登录按钮被点击")
                    }
                }
            }
        }
    }
}
```