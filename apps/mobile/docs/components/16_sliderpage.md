# SliderPage(轮播图)

> 来源：https://kuikly.tds.qq.com/API/components/slider-page.html

用于展示一组图片或内容的视图组件，支持自动轮播和手动切换页面

## 属性

### defaultPageIndex
初始显示的页面索引，默认为 0

### isHorizontal
是否为水平方向展示, 默认为 `true`

### pageItemWidth
页面项宽度，默认为 `view` 宽度

### pageItemHeight
页面项高度，默认为 `view` 高度

### loopPlayIntervalTimeMs
轮播时间间隔（毫秒单位），若等于 0 则不轮播，默认为 `0`

### itemCount
页面项数量，默认为 0

### initSliderItems
设置Slider的dataList，以及creator

## 事件

### pageIndexDidChanged
监听页面切换事件，回调参数为当前页面的索引

## 方法

### startLoopPlayIfNeed
启动循环播放

### stopLoopPlayIfNeed
停止循环播放

### autoLoopPlay
设置自动循环播放
