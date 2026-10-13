# Linux 可执行构建阻碍与最小平台边界修正

## 1. 用户提供的 Linux 实测

以下由用户在提交 `f0e7cb6`、已设置 `SACODE_STDX_LIB_DIR` 的 Linux 环境提供，**不是本会话本机实测**。Linux 架构及完整编译器命令未随该结果提供，不自行补推。

| 模块 | 用户实测结果 |
| --- | --- |
| core | 静态库编译成功，31 条 warning |
| CLI | 链接失败，OpenProcess / GetExitCodeProcess / SetConsoleCtrlHandler 等 Windows API 未解析 |
| host | 5 分钟、15 分钟两次超时终止，峰值 5.66 GiB，未进入链接 |
| daemon | `scheduler.cj:51` 使用非法 `TaskDefinition?`，1.1.3 编译失败 |

stdx 搜索路径问题与原生平台边界是两层问题。环境变量让扩展包可解析，不让 Windows 系统函数在 Linux 出现。core 静态库可以保留未解析原生符号，不能以静态库绿色推导可执行程序链接绿色。

## 2. 当前工作区局部修正

仅修改以下四个生产文件：

- `core/src/procwin.cj`：五个 kernel32 foreign 声明、Windows 常量与 Windows 函数体均加 `@When[os == "Windows"]`。非 Windows 的 `ownProcessId` 使用已核实的 `std.env.getProcessId(): Int64`；只确认自身 PID 为 alive，其他查询一律 unknown，避免把 API 不可用误判为 dead 并删除租约。
- `core/src/sigwin.cj`：SetConsoleCtrlHandler、真实安装分支、C 回调限定 Windows。非 Windows 的 `ConsoleSignals.install()` 返回 false，不宣称信号已注册；调用方原有 `cancel-handler-unavailable` 明确拒绝仍保留。
- `core/src/filewin.cj`：八个 Windows 文件 API foreign 声明加 Windows 条件。既有原生持久追加/替换实现原本已限制 Windows，非 Windows 仍返回 unavailable / 抛出 file-replace-unavailable，不降级成不持久的普通写。
- `core/src/cu_exec.cj`：未使用的 GetSystemMetrics 声明限定 Windows，不能让只读可用性声明污染其他平台。

Windows 函数算法、错误码、回调调用与 nativeAppend/nativeReplace 实现不变，`procwin` 格式化展开部分原有单行分支，但求值次序不变。

**该补丁是隔离 Windows 符号，不是完成 Linux 运行支持**：

- 非 Windows 不能确认其他租约持有者已死，因此不得接管其残留租约。
- Linux 的系统信号注册尚未实现；依赖真实协作式取消的路径会明确拒绝启动。
- 非 Windows 持久追加和原子替换后端仍不支持，不能声称 Linux 会话写入具备本项目要求的持久保证。
- 本轮不增加 POSIX signal 回调、kill 判活或 fsync/rename CFFI；这些需要平台 API、异步信号安全和失效策略的单独设计，不可为了编译绿色静默裸跑。

## 3. daemon 调度文件

用户实测的语法修正方向是：

```diff
-        var task: TaskDefinition? = None
+        var task: Option<TaskDefinition> = None
```

技能已核 `?T` 为 Option<T> 的合法简写，而后缀 T? 不合法。建议使用显式 Option，减少跨语言混写。

当前主工作区的 `apps/daemon/src/scheduler.cj` 已被其他会话删除，HEAD 仍含该文件。本会话**未恢复、覆盖或提交删除**。上述 diff 是交接建议，不是已落实的修复。不能把工作区不编译此文件的绿色当作提交态 daemon 通过；如要修正提交态，需要先确认保留或移除 scheduler 的设计归属。

## 4. host 的超时

用户已经证实是在编译而非链接阶段超时。Windows 本会话此前提交候选的 HEAD 单体 Host 也超时；完整工作区的 HostRuntime/handleRpc 重构能编译，但该重构属于另一工作线，未被本批提交。

因此：

- 不把宿主超时归为缺 Windows API，也不把延长到 15 分钟视作修复。
- 不把内存峰值自行归因于某个编译器缺陷；需要同提交、同参数的源码拆分与编译过程数据才能判断。
- 下一步应由该重构作者整理宿主拆分的独立提交；不为这次平台声明补丁混入整份 HostRuntime 重构。

## 5. 技能和验证边界

已读用户指定 CangjieSkills 本地 `cangjie-coding`，以 1.1.3 SDK 为准；本批核对：

- `tools.cjc.2-核心选项速查.2-7-条件编译`：Windows/Linux 目标条件。
- `std.env.func.getprocessid`：当前 PID 的跨平台活动接口。
- `std.process.func.findprocess-int64`：ProcessException 可来自内存失败或进程不存在，不能凭异常笼统宣称 dead。
- `language.option.2-简写语法-t`：前缀 ?T 与 Option<T>。

项目指定的同语言参考 magic-cli 的平台示例已尝试读取，GitCode raw 返回 HTTP 418，当前本地没有找到该参考文件，**不宣称已读该项目实现**。本批采用本项目现有 @When 与 fail-closed 约束，不照猜 POSIX 能力。

本机仅有 Windows SDK；WSL 列举命令超时，未取得 Linux 构建环境，不继续尝试修改系统或启用子系统。

证据统一落位 `apps/desktop/.tmp-test/takeover-20261011/linux-ffi-boundary-20261013/`：foreign 声明 Windows 条件检查、本机 core/CLI 生产构建日志和构建期间源码哈希。未运行旧测试，不触发应用、模型、网络执行或用户数据迁移；本批不自动提交或推送。

本机验证已结算：**Windows core 与 CLI 均生产构建 exit=0**，四个修改文件构建期间哈希未变化。15 个相关 Windows foreign 声明（进程 5、信号 1、文件 8、电脑 1）均紧邻 Windows 条件。源码 diff 空白检查通过。

这个结果只证明本机 Windows 回归和声明静态边界；非 Windows 的新增分支没有 Linux 工具链编译/链接证据，仍需用户在 Linux 复验 CLI，以及在正常业务运行前确认明确拒绝状态。当前没有再次构建超时的 HEAD 单体宿主，没有把工作区已删除 scheduler 的 daemon 构建当成提交态修正证明。

## 6. 用户授权提交范围

用户在收到上述结果后明确要求提交并推送，仅纳入四个生产源码文件的本批平台边界修正、本报告和 `docs/build-linux.md` 的结果说明，共六个文件。

没有纳入 `apps/daemon/src/scheduler.cj` 的工作区删除，也没有纳入宿主重构、AppContainer 实现、其他功能修改或旧测试。推送前远端与本地同步，本批不携带其他待推提交；不使用强制推送或跳过 Git hooks。

此前“本批不自动提交或推送”描述的是修正阶段的边界，此次提交依据用户随后明确授权，验证范围仍仅为 Windows core/CLI 编译与静态声明核对。
