# 运行中消息队列面板首轮复刻（2026-10-04）

对照冻结提交 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 `packages/client/ui-conversation/src/client/queue/QueueDock.tsx`、样式与 `ui-primitives/src/user-text.tsx`。Vue 3/TypeScript `h()` 实现，构建期经典脚本，沿用唯一 Vue runtime；上游 MIT 许可证保留在 `renderer/assets/dsh-ui-LICENSE.txt`。

## 本批实现

- 空队列不显示；单条直接展示，多条默认折叠，编辑或操作在途期间保持展开并禁用折叠。
- 文本预览压缩空白，按 200 个 Unicode 字符截断；纯文本行支持多行编辑、Enter 保存、Shift+Enter 原生换行、Escape 取消，空白不提交，输入法确认不提交。
- edit/remove/steer 三类操作使用原队列消息标识；错误提示并保留编辑，回执成功后等待外部投影，不自行改写或删除队列事实。
- 操作在途禁用其他动作，编辑只读；非运行态禁用 steer；只读投影隐藏动作并退出编辑，宿主移除行后退出该行编辑。
- 待确认发送回显禁用动作；用 requestId/rpcId 消除队列回显与已入聊天消息的重复。
- 已落盘附件展示文件标识/体积及图片加载占位；图片异步结果按当前加载序号采纳，卸载后忽略迟到结果，不接管 URL 生命周期。
- 用户引用文本作为独立展示投影：会话 wire 引用折为标签，文件引用显示文件名，未知 `/name` 不冒充已加载技能；原始队列文本不修改。
- 真实输入区已放置 QueueDock 槽位。没有仓颉队列投影时为空，不显示测试数据。

## 证据

- `queue-dock.ts`、`user-text.ts` 严格 TypeScript 检查通过。
- 八个页面模块的 pack-pages 构建与经典脚本约束通过，renderer/app.js 与冒烟脚本语法检查通过。
- 最终隔离 Electron `queue-captures-references/reports.json`：214 组、605 条检查，失败 0，实际进程退出码 0。输出在 `D:\Temp\SaCode-ui-scroll-20261004\queue-references.stdout.log`；已查看 `queue-dock-fixture.png`。
- 队列增删改、投影更新、图片读取失败与在途动作由控制式测试适配器提供，不是仓颉队列服务。整个隔离实例使用此前构建 Host。

## 后端核对与剩余

当前 `core/src`、`apps/host/src`、`apps/cli/src` 未找到 inbox、steer、next-turn 或 queue/update 对应业务接口。`core/src/cancel.cj` 的 DeliveryQueue 是模型输出帧队列，不能当作用户消息 inbox。真实队列须补齐共享核心的持久事件、投影、操作及送达窗口，然后由有限 IPC 接入；禁止在 TypeScript 另建业务真源。

仍待验收真实队列与即时补充、待确认失败恢复、真实附件读取、持久忙碌偏好、全富文本/命令状态机、不同会话切换与安装包。引用图标与共享样式目前按项目 token 适配，未证明官方完整视觉一致。真实模型调用和安装即用最终产品仍未完成。
