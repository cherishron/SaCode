# 队列附件修复版桌面产物验收（2026-10-05）

## 构建范围

核心和宿主基于 `9d85b899fec96ced43a7fb28d840287d9669c522` 隔离快照，157 个已跟踪仓颉源文件与该提交逐文件归一化换行后相同。桌面包含该提交的渲染修复及本轮滚动夹具输入修正。构建期间其他工作新增的持续目标调度器等模块没有混入；此产物不代表持续变化的当前 HEAD 全量发布。

官方本地 Electron 33.4.11 配合 electron-builder 26.15.3，明确指定 `electronVersion` 和 `electronDist`，生成 NSIS 和 portable，最终构建 rc=0。隔离目录未安装 Electron 时，首次仅给版本范围导致构建失败；明确使用本地安装的准确版本后通过。运行时包没有 npm 模块；未改 `signExecutable:false`。

产物目录：`D:/Project/sa/saai/sa-code/apps/desktop/dist/electron-queue-20261005-final`。保留原旧包及首次夹具失败包，避免同名文件被混作验收证据。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| SaCode Setup 0.1.0.exe | 92370602 | c342e8778b281ea46a47931634f6f502e4f57dc7fa17af41d86095135c7c7dfa |
| sacode-portable.exe | 92218569 | 12339a568c1afbf597b49ff6903f8a758cfe9aa8e6695289e2593b3df881d3b6 |

## 载荷核验

隔离构建宿主、`win-unpacked/resources/host/bin/dsh-host.exe`、从新 Setup 原样解出的宿主三处均为 5616128 字节，SHA-256 `b34e6e4412579c664051b806f3196509343cc8f94ff3cd0413284b9cfee25541`。

`win-unpacked` 与新 Setup 原样解出的 `app.asar` 均为 5521634 字节，SHA-256 `978188ddf045c8ed01b0228ee6461748dd87501b744a058ab1c92927470eed82`。另逐文件核对 app.js、conversation-scroll.js、queue-dock.iife.js、main.cjs、stdio-guard.cjs、frame-smoke.cjs 及真实队列附件冒烟模块，均与构建输入相同。

## 红灯与验收

首次新 Setup 原样载荷的整页冒烟 rc=1，失败于阅读夹具 `followingTail==='false'`。夹具只程序化设置 `scrollTop`，缺少用户滚轮意图；在待执行布局定位期间与自动滚动无法区分。修正三处上翻夹具：先派发滚轮意图再设置滚动位置，保留全部跟随/阅读/锚点断言及原等待时限，没有修改生产控制器来迁就夹具。

重新构建后从最终 Setup 原样解出并直接运行 `SaCode.exe --frame-smoke`，**249 组 / 717 条 / 0 失败，真实进程 rc=0**。包含真实宿主队列附件显示/删除、发送、轮次边界送达、取消保留队列和步边界即时补充。SSE 金路径使用本地契约夹具，不算本轮真实模型测试。

同一最终 Setup 原样载荷 `--ui-smoke` 为 **207 OK / 0 FAIL / UI_SMOKE PASS，真实进程 rc=0**。针对标准输出管道断开及资源路径的测试 5/5、滚动确定性测试 2/2 通过。完整产品仍是部分实现；图片缩略图、历史附件、上下文投影和设置等能力缺口未由此闭合。

**未执行安装器，也未验证安装/卸载、快捷方式或便携自解压入口；直接运行解出的应用仅证明载荷运行。** 未签名、未发布 npm。本轮更新了桌面包，未因宿主/UI 改动重打核心未变的 CLI。

原始证据：`D:/Temp/SaCode-queue-reference-20261005` 下 `source-audit.json`、`build-installer-final.log`、`final-artifact-hashes.json`、`extract-final.log`、`final-installer.stdout.log`/`stderr.log`、`final-installer-captures/reports.json`。首次失败现场另存 `fresh-installer-captures`。
