# RichText(富文本)

> 来源：https://kuikly.tds.qq.com/API/components/rich-text.html

`RichText`组件能够让不同的文本应用上不同的样式，他继承至`TextView`组件，因此继承了`Text`组件的所有属性。

## 属性

支持Text组件的所有属性

### Span方法
`Span`方法用于往富文本组件中添加一段样式可单独控制的文本

参数：
- `textSpanInit`: TextSpan.() -> Unit - span的初始化闭包

### ImageSpan方法
`ImageSpan`方法用于往富文本组件中添加一个可单独控制的图片

参数：
- `spanInit`: ImageSpan.() -> Unit - ImageSpan的初始化闭包

### PlaceholderSpan方法
`PlaceholderSpan`方法用于往富文本组件中添加一个空白占位区域

使用`placeholderSize`属性设置空白占位区域的大小，并通过`spanFrameDidChanged`事件监听SpanFrame变化来配合在空白占位区域叠加其他任意View。

## 事件

支持Text组件的所有事件
