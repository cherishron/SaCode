# 基础属性、事件和方法

基础属性、事件和方法，是每一个 Kuikly 组件都包含的属性、事件和方法。

## 基础属性

### 样式属性

| 方法 | 说明 | 参数 |
|------|------|------|
| backgroundColor | 背景颜色 | Color |
| opacity | 透明度 | Float (0-1) |
| borderRadius | 圆角 | BorderRectRadius |
| border | 边框 | Border |
| visibility | 是否可见 | Boolean |
| boxShadow | 阴影 | BoxShadow |

### 布局属性

| 方法 | 说明 | 参数 |
|------|------|------|
| width | 宽度 | Float |
| height | 高度 | Float |
| size | 尺寸 | Float, Float |
| margin | 外边距 | Float |
| padding | 内边距 | Float |
| flexDirection | 弹性方向 | FlexDirection |
| justifyContent | 主轴对齐 | FlexJustifyContent |
| alignItems | 交叉轴对齐 | FlexAlignItems |

### 便捷方法

| 方法 | 说明 |
|------|------|
| allCenter() | 完全居中（设置主轴和交叉轴对齐为中心） |
| fillWidth() | 宽度填充父容器 |
| fillHeight() | 高度填充父容器 |

## 基础事件

| 事件 | 说明 |
|------|------|
| click | 点击事件 |
| doubleClick | 双击事件 |
| longPress | 长按事件 |
| didAppear | 显示完成回调 |
| didDisappear | 消失回调 |

## Color 颜色

```kotlin
Color.WHITE        // 白色
Color.BLACK        // 黑色  
Color.RED        // 红色
Color.GREEN      // 绿色
Color.BLUE       // 蓝色
Color.GRAY       // 灰色
Color.parseString16ToLong("#FF5733")  // 16进制颜色
```

## 示例

```kotlin
View {
    attr {
        size(100f, 100f)
        backgroundColor(Color.GREEN)
        borderRadius(20f)
        allCenter()
    }
}

Text {
    attr {
        text("Hello")
        fontSize(24f)
        color(Color.BLACK)
    }
}
```