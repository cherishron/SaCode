# Input(单行输入框)

> 来源：https://kuikly.tds.qq.com/API/components/input.html

`Input`组件为单行输入框

## 属性

支持所有基础属性，还支持：

### text
设置输入框文本

### fontSize / fontWeightNormal / fontWeightBold / color
文本相关属性

### textAlignLeft / textAlignCenter / textAlignRight
文本对齐方式

### keyboardTypePassword / keyboardTypeNumber / keyboardTypeEmail
键盘类型设置

### returnKeyTypeSearch / Send / Done / Next / Go / Continue
键盘返回键类型

### placeholder
输入框提示文本

### placeholderColor
提示文本颜色

### tintColor
输入框光标颜色

### maxTextLength
限制输入框的输入长度

支持三种长度限制类型：
- BYTE - 按字节计算
- CHARACTER - 按字符计算
- VISUAL_WIDTH - 按视觉宽度计算

### autofocus
是否自动获取焦点

### editable
是否可编辑

## 事件

### textDidChange
输入框文本变化事件

### inputFocus
获取焦点事件

### inputBlur
失去焦点事件

### keyboardHeightChange
软键盘高度变化事件

### inputReturn
软键盘Return事件

## 方法

### setText
设置输入框文本

### focus
获取焦点

### blur
失去焦点

### cursorIndex
获取光标位置

### setCursorIndex
设置光标位置
