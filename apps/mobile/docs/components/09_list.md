# List(列表)

> 来源：https://kuikly.tds.qq.com/API/components/list.html

用于展示一系列项目的视图组件，支持垂直方向和水平方向，继承自`Scroller`

通常配合循环语句指令（vfor, vforIndex, vforLazy）使用。

## 属性

除了支持所有基础属性，还支持以下属性：

### scrollEnable
是否允许滑动内容，默认`true`

### bouncesEnable
是否开启回弹效果，默认 `true`

### showScrollerIndicator
是否显示滚动条，默认 `true`

### flexDirection
指定排版方向（COLUMN/ROW）

### pagingEnable
是否开启分页

### firstContentLoadMaxIndex
首次内容加载最大条数，用于优化首屏耗时

### preloadViewDistance
列表视图预加载距离，默认为 list高度

### scrollToPosition
列表滚动到指定位置

参数：
- `index`: Int - item在List中的索引位置
- `offset`: Float - 相对于List的偏移量
- `animate`: Boolean - 是否需要动画

### getFirstVisiblePosition
获取第一个可见的item位置。返回(index: Int, offset: Float)

## 事件

### scroll
监听滚动事件

### scrollEnd
滚动结束时事件

### dragBegin
用户开始拖拽事件

### dragEnd
用户停止拖拽事件

### contentSizeChanged
组件 Size 发生变化事件

## 方法

### setContentOffset
设置滚动到某个具体坐标偏移值的位置

### setContentInset
设置内容边距

### contentInsetWhenEndDrag
设置 OverScroll 时停留的内容边距

### abortContentOffsetAnimate
立即停止当前正在进行的滚动动画