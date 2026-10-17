# 输入区发送按键首轮复刻（2026-10-04）

上游依据为冻结提交 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 `ui-conversation/src/client/input/editor/keymap.ts`、`view-binding.ts` 与 `submission-policy.ts`，缓存位于 `D:\Temp\SaCode-official-639ed015`。本方仍使用 Vue 3/TypeScript，按键模块经附件页面构建并复用唯一 Vue runtime，不新增运行时模块加载。

## 实现

- 普通 Enter 发送、Shift+Enter 原生换行、Ctrl/Meta+Enter 加速手势。重复 Enter 与混合修饰键不发送。
- 输入法保护包含 composition 生命周期、`isComposing`、旧式 keyCode 229 以及 compositionend 后 10 毫秒保护窗；候选确认不穿透到全局发送。
- 预留菜单的方向键/Tab/Escape/Enter 仲裁、Space 命令认领接口；更新时使用当前处理器，卸载清理监听。
- 纯发送模式策略覆盖忙碌偏好 queue/steer 与加速手势取反；非运行态或不支持 steering 时回 queue。
- 真实输入区移除全局 Ctrl/Enter 发送入口，使用根节点指令。当前空闲发送仍经已有仓颉 `userSend` 记录消息、成功回执后清空草稿。
- 运行中送达服务尚未接入时，发送动作明确提示并保留草稿，不把普通持久消息记录称为排队或即时补充。已有核心取消通路继续可用。
- 全局导航以原生 `dialog:modal` 判断阻挡，涵盖不带自定义 aria 属性的原图模态。

## 验证和边界

严格 TypeScript 检查、页面经典脚本构建、渲染层 JS 语法检查通过。隔离 `--ui-smoke` 200 项 OK、0 FAIL、实际退出码 0；stderr 的 `bad-font-size` 与 `settings-already-owned` 为该套回归的拒绝路径断言。

`keymap-captures-busy` 的 Electron 全页检查为 193 组/559 条，失败 0，实际退出码 0，覆盖真实 Shift+Enter 换行、输入法保护、空闲消息记录、忙碌时保留草稿和实际核心取消。

最终加入原图模态阻止全局导航穿透的检查后，`keymap-captures-modal` 为 194 组/561 条，失败 0，实际进程退出码 0。

第一次原生换行测试未聚焦 BrowserWindow 且未发送字符事件而失败；已按 Electron 原生输入事件要求聚焦并补齐 keyDown/char/keyUp 后通过，不将失败运行列为成功证据。

本批不代表完整富文本编辑器已复刻。上游 Lexical shell、引用 chip、完整命令菜单与认领状态机、排队面板、持久忙碌偏好、queue/steer 真实送达，以及自动启动真实模型轮次仍待实现。当前按键策略的模式测试是控制式接口验收，不是仓颉送达能力证明；隔离 Host 为此前构建，不含未提交模型设置原型。全目标保持未完成，安装包未重新生成。
