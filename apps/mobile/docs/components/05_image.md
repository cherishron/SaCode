# Image（图片）

用于显示图片的组件

## 属性

### src

设置图片数据源

支持的网络图片、base64、assets、file 四种方式：

```kotlin
// 网络图片
Image {
    attr {
        src("https://example.com/image.png")
    }
}

// assets 图片
Image {
    attr {
        src(ImageUri.pageAssets("logo.png"))
    }
}

// base64 图片
Image {
    attr {
        src("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAs...")
    }
}
```

### resizeMode

图片缩放模式

| 方法 | 说明 |
|------|------|
| resizeCover() | 缩放填充，可能被裁剪 |
| resizeContain() | 缩放适应，可能有留白 |
| resizeStretch() | 拉伸填满 |

```kotlin
Image {
    attr {
        size(200f, 150f)
        src("https://example.com/image.png")
        resizeCover()
    }
}
```

### placeholderSrc

加载占位图

```kotlin
Image {
    attr {
        src("https://example.com/image.png")
        placeholderSrc("assets://placeholder.png")
    }
}
```

### blurRadius

高斯模糊

```kotlin
Image {
    attr {
        size(200f, 150f)
        src("https://example.com/image.png")
        blurRadius(5f)
    }
}
```

### tintColor

图片染色

```kotlin
Image {
    attr {
        src("https://example.com/image.png")
        tintColor(Color.RED)
    }
}
```

## 事件

### loadSuccess

图片加载成功回调

```kotlin
Image {
    attr {
        src("https://example.com/image.png")
    }
    event {
        loadSuccess {
            android.util.Log.d("Image", "加载成功")
        }
    }
}
```

### loadFailure

图片加载失败回调

```kotlin
Image {
    attr {
        src("https://example.com/image.png")
    }
    event {
        loadFailure {
            android.util.Log.e("Image", "加载失败")
        }
    }
}
```

## 示例

```kotlin
@Page("ImageDemo")
class ImageDemo : Pager() {
    override fun body(): ViewBuilder = {
        Column {
            attr {
                allCenter()
                backgroundColor(Color.WHITE)
            }
            
            Image {
                attr {
                    size(200f, 200f)
                    src(ImageUri.pageAssets("logo.png"))
                    resizeCover()
                    borderRadius(100f) // 圆形
                }
            }
        }
    }
}
```