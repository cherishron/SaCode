# Scroller(滚动容器)

> 来源：https://kuikly.tds.qq.com/API/components/scroller.html

用于展示不确定高度的内容，可以将一系列不确定高度的子组件装到一个确定高度的容器中，使用者可通过上下或左右滚动操作查看组件宽高之外的内容。

## 属性

除了支持所有基础属性，还支持以下属性：

### scrollEnable
是否允许滑动内容，默认`true`

参数：
- `scrollEnable`: Boolean - 是否允许滑动内容

### bouncesEnable
是否开启回弹效果，默认 `true`

参数：
- `bouncesEnable`: Boolean

### showScrollerIndicator
是否显示滚动条，默认 `true`

参数：
- `showScrollerIndicator`: Boolean

### flexDirection
指定排版方向
- `FlexDirection.COLUMN` - 垂直方向
- `FlexDirection.ROW` - 水平方向

### pagingEnable
是否开启分页

### flingEnable
是否允许惯性滚动（fling）。设置为 `false` 时，用户松手后列表立即停止滚动。

### nestedScroll
设置子滚动容器的嵌套滚动模式

参数：
- `forward`: KRNestedScrollMode - 向前滚动时的嵌套滚动模式
- `backward`: KRNestedScrollMode - 向后滚动时的嵌套滚动模式

KRNestedScrollMode 枚举值：
- `SELF_ONLY` - 仅当前控件处理滚动
- `SELF_FIRST` - 当前控件优先处理
- `PARENT_FIRST` - 父控件优先处理

### visibleAreaIgnoreTopMargin
设置计算子组件可见性面积时忽略的顶部距离

### visibleAreaIgnoreBottomMargin
设置计算子组件可见性面积时忽略的底部距离

## 事件

### scroll
监听滚动事件，回调参数为 `ScrollParams`：
- `offsetX`: Float - 列表当前横轴偏移量
- `offsetY`: Float - 列表当前纵轴偏移量
- `contentWidth`: Float - 列表当前内容总宽度
- `contentHeight`: Float - 列表当前内容总高度
- `viewWidth`: Float - 列表View宽度
- `viewHeight`: Float - 列表View高度
- `isDragging`: Boolean - 当前是否处于拖拽列表滚动中

### scrollEnd
滚动结束时事件

### dragBegin
用户开始拖拽事件

### dragEnd
用户停止拖拽事件

### scrollToTop
监听系统触发的"回到顶部"事件

### contentSizeChanged
组件 Size 发生变化事件

## 方法

### setContentOffset
设置`Scroller`滚动到某个具体坐标偏移值(offset)的位置

参数：
- `offsetX`: Float
- `offsetY`: Float
- `animated`: Boolean - 是否使用动画

### setContentInset
设置`Scroller`内容边距

参数：
- `top`, `left`, `bottom`, `right`: Float

### abortContentOffsetAnimate
立即停止当前正在进行的滚动动画
