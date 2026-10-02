# CLI / Desktop 架构边界评估报告

> 评估日期：2026-10-02 · 依据：用户提供的《CLI/Desktop 架构边界建议方案》+
> 对 SaCode 实际代码的逐项核对（kernel / runtime / interfaces/cli / interfaces/desktop）。
> 结论先行：**项目现状与该方案的核心架构原则高度吻合，无需大重构；仅发现 2 个真实缺口（均为增量可修），1 条语义澄清。**

---

## 一、总体结论

| 维度 | 方案要求 | SaCode 实际 | 判定 |
|---|---|---|---|
| 依赖方向 | kernel←runtime←interfaces，单向无环 | 严格单向，kernel 零内部依赖 | ✅ 符合 |
| core 纯净性 | core 不得导入窗口/托盘/菜单/原生 UI | kernel 无任何 tray/webview/window/dialog 引用，Cargo 依赖树无 tauri/wry | ✅ 符合 |
| cli 纯净性 | cli 不得引用 desktop | interfaces/cli 无任何 desktop 引用 | ✅ 符合 |
| GUI 依赖归属 | GUI 依赖只在 desktop 入口 | tauri/wry/webview2-com 仅在 `interfaces/desktop/src-tauri` | ✅ 符合 |
| 进程模型 | daemon 是桌面主子进程，不注册系统服务 | desktop spawn daemon 带 `kill_on_drop(true)`；无 sc.exe/systemd 安装 | ✅ 符合 |
| 入口区分 | 独立入口，非运行后判断 | `sacode`（bin）/`sacode-tui`（bin）/`sacode-desktop`（bin）三入口 | ✅ 符合 |

**一句话**：该方案描述的"正确架构边界"就是本项目**已经落地**的形态。方案中"最容易出错的两点"（CLI 静态导入 GUI、托盘退出=隐藏窗口）本项日均未出现。

---

## 二、逐项核对详情（证据）

### 1. core/CLI 的 GUI 隔离 —— 通过

```
kernel/src/      无 tray / webview / window / dialog 引用（grep 0 命中）
runtime/src/     "desktop" 命中仅 providers.json 的 desktop 格式解析（数据兼容，非进程引用）
cli/src/         无 desktop 引用（grep 0 命中）
cargo tree -p sacode-kernel → 无 tauri / wry
```

runtime 的 `daemon::desktop_conversations` 是 **daemon 的 HTTP API 模块**（服务桌面端客户端），
不是引用桌面进程；依赖方向仍是桌面→daemon，正确。

### 2. 桌面端生命周期语义 —— **优于**方案基线

方案要求"托盘退出 = 停止任务+终止子进程+关闭窗口+销毁托盘+退出主进程"，
SaCode 实现（`src-tauri/src/main.rs` `WindowEvent::Destroyed`）：

```rust
terminal_state.close_all()          // 1. 关 PTY
bridge.abort()                       // 2. 停 SSE 桥
state.event_bridge.lock().await.take()
handle.stop().await                  // 3. daemon.stop() = 删 ready-file + start_kill + wait
```

`SacodeSidecar::stop()` 含 `start_kill()` + `wait().await`（等待真正退出），
且 spawn 时即带 `kill_on_drop(true)`——**即使进程被强杀也不会遗留孤儿 daemon**。

### 3. 后台保活与"关窗不退" —— 通过

- 托盘开关（`set_tray_enabled`）启用时，`CloseRequested` → `api.prevent_close()` + `hide()`；
- 托盘「退出 SaCode」→ `app.exit(0)` → Destroyed → 完整关闭链；
- 自启动经 `--hide` 参数进入后台静默模式（本轮已实现），不弹窗；
- daemon 不随窗口关闭而终止——它是常驻服务，供 reopen 后复用（本会话已实测：
  杀 daemon 后 desktop 的 UI 仍存活，符合"崩溃隔离"预期，见 §4 缺口-2）。

### 4. CLI 前台进程模型 —— 部分符合（见缺口）

| 检查 | 结果 |
|---|---|
| 前台运行、不注册全局后台 | ✅ `sacode` 为前台进程，无 any systemd/sc.exe 安装 |
| 不默认创建开机启动项 | ✅ `autostart` 仅在 **桌面端** `tauri-plugin-autostart`，CLI 侧 0 命中 |
| 终端关闭随控制进程退出 | ✅ CLI 无服务化代码路径 |
| SIGINT/SIGTERM 取消任务 | ⚠️ **未显式处理**（见缺口-1）：CLI 依赖 tokio 默认行为（Ctrl+C 直接杀），
  杀进程后 daemon 侧若在跑任务无取消回调 |
| 关闭子进程并等待退出 | ⚠️ **部分**：`kill_on_drop(true)` 仅 desktop sidecar 设置；
  runtime 沙箱执行器（`sandbox/executor.rs:163`）与 MCP（`mcp/mod.rs:492`）手工 kill 但无 `kill_on_drop` 兜底 |

---

## 三、发现的真实缺口（2 个，均可增量修复）

### 缺口-1：CLI 无显式信号处理（SIGINT/SIGTERM）

- **位置**：`interfaces/cli/src/runner.rs`（`cancellation: None` 硬编码）
- **影响**：`sacode "task"` 前台运行时，Ctrl+C / `kill` 中止的是整个进程树，
  但 runtime 的任务取消标记（`cancellation`）没有置位——daemon 侧任务若在跑，
  不会走"取消任务"路径，可能残留 running 状态。
- **方案对应**："CLI 必须做到：收到 SIGINT/SIGTERM 后取消任务；关闭子进程并等待其退出"。
- **修法（增量）**：`runner` 构造 `CancellationToken`，在 `main`/`run_task` 入口挂
  `tokio::signal::ctrl_c()`（及 unix `SIGTERM`）→ `cancel.cancel()` → 传入 runner。
  预估 <60 行，不动现有逻辑。

### 缺口-2：runtime 子进程无 `kill_on_drop` 兜底

- **位置**：`runtime/src/sandbox/executor.rs:163`（`Command::new(&command.program)` 无
  `kill_on_drop(true)`）、`runtime/src/mcp/mod.rs` 的 child 同理。
- **影响**：agent 任务 panic / drop 时，已 spawn 的 shell 子进程或 MCP server
  可能变孤儿（现有代码在正常路径手工 kill，异常路径靠 OS 回收，不保证）。
- **方案对应**："关闭子进程并等待其退出"。
- **修法（增量）**：两处 `Command` 构造加 `.kill_on_drop(true)`（一行/处），
  语义与 desktop sidecar 一致。
- **注意**：MCP 的 child 是长期持有（`self.child`），加 `kill_on_drop` 前需确认
  Drop 语义不破坏复用（正常路径是显式 `kill()`，Drop 只在异常时触发，安全）。

---

## 四、与建议方案的 3 点语义澄清（非缺陷）

1. **"共用依赖树 ≠ CLI 携带 GUI 依赖"**：本项以 Rust workspace 实现，天然满足
   "CLI 入口不静态导入 GUI"——CLI 的 `Cargo.toml` 依赖列表无 desktop crate，
   打包器（cargo）也不会把 tauri 拉进 `sacode` 产物。方案中担心的"GUI 包被传递
   依赖带入 CLI 产物"在 cargo 依赖图下**不成立**（与 JS 世界 `node_modules`
   提升机制不同）。已实测 `cargo tree -p sacode-kernel` 无 tauri/wry。
2. **"daemon 作为独立服务"**：本项 daemon 是 desktop 主进程的子组件（spawn+
   ready-file+kill_on_drop），无安装步骤——正是方案推荐的形态。
3. **"CLI 体积浪费"**：`sacode.exe` release 54MB 中含 runtime 全量（extism、
   tree-sitter 等），这是 Rust 静态链接的固有成本，与 GUI 无关；方案所述
   "只能靠构建期真正拆包"对本项不适用（本项 CLI 与 daemon 本就是同一二进制
   `sacode`，`sacode acp`/`sacode serve` 是同一产物的子命令——这是比方案
   更彻底的共享）。

---

## 五、与用户建议中"文件级改动清单"的映射

| 方案条目 | SaCode 现状 | 处理 |
|---|---|---|
| `core/ports/`（Notifier/UIHost/Lifecycle） | kernel 无端口抽象；通知走 `runtime/src/notify`（native notify 0.1） | 已足够，无需引入 ports 层 |
| 两独立入口 + CLI 禁 GUI 导入 | ✅ 已是三入口 | 无需 CI 检查（依赖图天然满足），但可加 lint |
| 产物命名 app-desktop/cli 区分 | `sacode-desktop.exe` vs `sacode.exe` | ✅ 已区分 |
| 安装包可合并、内部二进制独立 | NSIS 包内 `sacode-desktop.exe` + `sacode*.exe` sidecar | ✅ 已实现（externalBin） |
| 共享状态按 config/data/logs 分层 | `~/.sacode/{providers.json,config.json}` + `<ws>/.sacode/config.json` | ✅ 已分层（user/project 双层） |
| 实例锁 `instance-{id}.lock` | ready-dir `sacode-desktop-sidecar-{user}` | 🟡 够用（单用户单实例），多实例见下 |
| `scripts/audit-gui-coupling` | 无 | 🟡 可加（低成本，防回归） |

---

## 六、建议动作（按优先级）

| 优先级 | 动作 | 成本 | 价值 |
|---|---|---|---|
| P2-中 | **补缺口-2**：sandbox/executor + mcp child 加 `kill_on_drop(true)` | 2 行 | 消除孤儿进程风险 |
| P2-中 | **补缺口-1**：CLI 挂 ctrl_c/SIGTERM → CancellationToken | ~60 行 | 方案硬性要求，取消链路闭环 |
| P3-低 | 加 `scripts/audit-gui-coupling.sh`（grep 断言 kernel/cli 无 tray/webview 引用） | ~20 行 | 防回归的廉价门禁 |
| P3-低 | docs 中把"daemon 与桌面端关系"补一段（子进程模型图） | 文档 | 消除后续审阅者的重复疑问 |

**不做**：引入 core/ports 抽象层、拆分产物依赖树、改进程模型——现状已满足方案目标，
按方案第 6 节"边界矛盾"的结论，这类改动属于过度设计。
