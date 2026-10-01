# SaCode 错误列表 / 故障排查

本文档汇总项目运行期已知错误、排查思路与处理状态，便于后续检查与修复。

> 状态图例：🟥 未处理 · 🟨 分析中 · 🟩 已修复 / 已有规避方案

---

## 错误清单

### ERR-001 · `os error 5` 拒绝访问 → 任务停在「达到最大迭代次数 3」

- **现象**：TUI / CLI 运行任务时，工具调用返回 `{"error":"拒绝访问。 (os error 5)"}`，随后提示「本次任务达到最大迭代次数 3，我已停止继续自动调用工具」。
- **平台**：Windows（错误码 5 = `ERROR_ACCESS_DENIED`）。
- **os error 5 的常见触发点**（权限 / 路径问题，需针对性规避）：
  - `shell.exec` 执行的命令需要管理员权限（写入 `C:\Windows`、`Program Files` 等受保护目录）。
  - `fs.write` / `fs.edit` 目标文件被 IDE 或其他程序独占锁定（如 `.sacode/audit.log`、正在编辑的文件）。
  - 防病毒软件拦截了生成的子进程。
- **与 `max_iterations` 的真实关系（2026-08-18 重新核实，原结论有误）**：
  - os error 5 **不会直接终止任务**。在 `runtime/src/provider/client.rs` 的 `tool_chat_streaming` 主循环（约 247–277 行），工具执行 `tool_executor(...)` 若返回 `Err`，会被第 270 行吞掉并转成 `{"error":"..."}` 字符串**回灌给模型**，循环继续，不中断。
  - 「达到最大迭代次数 3」的提示来自 `task_runner.rs:705` 的 `format_tool_chat_result`，仅在 `hit_round_limit == true` 时输出。而 `hit_round_limit` 只在主循环**跑满 `max_tool_rounds` 轮且模型仍返回工具调用**时才为 `true`（`client.rs` 末段 return）。即：提示里的「3」**确实是迭代耗尽**，不是 os error 5 的兜底——原 ERR-001 把两者因果倒置了。
  - **「停在 3」的真正来源**：内层单次任务的工具轮数由 CLI 传给 runtime 的 `max_iterations` 决定，而该值的基线默认就是 **3**（`config.rs` `merge_effective`）。用户 `/config user set max_iterations 10` 后理应读到 10；若仍停在 3，多半是配置未真正写入/生效，或观察的是外层 `/loop` 轮数（由 `loop_max_iterations` 控制，默认 10）。**TUI 外层 `/loop` 的 `LoopState.max_iterations` 实际已在 `mode_actions.rs:62` 正确读取 `effective_config().loop_max_iterations`**，并非硬编码 3——此前把 `async_actions.rs:596/:648` 的 `LoopState { max_iterations: 3 }` 误判为生产代码，那两处是**单元测试**里的构造值，不影响运行。
  - **默认值散落矛盾（已修复，2026-08-18）**：原先 `config.rs`(3) 与 `task_runtime.rs`(6) 的回退值不一致。现已新增 `config::DEFAULT_MAX_ITERATIONS = 3` 单一常量，被 `config.rs` / `task_runtime.rs`(两处) / `arg_parser.rs` / `repl.rs` / `checkpoint.rs` 统一引用，消除 3 与 6 的矛盾。
- **状态**：🟩 已修复（默认值统一为单一常量来源；TUI `/loop` 已确认读取 effective_config）
- **待办 / 后续处理**：
  1. ~~统一 `max_iterations` 默认值~~ ✅ 已完成：引入 `config::DEFAULT_MAX_ITERATIONS`，全链路引用。
  2. ~~TUI `LoopState.max_iterations` 读取 `effective_config`~~ ✅ 经核实 `mode_actions.rs:62` 已读取 `loop_max_iterations`，无需改。
  3. ~~（可选体验改进）区分「迭代耗尽」与「工具执行持续失败」~~ ✅ 已完成（2026-08-18）：`ToolChatResult` 新增 `last_tool_error` 字段，记录工具循环末次错误；`format_tool_chat_result` 在 `hit_round_limit` 且存在末次错误时，输出「注意：任务在多轮工具调用中持续遇到错误而停止（并非单纯迭代耗尽）。最后错误：<err>」，明确归因，不再误导为单纯迭代耗尽。
  4. ~~对 `shell.exec` / `fs.write` / `fs.edit` 在 Windows 下的访问拒绝给出更明确的错误指引~~ ✅ 已完成（2026-08-18）：新增 `is_access_denied_error`（覆盖 `os error 5` / 中文「拒绝访问」/ POSIX `Permission denied` 等）与 `tool_error_hint`，当末次错误属访问拒绝类时，在提示后追加 Windows 专属排查指引（受保护目录、文件被锁定、管理员权限、移入工作区等）。
- **相关代码（已核实行号）**：
  - `runtime/src/provider/client.rs`：`tool_chat_streaming` 主循环（约 202–296 行），工具 `Err` 在 270 行被吞为 error JSON 并写入 `last_tool_error`；`hit_round_limit=true` 在循环末段 return（构造含 `last_tool_error`）；`ToolChatResult` 新增 `last_tool_error: Option<String>` 字段。
  - `runtime/src/executor/task_runner.rs`：`format_tool_chat_result`（约 704 行）按 `last_tool_error` 区分提示；`is_access_denied_error`（约 763 行）+ `tool_error_hint`（约 773 行）提供 Windows 访问拒绝指引；新增 5 项测试（`task_runner::tests`）。
  - `interfaces/cli/src/cmd/config.rs`：新增 `pub const DEFAULT_MAX_ITERATIONS: usize = 3`，`merge_effective` 默认引用它。
  - `interfaces/cli/src/tui/task_runtime.rs:391/:442`：`effective_config().max_iterations` 回退改为 `config::DEFAULT_MAX_ITERATIONS`。
  - `interfaces/cli/src/tui/mode_actions.rs:62`：`/loop` 外层 `loop_max_iterations` 已从 `effective_config` 读取（**非硬编码**）。
  - `interfaces/cli/src/cmd/arg_parser.rs` / `repl.rs` / `checkpoint.rs`：`max_iterations` 回退统一引用 `DEFAULT_MAX_ITERATIONS`。
  - `interfaces/cli/src/cmd/mod.rs:213`：`parse_args` 测试断言 `max_iterations == 3`（与常量一致，无需改）。

---

## 附：相关配置说明

- `max_iterations`：单次任务内工具循环的最大轮次，范围 1–10，默认 3。每次发送消息启动的是**独立任务**，计数器从 0 重新开始，不跨发送累计。
- `loop_max_iterations`：`/loop` 命令外层自动循环轮数，默认 10，与 `max_iterations` 相互独立。
- 调大单次任务预算：`/config user set max_iterations 10`（用户级，全局生效）。
