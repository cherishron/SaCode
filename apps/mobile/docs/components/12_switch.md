# Switch(开关)

> 来源：https://kuikly.tds.qq.com/API/components/switch.html

风格类iOS的开关组件，支持属性定制自定义开关样式

## 属性

支持所有基础属性，此外还支持：

### isOn
设置开关状态

参数：
- `on`: Boolean

### onColor
设置开关打开时的高亮色（背景色）

参数：
- `color`: Color

### unOnColor
设置开关关闭时的背景色

参数：
- `color`: Color

### thumbColor
设置圆型滑块颜色

参数：
- `color`: Color

### thumbMargin
圆块与开关的贴边边距，默认为2f

参数：
- `margin`: Float

### enableGlassEffect
系统要求：iOS 26.0+ 支持

启用iOS 26+液态玻璃效果

参数：
- `enabled`: Boolean (默认 false)

## 事件

支持所有基础事件，此外还支持：

### switchOnChanged
开关变化时的回调，回调会传入开关状态参数：

参数：
- `on`: Boolean - 开关状态（是否打开）