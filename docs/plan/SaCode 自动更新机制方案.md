# SaCode 自动更新机制方案

## 当前状态

- 当前发布渠道是 npm 包 `@cherishron/sacode`
- 当前安装入口是全局安装后的 `sacode` 启动器
- 当前支持平台是 Linux x64 和 Windows x64，二进制随 npm 包分发
- 当前仓库已有发布文档：`docs/release/RELEASE.md`
- 当前仓库还没有统一的版本检查模块、`/update` 命令和启动时更新提示机制

## 目标边界

本方案只覆盖 npm 分发链路下的自动更新体验，不覆盖以下能力：

- 不实现 macOS 单独分发逻辑
- 不实现 GitHub Releases 直连下载更新
- 不实现静默后台热替换当前进程中的二进制
- 不实现自动回滚机制

本方案交付的核心价值是：

- 用户能够在启动时得知有新版本可用
- 用户能够在 REPL 和 TUI 内执行 `/update`
- 更新流程能复用现有 npm 全局安装方式
- 更新失败时给出明确可执行的人工处理指引

## 需求概述

1. **启动时自动检查版本**：每次启动 sacode 时检查 npm registry 是否有新版本
2. **提示用户更新**：如有新版本，显示提示信息引导用户执行 `/update`
3. **手动更新命令**：`/update` 命令执行 `npm install -g @cherishron/sacode@latest`
4. **更新后自检**：更新完成后显示新版本号并重启

---

## 功能设计

### 1. 启动时版本检查

**触发时机**：
- CLI 入口（`sacode` 无参数进入 TUI）
- REPL 启动（`sacode repl`）
- 直接执行任务（`sacode "<task>"`）

**检查逻辑**：
```
当前版本 = CARGO_PKG_VERSION (如 "0.1.9")
远程版本 = npm view @cherishron/sacode version (如 "0.2.0")

如果 远程版本 > 当前版本:
  显示提示: "新版本 0.2.0 可用，当前 0.1.9。输入 /update 更新。"
```

**实现要点**：
- 异步检查，不阻塞主流程
- 缓存检查结果（避免每次启动都请求 npm）
- 失败时静默处理（网络问题不影响启动）

**设计决策**：
- TUI 启动时走后台线程检查，通过现有异步消息通道回传
- REPL 启动时在进入主循环前执行一次快速检查，优先读缓存，远程检查失败时静默
- 直接执行任务模式也进行版本检查，但只在最终输出前附带一条简短提示，不打断任务执行
- 版本检查默认只提示一次，不在单次会话中重复弹出

### 2. `/update` 命令

**功能**：
- 执行 `npm install -g @cherishron/sacode@latest`
- 显示更新进度
- 验证更新结果
- 提示重启

**设计决策**：
- `/update` 默认执行“检查 + 更新”
- `/update --check` 只检查，不安装
- `/update --force` 忽略缓存并直接执行安装
- `/update --version <x.y.z>` 作为后续增强项，本阶段先不实现
- TUI 中的 `/update` 在后台线程执行，避免阻塞渲染循环
- REPL 和普通 CLI 中的 `update` 允许前台执行并打印完整输出

**流程**：
```
/update
  ↓
检查 npm 是否可用
  ↓
执行 npm install -g @cherishron/sacode@latest
  ↓
验证新版本（调用新二进制 --version）
  ↓
显示结果 + 提示重启
```

### 3. 版本检查缓存

**目的**：避免每次启动都请求 npm registry

**缓存策略**：
- 缓存文件：`~/.sacode/version-cache.json`
- 缓存有效期：24 小时
- 强制刷新：`/update --check` 或首次启动

**补充约束**：
- 当 `current_version` 与本地运行版本不一致时，缓存直接失效
- 当缓存 JSON 解析失败时，删除旧缓存并重新生成
- 当远程检查失败且存在旧缓存时，可以继续使用旧缓存中的 `has_update` 结果做弱提示
- 当用户显式执行 `/update` 时，优先走远程检查，避免旧缓存误导

**缓存格式**：
```json
{
  "last_check": "2026-05-27T10:00:00Z",
  "current_version": "0.1.9",
  "remote_version": "0.2.0",
  "has_update": true
}
```

---

## 详细实现

### 总体架构

```
CLI/TUI/REPL 入口
   ↓
VersionChecker
   ├── 读取本地缓存 ~/.sacode/version-cache.json
   ├── 必要时调用 npm view @cherishron/sacode version
   └── 返回 VersionStatus

/update 命令
   ├── UpdateService::check()
   ├── UpdateService::install()
   ├── UpdateService::verify()
   └── 输出 UpdateResult
```

建议将实现拆成两层：

- `version_check.rs`：纯检查与缓存逻辑
- `cmd/update.rs`：面向用户的命令入口与安装流程

这样后续如果增加状态页、doctor 检查项或 TUI 顶栏提醒，都可以直接复用 `version_check.rs`。

### 模块结构

```
interfaces/cli/src/
├── version_check.rs    # 新增：版本检查与缓存逻辑
├── cmd/
│   ├── update.rs       # 新增：/update 命令实现
│   └── mod.rs          # 修改：注册 update 命令
├── runner.rs           # 修改：直接任务执行时附带更新提示
├── tui.rs              # 修改：启动时调用版本检查
└── repl.rs             # 修改：启动时调用版本检查
```

如果后续需要把更新状态纳入 `/doctor`，可以再增加：

```
interfaces/cli/src/cmd/doctor.rs   # 复用 VersionChecker 状态
```

---

### version_check.rs

该模块建议只暴露以下稳定接口：

```rust
pub struct VersionChecker;

pub enum VersionStatus {
    UpToDate { current_version: String },
    UpdateAvailable { current_version: String, remote_version: String },
    Unknown,
}

impl VersionChecker {
    pub fn new() -> Self;
    pub fn check_for_update(&self) -> Result<VersionStatus>;
    pub fn force_check(&self) -> Result<VersionStatus>;
}

pub fn update_prompt(current_version: &str, remote_version: &str) -> String;
```

相比直接返回 `Option<String>`，`VersionStatus` 更适合后续扩展：

- 可以区分“最新版本”和“检查失败”
- `doctor`、TUI 和 REPL 展示层能更直接复用
- 不需要靠 `None` 同时表达“无更新”和“检查失败”两种语义

```rust
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use serde::{Deserialize, Serialize};
use anyhow::Result;

const NPM_PACKAGE: &str = "@cherishron/sacode";
const CACHE_DURATION_HOURS: u64 = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionCache {
    pub last_check: String,
    pub current_version: String,
    pub remote_version: String,
    pub has_update: bool,
}

pub struct VersionChecker {
    cache_path: PathBuf,
    current_version: String,
}

impl VersionChecker {
    pub fn new() -> Self {
        let home = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        let cache_path = home.join(".sacode").join("version-cache.json");
        let current_version = env!("CARGO_PKG_VERSION").to_string();
        
        Self { cache_path, current_version }
    }

    /// 检查是否有新版本（优先使用缓存）
    pub fn check_for_update(&self) -> Result<Option<String>> {
        // 尝试读取缓存
        if let Some(cache) = self.read_cache()? {
            if self.is_cache_valid(&cache) {
                if cache.has_update {
                    return Ok(Some(cache.remote_version));
                }
                return Ok(None);
            }
        }

        // 缓存过期或不存在，执行远程检查
        self.check_remote()
    }

    /// 强制检查远程版本（忽略缓存）
    pub fn force_check(&self) -> Result<Option<String>> {
        self.check_remote()
    }

    /// 从 npm registry 获取最新版本
    fn check_remote(&self) -> Result<Option<String>> {
        let output = std::process::Command::new("npm")
            .args(["view", NPM_PACKAGE, "version"])
            .output()?;

        if !output.status.success() {
            // npm 命令失败，静默处理
            return Ok(None);
        }

        let remote_version = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_string();

        let has_update = self.compare_versions(&remote_version, &self.current_version)?;

        // 写入缓存
        let cache = VersionCache {
            last_check: chrono::Local::now().to_rfc3339(),
            current_version: self.current_version.clone(),
            remote_version: remote_version.clone(),
            has_update,
        };
        self.write_cache(&cache)?;

        if has_update {
            Ok(Some(remote_version))
        } else {
            Ok(None)
        }
    }

    /// 比较版本号，返回 true 表示远程版本更高
    fn compare_versions(&self, remote: &str, current: &str) -> Result<bool> {
        let remote_parts: Vec<u32> = remote
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        let current_parts: Vec<u32> = current
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();

        for i in 0..std::cmp::max(remote_parts.len(), current_parts.len()) {
            let r = remote_parts.get(i).unwrap_or(0);
            let c = current_parts.get(i).unwrap_or(0);
            if r > c {
                return Ok(true);
            }
            if r < c {
                return Ok(false);
            }
        }

        Ok(false) // 版本相同
    }

    /// 检查缓存是否有效（24小时内）
    fn is_cache_valid(&self, cache: &VersionCache) -> bool {
        if let Ok(last_check) = chrono::DateTime::parse_from_rfc3339(&cache.last_check) {
            let now = chrono::Local::now();
            let duration = now.signed_duration_since(last_check);
            duration.num_hours() < CACHE_DURATION_HOURS as i64
        } else {
            false
        }
    }

    fn read_cache(&self) -> Result<Option<VersionCache>> {
        if !self.cache_path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&self.cache_path)?;
        let cache: VersionCache = serde_json::from_str(&content)?;
        Ok(Some(cache))
    }

    fn write_cache(&self, cache: &VersionCache) -> Result<()> {
        if let Some(parent) = self.cache_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(cache)?;
        std::fs::write(&self.cache_path, content)?;
        Ok(())
    }
}

/// 生成更新提示消息
pub fn update_prompt(remote_version: &str, current_version: &str) -> String {
    format!(
        "新版本 {} 可用！当前版本 {}。\n输入 /update 或执行 npm install -g @cherishron/sacode@latest 更新。",
        remote_version, current_version
    )
}
```

**建议补充实现点**：

1. `npm` 可执行检查
   - 先尝试 `Command::new("npm").arg("--version")`
   - 若不存在，直接返回 `VersionStatus::Unknown`

2. 版本比较建议封装为纯函数
   - `compare_versions(remote, current) -> Ordering`
   - 单元测试更直接

3. 缓存模型建议增加字段

```json
{
  "last_check": "2026-05-27T10:00:00Z",
  "current_version": "0.1.9",
  "remote_version": "0.2.0",
  "has_update": true,
  "source": "npm",
  "error": null
}
```

其中：

- `source` 便于后续支持其他分发通道
- `error` 便于排障和 `doctor` 展示最近一次失败原因

---

### cmd/update.rs

该命令建议拆成三层结果：

```rust
pub enum UpdateCommandMode {
    CheckOnly,
    CheckAndInstall,
    ForceInstall,
}

pub struct UpdateResult {
    pub checked: bool,
    pub updated: bool,
    pub previous_version: String,
    pub target_version: Option<String>,
    pub restart_required: bool,
    pub message: String,
}
```

这样可以同时满足：

- CLI 文本输出
- TUI 后台线程回传
- 后续 `--json` 输出

```rust
use anyhow::Result;
use std::process::Command;

use crate::version_check::{VersionChecker, update_prompt};

pub fn run(args: Vec<String>) -> Result<()> {
    let force_check = args.contains(&"--check".to_string());
    
    println!();
    println!("SaCode 更新检查");
    println!();

    let checker = VersionChecker::new();
    let current_version = env!("CARGO_PKG_VERSION");

    // 检查远程版本
    println!("正在检查 npm registry...");
    let remote_version = if force_check {
        checker.force_check()?
    } else {
        checker.check_for_update()?
    };

    match remote_version {
        Some(new_version) => {
            println!("发现新版本: {} (当前: {})", new_version, current_version);
            println!();
            
            // 执行更新
            println!("正在执行 npm install -g @cherishron/sacode@latest...");
            println!();
            
            let status = Command::new("npm")
                .args(["install", "-g", "@cherishron/sacode@latest"])
                .status()?;

            if status.success() {
                println!();
                println!("更新成功！");
                
                // 验证新版本
                println!("验证新版本...");
                let output = Command::new("sacode")
                    .arg("--version")
                    .output()?;
                
                let new_version_output = String::from_utf8_lossy(&output.stdout).trim().to_string();
                println!("当前安装版本: {}", new_version_output);
                println!();
                println!("请重新启动 sacode 以使用新版本。");
                println!("输入 /quit 退出当前会话。");
            } else {
                println!();
                println!("更新失败，请检查 npm 权限或网络连接。");
                println!("可手动执行: npm install -g @cherishron/sacode@latest");
            }
        }
        None => {
            println!("已是最新版本: {}", current_version);
        }
    }

    println!();
    Ok(())
}
```

**建议补充实现点**：

1. 更新命令执行前先检查 npm
2. 更新命令执行时保留 stdout/stderr，便于用户定位失败原因
3. 验证新版本时优先读取刚安装后的 `sacode --version`
4. 如果当前进程仍是旧版本，提示“重启后生效”即可，不尝试自重启

**安装命令约束**：

根据当前环境规则，npm 安装统一使用全局模式：

```bash
npm install -g @cherishron/sacode@latest
```

这与本方案目标一致，可以直接复用。

---

### cmd/mod.rs 变更

新增 `update` 命令注册：

```rust
mod update;  // 新增

pub enum CliCommand {
    // ... 现有命令
    Update,   // 新增
}

fn parse_args(args: Vec<String>) -> CliOptions {
    // ...
    if first == "update" {
        return CliOptions {
            command: CliCommand::Update,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }
    // ...
}

pub async fn run() -> Result<()> {
    // ...
    CliCommand::Update => update::run(options.sub_args)?,
    // ...
}

fn print_help() {
    // ...
    println!("  sacode update [--check]  # 检查并更新到最新版本");
    // ...
}
```

---

### tui.rs 变更

启动时调用版本检查：

```rust
use crate::version_check::{VersionChecker, update_prompt};

impl App {
    fn new() -> Self {
        // ... 现有初始化代码

        // 启动时检查版本（异步）
        let app_ref = &mut app;
        tokio::spawn(async move {
            let checker = VersionChecker::new();
            if let Ok(Some(remote_version)) = checker.check_for_update() {
                let current_version = env!("CARGO_PKG_VERSION");
                let prompt = update_prompt(&remote_version, current_version);
                // 通过 channel 发送提示消息到 UI
            }
        });

        app
    }

    // handle_local_command 中添加
    if trimmed == "/update" || trimmed.starts_with("/update ") {
        self.update_command(&input);
        self.input.clear();
        return true;
    }

    fn update_command(&mut self, input: &str) {
        let args = input.split_whitespace()
            .skip(1)
            .map(|s| s.to_string())
            .collect();
        
        self.push_system_message("正在检查并更新 sacode...");
        
        // 在后台执行更新
        let sender = self.task_tx.clone();
        thread::spawn(move || {
            let result = crate::cmd::update::run(args);
            match result {
                Ok(_) => {
                    // 发送成功消息
                }
                Err(e) => {
                    // 发送失败消息
                }
            }
        });
    }
}
```

**建议按当前 TUI 架构调整为以下设计**：

- 复用现有 `AsyncResult` channel
- 新增 `AsyncResult::VersionChecked`
- 新增 `AsyncResult::UpdateCompleted`
- 新增 `AsyncResult::UpdateFailed`
- `App::new()` 中调用 `spawn_version_check()`
- `handle_local_command()` 中增加 `/update`

推荐数据结构：

```rust
enum AsyncResult {
    // ...existing
    VersionChecked {
        current_version: String,
        remote_version: Option<String>,
        has_update: bool,
    },
    UpdateCompleted {
        previous_version: String,
        new_version: String,
        restart_required: bool,
    },
    UpdateFailed {
        message: String,
    },
}
```

**TUI 交互要求**：

- 版本检查消息只显示一次
- 更新进行中时显示 busy message，例如：`正在更新 sacode...`
- 更新结束后给出强提示：`更新完成，请退出并重新启动 sacode`
- 如当前还有任务在执行，`/update` 提示用户先等待任务完成或先取消任务

---

### repl.rs 变更

启动时显示版本检查提示：

```rust
use crate::version_check::{VersionChecker, update_prompt};

pub async fn run(&mut self) -> Result<()> {
    // 启动时检查版本
    let checker = VersionChecker::new();
    if let Ok(Some(remote_version)) = checker.check_for_update() {
        let current_version = env!("CARGO_PKG_VERSION");
        println!();
        println!("{}", update_prompt(&remote_version, current_version));
        println!();
    }

    // ... 现有 REPL 逻辑
}

// handle_command 中添加
"/update" => self.handle_update_command(&parts[1..])?,

fn handle_update_command(&mut self, parts: &[&str]) -> Result<()> {
    let args = parts.iter().map(|s| s.to_string()).collect();
    crate::cmd::update::run(args)?;
    Ok(())
}
```

**建议补充实现点**：

- REPL 启动时先读缓存，避免冷启动等待网络
- `/update` 执行前打印一行说明：`更新过程中当前 REPL 会话不会自动替换为新进程`
- 更新成功后推荐用户执行 `/quit`

---

### runner.rs 变更

直接执行任务模式也需要感知新版本，但这类模式最重要的是任务结果本身，因此提示要轻量：

```text
[更新提示] 新版本 0.2.0 可用，当前 0.1.9，可执行 `sacode update` 更新。
```

建议实现方式：

- `run_task_with_stdin()` 开始时触发一次快速检查
- 仅使用缓存或非阻塞检查结果
- 不把版本检查失败当成任务失败
- 文本输出追加一行提示即可

这部分优先级低于 TUI/REPL，可放到第二阶段。

---

## 用户体验流程

### 场景 1：启动时有新版本

```
$ sacode

新版本 0.2.0 可用！当前版本 0.1.9。
输入 /update 或执行 npm install -g @cherishron/sacode@latest 更新。

SaCode - AI Coding Assistant
输入你的编程任务，我会帮你完成。
...
```

### 场景 2：执行 /update

```
>>> /update

SaCode 更新检查

正在检查 npm registry...
发现新版本: 0.2.0 (当前: 0.1.9)

正在执行 npm install -g @cherishron/sacode@latest...

npm warn deprecated ...
+ @cherishron/sacode@0.2.0
updated 1 package in 3s

更新成功！
验证新版本...
当前安装版本: sacode 0.2.0

请重新启动 sacode 以使用新版本。
输入 /quit 退出当前会话。
```

### 场景 3：已是最新版本

```
>>> /update

SaCode 更新检查

正在检查 npm registry...
已是最新版本: 0.1.9
```

### 场景 4：强制检查（忽略缓存）

```
>>> /update --check

SaCode 更新检查

正在检查 npm registry...
已是最新版本: 0.1.9
```

---

## 版本号比较逻辑

采用 SemVer 标准（MAJOR.MINOR.PATCH）：

```
当前: 0.1.9
远程: 0.2.0

比较:
  MAJOR: 0 == 0 → 继续
  MINOR: 2 > 1 → 远程版本更高 → 有更新
```

```
当前: 0.1.9
远程: 0.1.9

比较:
  MAJOR: 0 == 0 → 继续
  MINOR: 1 == 1 → 继续
  PATCH: 9 == 9 → 版本相同 → 无更新
```

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| npm 命令不存在 | 静默跳过检查，提示用户手动更新 |
| npm registry 网络失败 | 静默跳过，使用缓存（如有） |
| npm install 权限不足 | 显示错误，提示使用 sudo 或检查权限 |
| 版本号格式异常 | 静默跳过比较，视为无更新 |
| 缓存文件损坏 | 删除缓存，重新检查 |

建议进一步细化：

| 场景 | 检测方式 | 处理策略 |
|------|----------|----------|
| npm 不存在 | `npm --version` 非 0 退出 | 显示“当前环境缺少 npm，无法自动更新” |
| registry 超时 | `npm view` 超时或非 0 退出 | 记录缓存错误信息，启动流程继续 |
| 用户无全局安装权限 | `npm install -g` 返回 EACCES | 明确提示用户修复 npm 全局权限 |
| 包名不存在 | `npm view/install` 404 | 提示检查发布状态或 registry 配置 |
| 安装后版本未变化 | `sacode --version` 仍为旧版本 | 提示 shell 仍使用旧路径，建议重新打开终端 |

---

## 配置选项

可在 `.sacode/config.json` 中添加更新相关配置：

```json
{
  "update": {
    "check_on_startup": true,    // 启动时检查（默认 true）
    "cache_duration_hours": 24,  // 缓存有效期（默认 24）
    "channel": "stable"          // 更新通道：stable / beta
  }
}
```

建议与当前 `/config` 体系对齐，最终收敛为可管理项，而不是只留在裸 JSON：

- `update.check_on_startup`
- `update.cache_duration_hours`
- `update.channel`

其中：

- `channel` 第一阶段固定为 `stable`
- `cache_duration_hours` 可以先限制在 `1..=168`
- 项目级配置只影响“当前项目内启动的 sacode”，用户级配置作为默认值

---

## 实现步骤

### Phase 1：核心功能（2-3 天）

1. 创建 `version_check.rs` 模块
2. 创建 `cmd/update.rs` 命令
3. 注册 `/update` 命令到 CLI/REPL/TUI
4. 实现版本号比较逻辑
5. 完成缓存读写与缓存失效逻辑

### Phase 2：启动检查（1-2 天）

6. TUI 启动时异步检查版本
7. REPL 启动时显示更新提示
8. 直接任务模式追加轻量提示

### Phase 3：优化完善（1 天）

9. 添加配置选项支持
10. 完善 TUI 中的异步消息传递
11. 测试各种边界情况

### Phase 4：增强项（后续）

12. `/update --check` 与 `/doctor` 联动
13. 支持更新通道 `stable/beta`
14. 评估 `--json` 输出与脚本集成需求

---

## 落地顺序建议

建议按以下顺序实现，减少一次性改动面：

1. 先做 `version_check.rs` 纯逻辑和单元测试
2. 再做 CLI `sacode update`
3. 再接 REPL `/update` 与启动提示
4. 最后接 TUI 异步提示和后台更新

这样能先拿到一个可用命令，再逐步补交互层。

---

## 测试用例

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_versions_higher() {
        let checker = VersionChecker::new();
        assert!(checker.compare_versions("0.2.0", "0.1.9").unwrap());
        assert!(checker.compare_versions("1.0.0", "0.9.9").unwrap());
        assert!(checker.compare_versions("0.1.10", "0.1.9").unwrap());
    }

    #[test]
    fn test_compare_versions_equal() {
        let checker = VersionChecker::new();
        assert!(!checker.compare_versions("0.1.9", "0.1.9").unwrap());
    }

    #[test]
    fn test_compare_versions_lower() {
        let checker = VersionChecker::new();
        assert!(!checker.compare_versions("0.1.8", "0.1.9").unwrap());
    }

    #[test]
    fn test_cache_validity() {
        let cache = VersionCache {
            last_check: chrono::Local::now().to_rfc3339(),
            current_version: "0.1.9".to_string(),
            remote_version: "0.2.0".to_string(),
            has_update: true,
        };
        let checker = VersionChecker::new();
        assert!(checker.is_cache_valid(&cache));
    }

    #[test]
    fn test_cache_expired() {
        let yesterday = chrono::Local::now() - chrono::Duration::hours(25);
        let cache = VersionCache {
            last_check: yesterday.to_rfc3339(),
            current_version: "0.1.9".to_string(),
            remote_version: "0.2.0".to_string(),
            has_update: true,
        };
        let checker = VersionChecker::new();
        assert!(!checker.is_cache_valid(&cache));
    }
}
```

建议补充以下测试：

```rust
#[test]
fn test_compare_versions_with_short_segments() {
    assert!(compare_versions("0.2", "0.1.9").is_gt());
}

#[test]
fn test_compare_versions_with_invalid_text() {
    assert!(compare_versions("latest", "0.1.9").is_eq());
}

#[test]
fn test_cache_invalid_when_current_version_changes() {
    // 缓存中的 current_version 与运行版本不一致时应失效
}

#[test]
fn test_update_prompt_contains_command() {
    let text = update_prompt("0.2.0", "0.1.9");
    assert!(text.contains("/update"));
}
```

集成测试建议覆盖：

- `npm` 不存在时 `/update` 的输出
- 远程版本高于本地时的检查提示
- 已经是最新版本时的输出
- 安装完成但当前 shell 仍指向旧可执行文件时的提示

---

## 依赖

无需新增外部 crate，使用：
- `std::process::Command` - 执行 npm 命令
- `serde` / `serde_json` - 缓存文件读写（已有）
- `chrono` - 时间处理（已有，TUI 中已使用）

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| npm registry 被屏蔽 | 静默处理，提示用户检查网络 |
| sudo 权限需求 | 提示用户使用 sudo npm install -g |
| 缓存目录权限 | 使用 ~/.sacode 目录，权限宽松 |
| 版本回滚需求 | 提示用户可手动安装特定版本 npm install -g @cherishron/sacode@0.1.9 |

补充两个工程风险：

| 风险 | 缓解措施 |
|------|----------|
| 更新命令阻塞 TUI | TUI 中统一放后台线程执行 |
| 当前进程路径与新安装路径不一致 | 更新后执行 `sacode --version` 校验并提示重新打开终端 |

---

## 后续优化（可选）

1. **增量更新**：仅下载差异文件（减少下载量）
2. **内嵌更新**：不依赖 npm，直接从 GitHub Releases 下载
3. **更新通知订阅**：支持订阅更新通知（邮件/Webhook）
4. **Beta 通道**：支持测试版本更新
5. **更新历史**：记录更新日志供用户查看

---

## 附录：TUI 异步消息传递

由于 TUI 是事件驱动架构，版本检查需要在后台执行并通过 channel 传递结果：

```rust
// tui.rs 中添加新的 AsyncResult 类型
enum AsyncResult {
    // ... 现有类型
    VersionChecked {
        has_update: bool,
        remote_version: Option<String>,
        current_version: String,
    },
}

// 启动时发起异步检查
fn spawn_version_check(&self) {
    let sender = self.task_tx.clone();
    thread::spawn(|| {
        let checker = VersionChecker::new();
        let result = checker.check_for_update();
        match result {
            Ok(Some(remote)) => {
                let _ = sender.send(AsyncResult::VersionChecked {
                    has_update: true,
                    remote_version: Some(remote),
                    current_version: env!("CARGO_PKG_VERSION").to_string(),
                });
            }
            Ok(None) => {
                let _ = sender.send(AsyncResult::VersionChecked {
                    has_update: false,
                    remote_version: None,
                    current_version: env!("CARGO_PKG_VERSION").to_string(),
                });
            }
            Err(_) => {} // 静默失败
        }
    });
}

// 处理异步结果
fn handle_async_result(&mut self, result: AsyncResult) {
    match result {
        AsyncResult::VersionChecked { has_update, remote_version, current_version } => {
            if has_update {
                let msg = update_prompt(&remote_version.unwrap(), &current_version);
                self.push_system_message(&msg);
            }
        }
        // ... 其他结果处理
    }
}
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `interfaces/cli/src/version_check.rs` | 新增 | 版本检查核心逻辑 |
| `interfaces/cli/src/cmd/update.rs` | 新增 | /update 命令实现 |
| `interfaces/cli/src/cmd/mod.rs` | 修改 | 注册 Update 命令 |
| `interfaces/cli/src/lib.rs` | 修改 | 导出 version_check 模块 |
| `interfaces/cli/src/tui.rs` | 修改 | 启动检查 + 异步消息 |
| `interfaces/cli/src/repl.rs` | 修改 | 启动检查 + /update 命令 |
| `interfaces/cli/src/runner.rs` | 可选修改 | 直接任务模式追加轻量提示 |

---

## 时间估算

| Phase | 内容 | 工时 |
|-------|------|------|
| Phase 1 | 核心模块 + /update 命令 | 2-3 天 |
| Phase 2 | 启动检查 + 缓存机制 | 1-2 天 |
| Phase 3 | 测试 + 优化 | 1 天 |
| Phase 4 | 增强项 | 1-2 天 |
| **总计** | | **5-8 天** |

---

## 推荐结论

这套自动更新机制建议先以“启动提醒 + `/update` 全局安装 + 更新后重启提示”为第一版目标，保持实现简单、与现有 npm 发布链路一致、可在 CLI/REPL/TUI 三个入口统一落地。真正的进程内热替换、自重启和多通道更新可以留到第二阶段。 
