# H 外部驱动交付声明复核（2026-10-06，Codex）

范围：只读核对用户转交的 H 完成声明、主工作区源码、Git 与现有日志。不运行电脑输入，不启动全量构建，不代提交 H 在途文件，不提升能力矩阵。复核时 HEAD 为 `675109b`；这是工作区审查，不是固定提交运行验收。

## 结论

H 已有核心驱动进展，但**不能判定 H 整体完成，也不能判定 6 个真实驱动全部验收通过**。最优先的问题是电脑操作返回成功但没有执行动作。

| 项目 | 直接证据 | 处置 |
| --- | --- | --- |
| 电脑 click 假成功 | `core/src/cu_exec.cj:115` 的 `doClick` 仅调用 `GetSystemMetrics(0)`；没有调用 SendInput，却返回 `ComputerExecResult(true,...)` | P1：真实实现前返回不支持/不可用；实现后验证目标应用确实收到点击。读屏幕宽度不能作为点击成功证据 |
| 电脑 type/press_key 假成功 | 同文件 `:125` 的 `doTypeOrKey` 只追加 `computer/exec::<verb>::stub`，随后 `ok=true` | P1：不能靠日志冒充输入。补真实输入与效果验收；5 条电脑测试只钉 CFFI 符号、拒绝、取消前置和审计，不证明注入 |
| 浏览器 7/8 未结算 | H 声明/文档写 7/8，源码有 8 个 @Test；没有指出第八条是 fail、skip 还是未跑 | 补逐用例状态和最后 Summary。不能把 7/8 写“全绿”。navigate/dump-dom 也不等于浏览器点击、输入和完整会话驱动 |
| Office 真实 provider 未验 | `opdf_exec_test.cj` 使用 Node 脚本夹具；H 文档明确无 LibreOffice | 可以证明子进程编排和 PDF 输出检查，不能证明 LibreOffice/Office 文档转换。真实 provider 仍待验证 |
| ASR | `voice_exec.cj` 存在，H 文档记录工具链缺失；未发现对应已提交验收 | BLOCKED 保留，不能归整体完成 |
| 全量 833 通过 | H 文档只有总数和绕过 worker 的命令；当前检查的 `core-test.txt`、`core/{cb2,ct}.txt` 未检出 unittest Summary，`.test-logs/core/{core.outlog,core.errlog}` 为空 | 尚未独立确认，不等于断言这次没有跑。需保留 TOTAL/PASSED/FAILED/ERROR/SKIPPED、rc、源码/二进制 SHA 和实际命令，说明直跑产物是否匹配源码 |
| 未提交交付 | `git status` 显示 `cu_exec.cj`、`cu_exec_test.cj`、`voice_exec.cj`、H 证据文档均 `??`；`git ls-files` 对这些文件无条目 | 本次只能承认工作区产物，不是可复现的提交态交付，由 H 主责处理 |
| 产品接线 | 对 Host/CLI 与 model_tool_runtime 搜索 `BrowserExecutor`、`ComputerExecutor`、`VoiceExecutor` 未命中 | 未取得这些执行器进入产品入口的直接证据；这项搜索不是所有接线形式的穷尽证明。需提供实际注册、授权、模型调用、结果返回链和两入口验收 |

权限 ledger 的 verb/target 审计不能自动证明应用身份授权、操作租约和工具审批都成立；统一 TurnToken 的声明也不能代替执行中取消测试。源码当前电脑执行器主要检查动作之前的取消，应按实际支持边界登记。

## 收尾顺序

1. H 主责先修电脑假成功，并用真实执行/效果断言取代“日志存在即执行成功”的断言；未实现动作 fail-closed。
2. 补浏览器第八条状态、真实 Office/ASR 状态及 833 完整运行证据。区分提交态/工作区态、编排夹具/真实 provider、核心切片/产品验收。
3. 按所有权提交源码和配套测试，排除 `core-test.txt`、`core/cb2.txt`、`core/ct.txt` 等控制台转储。
4. 真实接入 Host/CLI 工具管线，再做模型调用、拒绝授权、执行中取消、断连、释放和安装态验证；据此更新矩阵，当前保持部分完成。

## `.bak` 核查

本次仓库文件检索及 `core/` 递归查找没有发现 `turn_routing.cj.bak`。不能执行一个不存在或归属不明的备份合并；需要准确路径和差异后再判断。不会整份覆盖活动源码。

本复核只新增本文件，不修改 H 的证据正文或在途实现。
