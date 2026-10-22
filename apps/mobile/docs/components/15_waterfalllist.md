# WaterFallList(瀑布流)

> 来源：https://kuikly.tds.qq.com/API/components/waterfall-list.html

用于展示一系列项目的视图组件，可以根据项目的大小和位置自动调整项目的位置，继承自`List`组件

## 属性

除了支持所有基础属性，还支持以下属性：

### listWidth
列表宽度，必须设置
- `width`: Float

### columnCount
列数，默认为`1`
- `count`: Float

### itemSpaceing
列间距，默认为0
- `spacing`: Float

### lineSpacing
行间距，默认为0
- `spacing`: Float

### contentPadding
组件内部间隔，默认为0

### scrollEnable
是否允许滑动内容，默认`true`

### bouncesEnable
是否开启回弹效果，默认 `true`

### showScrollerIndicator
是否显示滚动条，默认 `true`

### flexDirection
指定排版方向

### pagingEnable
是否开启分页

### firstContentLoadMaxIndex
首次内容加载最大条数

### preloadViewDistance
列表视图预加载距离

## 事件

- scroll - 监听滚动事件
- scrollEnd - 滚动结束事件
- dragBegin - 开始拖拽事件
- dragEnd - 停止拖拽事件
- contentSizeChanged - Size变化事件

## 方法

- setContentOffset - 设置滚动位置
- setContentInset - 设置内容边距
- contentInsetWhenEndDrag - 设置OverScroll边距
- abortContentOffsetAnimate - 停止滚动动画
