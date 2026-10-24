# 桌面目录职责梳理与回归证据

## 本次变更

有效仓颉项目为 D:\Project\sa\saai\sa-code。保留 core、apps/cli、apps/host、apps/desktop 的依赖关系。主进程 main.cjs 从 998 行缩减至 264 行，协议及 UI 黄金路径验收迁入 test-support/protocol-smoke.cjs 和 test-support/ui-smoke.cjs，按显式冒烟参数延迟加载。窗口创建返回窗口实例；工作区选择器通过访问器注入，测试替换仍作用于原 IPC。package.json 的 files 清单纳入 test-support/**，避免安装包冒烟缺失模块。

## 验证

- 三个主进程/测试支持文件 node --check 通过。
- 路径单测 3/3 通过。
- 隔离 Electron 协议冒烟退出码 0，SMOKE PASS，宿主走 EOF 正常退出。
- 隔离 Electron UI 冒烟退出码 0，200 条通过，UI_SMOKE PASS。
- 第一次整页检查退出码 1：固定等待 120ms 后的流式增长尾部定位断言失败；其他组通过。随后仅将该等待改为有上限的真实尾部终态轮询，保留跟随状态与几何条件。复验退出码 0，40 组/162 条检查全通过。未修改滚动产品实现。

隔离环境 D:\Temp\SaCode-ui-scroll-20261004 使用当前桌面源码和此前已构建的自包含 Host；证据日志为 structure-protocol.log、structure-ui.log、structure-frame.log、structure-frame-recheck.log，复验报告为 structure-captures-recheck/reports.json。本次证明桌面模块拆分回归，不证明尚未连接的模型设置、完整 DSH 功能或最新后端增量完成。未重新生成或安装最终安装包；打包清单已修改，真实打包验收仍需后续执行。

## 待继续

renderer/app.js 仍集中页面与状态逻辑；完整页面复刻、指定技术栈构建、仓颉功能接入、真实模型验收、npm CLI 与最终安装包交付仍未完成。
