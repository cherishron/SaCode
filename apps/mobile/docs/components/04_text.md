# Text（文本）

用于显示文本的组件

## 属性

### text

设置文本内容

```kotlin
Text {
    attr {
        text("这是一个文本")
    }
}
```

### color

设置字体颜色

```kotlin
Text {
    attr {
        text("彩色文本")
        color(Color.RED)
        // 或使用十六进制
        color(0xFF5733)
    }
}
```

### fontSize

设置字体大小

```kotlin
Text {
    attr {
        text("大字文本")
        fontSize(24f)
    }
}
```

### fontWeight

设置字重（粗细）

| 方法 | 说明 |
|------|------|
| fontWeightNormal() | 正常 |
| fontWeightMedium() | 中等 |
| fontWeightSemiBold() | 半粗 |
| fontWeightBold() | 粗体 |

```kotlin
Text {
    attr {
        text("粗体文本")
        fontWeightBold()
    }
}
```

### lines

最大行数，超出显示省略号

```kotlin
Text {
    attr {
        text("很长的文本很长的文本很长的文本")
        fontSize(20f)
        lines(2)
    }
}
```

### textDecoration

文字装饰

| 方法 | 说明 |
|------|------|
| textDecorationUnderLine() | 下划线 |
| textDecorationLineThrough() | 删除线 |

```kotlin
Text {
    attr {
        text("删除线文本")
        textDecorationLineThrough()
    }
}
```

### textAlign

文字对齐

| 方法 | 说明 |
|------|------|
| textAlignLeft() | 左对齐 |
| textAlignCenter() | 居中 |
| textAlignRight() | 右对齐 |

```kotlin
Text {
    attr {
        text("居中文本")
        textAlignCenter()
    }
}
```

## 示例

```kotlin
@Page("TextDemo")
class TextDemo : Pager() {
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
                    fontWeightBold()
                    color(Color.BLACK)
                }
            }
            
            Text {
                attr {
                    text("智能对话，随时为您服务")
                    fontSize(14f)
                    color(Color.GRAY)
                    marginTop(8f)
                }
            }
        }
    }
}
```