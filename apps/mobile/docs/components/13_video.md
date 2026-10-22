# Video(播放器)

> 来源：https://kuikly.tds.qq.com/API/components/video.html

视频播放器组件

注意：播放器依赖宿主的能力，需要在各端实现适配器。

## 属性

支持所有基础属性，此外还支持：

### src
视频播放源

参数：
- `src`: String - 视频源 URL

### playControl
设置播放控制属性（播放、暂停、停止）

参数：
- `playControl`: VideoPlayControl

### resizeModeToCover
设置视频画面拉伸模式为等比例撑满

### resizeModeToContain
设置视频画面拉伸模式为等比例不裁剪，保留黑边

### resizeModeToStretch
设置视频画面拉伸模式为缩放撑满（非等比例，会变形）

### muted
设置是否静音属性

参数：
- `muted`: Boolean

### rate
设置倍速属性（1.0, 1.25, 1.5, 2.0）

参数：
- `rate`: Float

## 事件

支持所有基础事件，此外还支持：

### playStateDidChanged
播放状态变化回调

参数：
- `state`: PlayState - 播放状态枚举
- `extInfo`: JSONObject - 扩展信息

### playTimeDidChanged
播放时间变化回调（毫秒）

参数：
- `curTime`: Int - 当前播放时间
- `totalTime`: Int - 总时间

### firstFrameDidDisplay
视频首帧画面显示时回调（一般用该时机隐藏封面）