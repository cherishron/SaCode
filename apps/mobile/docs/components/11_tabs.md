# Tabs(标签栏)

> 来源：https://kuikly.tds.qq.com/API/components/tabs.html

选项卡切换组件（与PageList分页列表组件配套使用）

## 属性

支持所有基础属性，此外还支持：

### scrollParams
更新scroller滚动信息使得tabs组件'指示条'同步滚动。该参数必须设置，才能让tabs组件正常使用。

该参数来自PageList等Scroller容器组件中监听scroll事件的ScrollParams参数。

### defaultInitIndex
首次默认初始化的tabs组件对应index

参数：
- `index`: Int

### indicatorInTabItem
生成可滚动的指示条，配合scrollParams同步滚动

参数：
- `creator`: ViewContainer<*, *>.() -> Unit

### indicatorAlignCenter
指示条居中滚动

### indicatorAlignAspectRatio
指示条按比例滚动（默认行为）

## 事件

支持所有Scroller事件