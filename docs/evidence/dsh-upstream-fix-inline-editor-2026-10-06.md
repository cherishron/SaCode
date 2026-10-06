# 上游修复吸收第一批：目标与队列共享编辑器（2026-10-06）

用户明确授权吸收 DSH 上游修复。本批承接增量分析 U08 的编辑器部分，不升级 S0，不改目标调度/暂停判据，不移植官方 React 或运行时模块加载器。

## 来源与差异

- 官方候选 HEAD：`5badb15009ae1756c3afe0ae0cef1faafc290ccc`。
- 代表提交：[b88b6c24](https://github.com/deepseek-ai/deepseek-harness/commit/b88b6c24)（目标编辑器尺寸/Enter 防护）、[66e10182](https://github.com/deepseek-ai/deepseek-harness/commit/66e10182)（目标和队列共享 InlineEditor）。
- 源码：`packages/client/ui-primitives/src/InlineEditor.tsx`、`packages/client/ui-goal/src/client/GoalBar.tsx`、`packages/client/ui-conversation/src/client/queue/QueueDock.tsx`；对应固定提交归档已在全量分析中核验。
- SaCode 改前已使用目标 textarea，队列也已有多行、自动测高与 IME/229/长按保护。缺口是两处编辑器行为分散、目标没有键盘保存/取消和聚焦/测高、队列只在文本变化时测高，不响应宽度变化。

本批以 Vue runtime + `h()` 实现共享 `InlineEditor`：Enter 保存、Shift+Enter 保留原生换行、IME/isComposing/keyCode 229 不提交、长按不重复保存、Escape 取消并阻止冒泡。保存期间只读且屏蔽后续输入/动作，核心 CAS 仍为实际写入判据。挂载聚焦，文本或宽度变化后重新测高；ResizeObserver 忽略仅高度变化，防自触发；卸载断开并废弃未结算测量。目标编辑高度有界、长文内部滚动。取消不落目标或排队消息。

目标原来的“可见 active/paused/blocked 目标走 edit，其余走 create”保留，不把已完成目标误送成 edit。暂停/恢复服务、运行中消息送达和附件生命周期未改。

## 本批文件归属

本批由 Codex 负责，下列既有文件在认领时均无在途改动：

- `apps/desktop/renderer/pages/{goal-bar,queue-dock}.ts`、新增 `inline-editor.ts`。
- `apps/desktop/renderer/goal-bar.css`。
- `apps/desktop/test/goal-bar.test.mjs`、新增 `inline-editor.test.mjs` 和 `inline-editor-render.test.mjs`。
- 本证据文档。

没有改 Host/CLI main、core、公共打包脚本、package.json、锁文件、能力矩阵或其他成员暂存文件。临时 Electron user-data 与构建 fixture 放在已经忽略的 `apps/desktop/.tmp-test/inline-editor/run-*`。两个页面现有构建入口通过静态 import 自动带入共享组件；没有新增运行时模块加载或依赖。

## 验收

| 层次 | 实测 | 判据 |
| --- | --- | --- |
| 改前定向红 | goal-bar 原 5 条通过，新编辑器入口断言失败 | 确认旧目标视图仍是原生 textarea，尚未接共享行为；不拿这条结构反证代替下面行为验收 |
| 组件行为 | 目标 6 条 + 编辑器 6 条通过 | 输入、保存锁、IME/229、Shift+Enter、长按、取消、焦点、测高、卸载 |
| 真实 Electron | 1 条用例内 **12 项交互检查全部通过** | 实际 Vue runtime、目标/队列组件、DOM、ResizeObserver 和键盘事件；无 Host、无模型请求 |
| 静态页面与构建护栏 | 2 条通过 | 所有页面 TS 可解析，既有动态/外部模块与运行时求值护栏通过 |
| 合并定向命令 | **15 tests / 15 pass / 0 fail / 0 skip，rc=0** | `node --test test/inline-editor.test.mjs test/inline-editor-render.test.mjs test/goal-bar.test.mjs test/page-sources-parse.test.mjs test/renderer-bundle-guard.test.mjs`，cwd `apps/desktop` |
| 宽度观察变异 | 去掉 ResizeObserver 后真实 Electron 在“变窄自动增高”转红，rc=1；恢复原文件后该用例通过，rc=0 | 检查真的钉住宽度行为，不是只观察有 textarea |

Electron fixture 使用独立 user-data、隐藏 offscreen 窗口和唯一已打包 Vue runtime；CSP 为 `script-src 'self'`，没有模板编译、eval 或外部脚本。最初夹具默认 GPU 启动失败，补测试进程自己的 no-sandbox/disable-gpu 后进入真实执行；隐藏窗口不产生绘制帧导致 ResizeObserver 不调度，改为 offscreen 后尺寸检查实跑。这些仅是测试夹具设置，不修改产品窗口配置。CSP 收紧后再次运行真实 Electron，12 项仍通过。

### 额外宿主回归的失败，如实保留

本批最初额外运行 `message-queue`、`queue-reference`、`queue-attachment`，组合读数 **21 tests / 12 pass / 9 fail，rc=1**。9 条宿主用例报 `bad-send-policy`、系统 Temp 下 settings / attachments 目录创建被拒或随后的 host-gone。它们调用现有 `dist/host/bin/sacode-host.exe`，不加载本批渲染组件。

没有重编/替换其他会话在使用的宿主、改授权策略或修夹具掩盖这些失败；留给固定源码/宿主与私有 TMP 的集成验收确认。**不得将本批 15 条通过表述为 npm 全套或队列后端已通过。**

## 状态和下一批

- U08 编辑器子项：源码已吸收、定向与真实 Electron 组件验收通过。
- U08 自动续轮预约撤回：未吸收，目标核心在其他成员进行中；SaCode 暂停仍遵守轮次边界生效。
- U06 样式 factory：当前渲染层没有官方 runtime module factory，不为该修复另造加载器；待完整插件客户端生命周期契约再对接。
- U02/U03/U04/U05 插件修复，以及 U09/U15 草稿/附件：仍按全量报告逐项核现状；插件核心、模型请求与公共入口在途，不能将本批写成全部已吸收。
- 安装包状态：**未重打 NSIS、未做装包态验收**。组件构建已证明两个页面包含共享模块，但最终安装包仍需稳定 HEAD 统一重建并核验载荷。

下一批继续按文件所有权推进；完整冻结版验收、14 条核心红灯及安装交付优先级保持不变。
