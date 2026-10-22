# Canvas(自绘画布)

> 来源：https://kuikly.tds.qq.com/API/components/canvas.html

结合`CanvasContext`提供绘制图形的接口，对齐 H5 Canvas 能力，可用于绘制直线、曲线、矩形、圆形、文本等

## CanvasContext API

### 路径操作
- beginPath - 新建路径
- moveTo - 移动到指定坐标
- lineTo - 绘制直线
- arc - 创建弧/曲线
- closePath - 闭合路径
- quadraticCurveTo - 二次贝塞尔曲线
- bezierCurveTo - 三次贝塞尔曲线

### 描边与填充
- stroke - 绘制图形轮廓
- strokeStyle - 设置描边颜色/渐变
- fill - 填充路径
- fillStyle - 设置填充颜色/渐变

### 线条样式
- lineWidth - 线条宽度
- setLineDash - 虚线样式
- lineCapRound/Butt/Square - 线条末端样式

### 渐变
- createLinearGradient - 线性渐变
- createRadialGradient - 径向渐变

### 文本
- textAlign - 文本对齐
- font - 文本样式
- measureText - 测量文本
- fillText - 绘制填充文本
- strokeText - 绘制描边文本

### 图像绘制
- drawImage - 绘制图像

### 状态管理
- save - 保存状态
- saveLayer - 创建新图层
- restore - 恢复状态

### 裁剪
- clip - 剪切区域
- clipPathIntersect - 交集裁剪
- clipPathDifference - 差集裁剪

### 变换
- translate - 平移
- scale - 缩放
- rotate - 旋转
- skew - 倾斜
- transform - 变换矩阵
