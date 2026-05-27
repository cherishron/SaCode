# SaCode 自动更新机制方案

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

### 2. `/update` 命令

**功能**：
- 执行 `npm install -g @cherishron/sacode@latest`
- 显示更新进度
- 验证更新结果
- 提示重启

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

### 模块结构

```
interfaces/cli/src/
├── version_check.rs    # 新增：版本检查逻辑
├── cmd/
│   └── update.rs       # 新增：/update 命令实现
│   └ mod.rs            # 修改：注册 update 命令
├── tui.rs              # 修改：启动时调用版本检查
└── repl.rs             # 修改：启动时调用版本检查
```

---

### version_check.rs

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

---

### cmd/update.rs

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

---

## 实现步骤

### Phase 1：核心功能（2-3 天）

1. 创建 `version_check.rs` 模块
2. 创建 `cmd/update.rs` 命令
3. 注册 `/update` 命令到 CLI/REPL/TUI
4. 实现版本号比较逻辑

### Phase 2：启动检查（1-2 天）

5. TUI 启动时异步检查版本
6. REPL 启动时显示更新提示
7. 实现缓存机制

### Phase 3：优化完善（1 天）

8. 添加配置选项支持
9. 完善 TUI 中的异步消息传递
10. 测试各种边界情况

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
| `interfaces/cli/src/tui.rs` | 修改 | 启动检查 + 异步消息 |
| `interfaces/cli/src/repl.rs` | 修改 | 启动检查 + /update 命令 |
| `interfaces/cli/src/main.rs` | 修改 | 添加 version_check 模块引用 |

---

## 时间估算

| Phase | 内容 | 工时 |
|-------|------|------|
| Phase 1 | 核心模块 + /update 命令 | 2-3 天 |
| Phase 2 | 启动检查 + 缓存机制 | 1-2 天 |
| Phase 3 | 测试 + 优化 | 1 天 |
| **总计** | | **4-6 天** |