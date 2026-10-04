# 输入区操作行与发送控件对齐（2026-10-04）

## 冻结上游依据

基线 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 [InputBar.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx) 与 [InputBar.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css)：正文与操作行纵向相隔 12px，操作行 2/8/6px 内边距，尾部组自动靠右；发送按钮 34px 圆形、16px 图标、上移 2px；空草稿禁用并为 0.4 透明度，执行中空草稿提供停止动作。

发送背景使用已核设计平台文件的实际 `button-info-fill/hover` 别名：浅色 rgb(65,118,230)/rgb(122,170,255)，暗色反向，图标始终白色。InputBar CSS 注释的历史十六进制颜色与实际令牌不同，本次以实际令牌解析结果为准。

## 现有技术栈中的改动

- Vue runtime/h() 保留原 textarea 与自动高度指令，正文内边距调整为 4/8/0/14px，右侧滚动内缩 4px，14 行上限的高度附加量从 12px 校正为 4px。小窗口额外上限仍保证会话空间。
- 操作行采用可换行 flex，尾部组靠右；窄容器组间距 8px、常规 12px。卡片 8px 顶内边距，底部内边距由操作行统一承担。
- 发送按钮使用冻结上游箭头和停止方形图形，共享中文 Tooltip 与可访问名称。普通业务按钮仍为 36px/R12；发送按钮为独立圆形规格，不再错误套用标准文字按钮。
- 空白草稿不发送，鼠标点击不移走输入焦点；执行中空草稿将原有核心取消动作暴露到输入区。非空草稿仍经已有 userSend 通道处理，不把本次 UI 变更宣称为完整任务提交/队列机制。
- 可见输入标签改为保留给辅助技术的标签，减少上游操作行之外的重复标题。品牌、原 SaCode 应用图标及中文界面保留。

## 验收

隔离目录 `dualtest/composer-controls-20261004/source` 从 `cd68ab16f57fb711618c13e7625373bb7e3e9e1b` 导出并覆盖本批四个源码文件。独立 npm ci、重新生成 vendor，官方 Electron 安装脚本生成独立 dist。Host/DLL 复用上一 Tooltip 验收版本；不代表最新核心或最新安装产物验收。

- Node 全量 100/100，失败 0、退出码 0，日志 `desktop-tests.log`。
- UI 冒烟 195 项通过，失败 0、退出码 0，日志 `ui-smoke.log`。真实鼠标事件验证圆形发送与输入焦点保持；真实键盘验证空白快捷键不写会话；输入区停止复用已有取消终态及半截正文检查。stderr 包含已有拒绝用例的预期错误及共享缓存访问诊断，不计为业务用例通过。
- 首轮布局失败记录 `layout-smoke.log`：夹具在 dispatch input 后立即点击仍被禁用的按钮；改为等待 Vue.nextTick 后再点击，保持空草稿禁用契约。
- 最终全量布局 **184 组 / 2048 项 / 失败 0 / 退出码 0**，日志 `layout-smoke-final.log`，结构报告 `source/apps/desktop/dist/layout/layout-report.json`。八组主题/尺寸均覆盖圆钮 34px、图标 16px、圆形曲线、专用悬停色和白色图标、行/正文内边距、空草稿禁用、长草稿滚动及 10/14/22px 全局字号。
- 断言明确区分普通主按钮语义色与圆形发送专用色，分别核对真实颜色，不再用两者颜色相同作为错误的成功条件。实际打开浅色最小窗口主界面及暗色最小窗口长草稿截图，核对卡片、按钮、文字与滚动范围；四个运行/验收源码文件与验收副本 SHA256 逐文件一致。

## 剩余范围

模型/权限/计划选择、命令与附件、上下文计量、草稿引用节点、队列/中断模式、空项目 hero、占位提示单行省略、共享宽度轴及完整 composer 生命周期继续待接入与验收。上游 Lexical 编辑器行为不由原生 textarea 几何验收证明。本次不缩减完整桌面目标，也未生成新安装包。
