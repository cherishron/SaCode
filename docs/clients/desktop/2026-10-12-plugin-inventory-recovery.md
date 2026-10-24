# 插件清单读取、重试与重开隔离修复（2026-10-12）

## 本批边界

承接用户“继续”，处理不冲突其他会话的独立适配器问题。起点定向 `git status` 确认 `plugin-manager-adapter.ts` 无未提交差异，专属测试路径不存在。未改 Host、core、IPC、app.js、插件页面、公共打包脚本、其他会话的文件或用户数据；无 Git 提交、发布、依赖安装或真实插件安装操作。

本批仅修改 `apps/desktop/renderer/pages/plugin-manager-adapter.ts`，新增 `apps/desktop/test/plugin-manager-recovery.test.mjs` 与本记录。无差异只证明起点观察，不代表跨会话锁；若后续会话需改此文件，应先读取本批差异。

## 原因与修复

- 原 `read()` 在等待 Host 前清掉 dirty，写操作后的清单回读一旦失败，有旧 view 时下一次普通 read 可以返回旧缓存，不会自动重试。现在读取失败保留重试标记，旧缓存不伪装成新成功。
- 原 `void run.finally(...)` 生成额外拒绝 Promise，即使调用方接住原始拒绝，Node 仍观察到未处理拒绝。改为两个均成功的 then 清理分支，原始失败仍返回调用方。
- 原任何加入在途 load 的读都设 rerun，多个普通 read 因而重复请求 Host。现在普通 read 共用在途请求，只有显式刷新或读取期间的写操作要求后续读取；不吞掉变更后的刷新。
- 原 dispose 只停轮询，旧清单回执可以落进同一个适配器的重开视图。现在清单读取绑定代次，dispose 切代并解绑旧在途对象；旧回执明确 `plugin-read-stale`，不能覆盖新清单/修订，旧清理也不能抹掉新请求。
- 无在途读取的已核缓存仍保留，普通重开不平白新增请求。本文仅证明清单读取隔离，未扩称全部安装/取消/进度异步链均已隔离。

## 验证

1. 实现前初版专项9条：6通过/3失败、rc=1，并出现3条未处理拒绝。两条测试随后调整为真正暴露“写后回读清 dirty”窗口，未将首次旧测试通过当作缺陷不存在。
2. 修复后初轮：新专项9＋既有适配器13＋上一批权限14，**36/36、rc=0**。
3. 补充并发失败及旧失败清理不能清新请求两条后，最终命令：

   `node --test test/plugin-manager-recovery.test.mjs test/plugin-manager-adapter.test.mjs test/permission-menu.test.mjs test/composer-menu.test.mjs`

   **41/41、rc=0**：新专项11、既有适配器13、权限14、相邻菜单3，无跳过、取消或失败，也未报告未处理拒绝。
4. 实际 `plugin-manager.ts` 页面入口在内存折叠为 IIFE，通过共享 Vue runtime 和 `assertStaticRendererBundle` CSP/无运行时模块加载检查，rc=0；未写公共 vendor/dist。
5. 专属测试 `node --check`、定向 `git diff --check` 均通过。项目无 lint/typecheck 脚本及相关工具，不安装依赖、不将 esbuild 构建冒充完整类型检查。

## 仍未接入

组件级启停、真实安装取消、远程源安装和构建审批仍由 Host/核心当前契约决定，本批没有实现或解除其门禁。测试驱动的是实际产品适配器及受控通道替身，不等于真实 Host、Electron 页面或安装包验收。需要集成会话重建页面资源和目录包后完成实际用户入口复验。
