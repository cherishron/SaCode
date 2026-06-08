# SaCode 第二阶段：平台化补全方案

> 基于 2026-06-08 与 7 款竞品重新评估结果，聚焦 4 项核心差距的实施方案。

## 背景

当前 SaCode 在"多 Agent 编排 + MCP 双模 + Daemon + 沙箱审计"维度已形成独特优势，但在以下 4 项存在差距，影响用户基数和产品质量：

| 优先级 | 项目 | 竞品最优 | SaCode 差距 |
|--------|------|---------|------------|
| P0 | Windows 命令适配 | Codex CLI / Claude Code | shell.exec 不支持 Windows 内置命令、无进程组隔离 |
| P1 | macOS 支持 | Claude Code 全平台 | CI/发布/安装链路完全排除 macOS |
| P1 | 增量索引缓存 | Claude Code | 每次代码智能工具调用全量重解析 |
| P2 | CI 自动修复 | Codex CLI | 无 cargo fmt / clippy / 自动修复步骤 |

---

## 1. P0：Windows 命令适配

### 1.1 现状分析

| 组件 | 当前实现 | 问题 |
|------|---------|------|
| `shell.exec` | 自定义 `split_command()` → `std::process::Command`，无 shell 包装 | 不支持 `dir`/`type`/`echo` 等 shell 内置命令；危险命令检测全是 Unix 命令（`rm -rf` 等） |
| `fs.search` | 纯 Rust `regex` + 文件遍历 | **已跨平台**，无需修改 |
| `LocalSandboxBackend` | `#[cfg(unix)]` 用 `pre_exec`+`setpgid` 做进程组隔离；Windows 走空 | 子进程残留风险；`terminate_process_tree` 只 kill 直接子进程 |
| 危险命令检测 | 仅 Linux 命令：`rm -rf /`、`:(){ :\|:& };:`、`dd if=`、`mkfs` | Windows 特有危险命令（`format C:`、`del /F /S`、`reg delete`）无防护 |

### 1.2 搜索依赖确认

`runtime/src/tools/fs/search.rs` 使用纯 Rust `regex::Regex` + `std::fs::read_to_string`，不调用外部 `grep`。路径使用 `std::path::MAIN_SEPARATOR` 统一替换为 `/`。这部分无需改动。

### 1.3 技术方案

#### A. shell 内置命令支持

**策略**：自动检测 `program` 是否为 Windows shell 内置命令，若是则包裹 `cmd.exe /C`。

```rust
// runtime/src/tools/shell/exec.rs，在 spawn 前

#[cfg(target_os = "windows")]
const WINDOWS_SHELL_BUILTINS: &[&str] = &[
    "dir", "type", "echo", "copy", "del", "ren", "mkdir", "rmdir",
    "set", "cd", "chdir", "md", "move", "pushd", "popd", "path",
    "assoc", "ftype", "cls", "color", "date", "time", "title",
    "mklink", "robocopy", "xcopy", "find", "findstr", "where",
    "sort", "more", "fc", "comp", "tree", "ver", "vol",
];

#[cfg(target_os = "windows")]
fn needs_shell_wrapper(program: &str) -> bool {
    let lower = program.to_ascii_lowercase();
    WINDOWS_SHELL_BUILTINS.contains(&lower.as_str())
}
```

当检测到内置命令时，将执行改为：
```
cmd.exe /C <原始完整命令字符串>
```

#### B. Windows 危险命令检测

```rust
#[cfg(target_os = "windows")]
const WINDOWS_DANGEROUS_PATTERNS: &[(&str, &str)] = &[
    ("format", "格式化磁盘"),
    ("diskpart", "磁盘分区操作"),
    ("reg delete", "删除注册表项"),
    ("del /F /S", "强制递归删除"),
    ("rmdir /S", "递归删除目录"),
    ("takeown", "文件所有权接管"),
    ("icacls", "权限变更"),
    ("bcdedit", "启动配置修改"),
    ("net user", "用户账户操作"),
    ("wmic", "WMI 操作"),
];
```

#### C. 进程组隔离



**Windows Job Objects 方案**：

```rust
// runtime/src/sandbox/executor.rs

#[cfg(target_os = "windows")]
fn configure_process_isolation(command: &mut std::process::Command) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    // CREATE_NEW_PROCESS_GROUP = 0x00000200
    // CREATE_BREAKAWAY_FROM_JOB = 0x01000000
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    Ok(())
}

#[cfg(target_os = "windows")]
fn terminate_process_tree(child: &std::process::Child) -> std::io::Result<()> {
    // 使用 taskkill /T /PID 杀掉整个进程树
    let pid = child.id();
    std::process::Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;
    Ok(())
}
```

#### D. fs.search 路径过滤

```rust
// runtime/src/tools/fs/search.rs
// 遍历时跳过 Windows 系统目录
fn should_skip_dir(name: &str) -> bool {
    let skip = ["$RECYCLE.BIN", "System Volume Information", "Windows", "Program Files", "Program Files (x86)"];
    skip.contains(&name)
}
```

### 1.4 需改动文件

| 文件 | 改动 | 工作量 |
|------|------|--------|
| `runtime/src/tools/shell/exec.rs` | 添加 `#[cfg]` Windows 内置命令自动包裹 + 危险命令检测 | 中 |
| `runtime/src/sandbox/executor.rs` | 添加 `#[cfg(target_os = "windows")]` 进程组隔离和进程树终止 | 中 |
| `runtime/src/tools/fs/search.rs` | 添加 Windows 系统目录跳过逻辑 | 小 |
| `runtime/src/tools/shell/mod.rs` | 如需要，拆分平台相关逻辑到单独模块 | 小 |

### 1.5 验收标准

- [ ] `sacode "列出当前目录文件"` 在 Windows 上能正确执行 `dir` 命令
- [ ] `sacode "显示当前路径"` 能正确执行 `echo %cd%`
- [ ] `shell.exec` 拒绝执行 `format C:`、`del /F /S C:\*` 等危险命令
- [ ] `fs.search` 不遍历 `$RECYCLE.BIN` 等系统目录
- [ ] 子进程超时/取消后进程树被完全终止（无孤儿进程）

---

## 2. P1：macOS 支持

### 2.1 现状分析

**代码层面可编译**（`insight.rs` 已有 `#[cfg(target_os = "macos")]`），但：

| 阻断层 | 位置 | 问题 |
|--------|------|------|
| CI | `.github/workflows/release.yml` | 仅 ubuntu-latest + windows-latest runner |
| npm 安装 | `npm-package/bin/sacode.js` | binaryMap 无 darwin 条目 |
| npm 安装 | `npm-package/bin/install.js` | `binaryMap` 无 darwin，macOS 用户直接报错退出 |
| 发布检查 | `scripts/check-release.js` | `expectedMap` 无 darwin，README 出现 macOS 字样会**校验失败** |
| 平台声明 | `npm-package/package.json` | description 只提 Linux 和 Windows |

### 2.2 技术方案

macOS 支持分两个平台目标：
- **x86_64-apple-darwin**（Intel Mac）
- **aarch64-apple-darwin**（Apple Silicon M1/M2/M3）

#### A. CI/CD 变更

##### `.github/workflows/release.yml` 新增

```yaml
jobs:
  build-macos-x64:
    runs-on: macos-13
    strategy:
      matrix:
        target: [x86_64-apple-darwin]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          target: ${{ matrix.target }}
      - run: cargo build --release --target ${{ matrix.target }}
      - name: Package
        run: |
          tar -czf sacode-${{ github.ref_name }}-darwin-x64.tar.gz \
            -C target/${{ matrix.target }}/release sacode

  build-macos-arm64:
    runs-on: macos-14
    strategy:
      matrix:
        target: [aarch64-apple-darwin]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          target: ${{ matrix.target }}
      - run: cargo build --release --target ${{ matrix.target }}
      - name: Package
        run: |
          tar -czf sacode-${{ github.ref_name }}-darwin-arm64.tar.gz \
            -C target/${{ matrix.target }}/release sacode
```

##### `.github/workflows/test.yml` 新增

```yaml
jobs:
  test-macos:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test --workspace
```

#### B. npm 安装链路

##### `npm-package/bin/sacode.js` 新增

```js
const binaryMap = {
  'linux-x64':    'sacode-linux-x64',
  'win32-x64':    'sacode-win32-x64.exe',
  'darwin-x64':   'sacode-darwin-x64',
  'darwin-arm64': 'sacode-darwin-arm64',
};
```

##### `npm-package/bin/install.js` 新增

```js
const binaryNames = {
  'linux-x64':    'sacode-linux-x64',
  'win32-x64':    'sacode-win32-x64.exe',
  'darwin-x64':   'sacode-darwin-x64',
  'darwin-arm64': 'sacode-darwin-arm64',
};
```

#### C. 发布检查脚本

##### `scripts/check-release.js`

1. `expectedMap` 添加 `'darwin-aarch64'` 和 `'darwin-x64'`
2. 移除第 167-169 行的反向检测（"macOS 字样出现则报错"）
3. 添加 darwin 平台的 tarball 名称校验

#### D. 文档变更

| 文件 | 改动 |
|------|------|
| `npm-package/package.json` | description → "supports Linux, macOS, and Windows" |
| `npm-package/README.md` | 添加 macOS 安装说明 |
| `README.md` | 平台支持添加 macOS |
| `docs/build/CROSS_COMPILE.md` | 添加 macOS 章节 |
| `CHANGELOG.md` | 记录 macOS 支持 |

### 2.3 需改动文件

| 文件 | 改动 | 工作量 |
|------|------|--------|
| `.github/workflows/release.yml` | +2 jobs (x64 + arm64) | 中 |
| `.github/workflows/test.yml` | +1 job (macOS test) | 小 |
| `.github/workflows/npm-test.yml` | +1 job (build-macos) | 小 |
| `npm-package/bin/sacode.js` | +2 binary map 条目 | 小 |
| `npm-package/bin/install.js` | +2 binary map 条目 | 小 |
| `scripts/check-release.js` | +darwin expectedMap, 移除反向检测 | 中 |
| `npm-package/package.json` | 更新 description | 小 |
| 4 个文档 | 添加 macOS 章节 | 小 |

### 2.4 验收标准

- [ ] GitHub Actions release 可生成 `darwin-x64` 和 `darwin-arm64` 二进制
- [ ] `npm install -g @cherishron/sacode` 在 macOS 上成功安装并运行
- [ ] `sacode --version` 在 macOS Intel 和 Apple Silicon 上正常输出
- [ ] `cargo test --workspace` 在 macOS CI 通过
- [ ] `scripts/check-release.js` 不因 macOS 相关文案报错

---

## 3. P1：增量索引缓存

### 3.1 现状分析

当前 `code.symbols`、`code.deps` 每次都全量重解析：

```
execute() → collect_source_files() → 对每个文件调用 AstEditor::summarize()
                                    → parse_source() → Parser::new() → parser.parse()
```

`runtime/src/store/cache.rs` 仅 58 字节空 stub，`runtime/src/tools/code/` 下搜索 "cache" 关键词 **0 个匹配**。

### 3.2 技术方案

#### A. 文件级 AST 缓存

利用 `AstEditor` 现有接口，添加缓存层：

```rust
// runtime/src/tools/code/cache.rs (新建)

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::SystemTime;

#[derive(Debug, Clone)]
struct FileCacheKey {
    path: std::path::PathBuf,
    modified_at: Option<SystemTime>,
    language: String,
}

#[derive(Debug, Clone)]
struct CachedAst {
    summary: AstSummary,
    cached_at: SystemTime,
}

pub struct AstCache {
    entries: RwLock<HashMap<String, CachedAst>>,
    max_entries: usize,
}

impl AstCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            max_entries,
        }
    }

    pub fn get_or_compute(
        &self,
        path: &std::path::Path,
        language: &str,
        source: &str,
    ) -> anyhow::Result<AstSummary> {
        let modified = std::fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok());

        let cache_key = format!(
            "{}:{}:{}",
            path.display(),
            language,
            modified.map(|t| format!("{:?}", t)).unwrap_or_default()
        );

        // 先读缓存
        {
            let entries = self.entries.read().unwrap();
            if let Some(cached) = entries.get(&cache_key) {
                return Ok(cached.summary.clone());
            }
        }

        // 缓存未命中，解析
        let summary = AstEditor::summarize(language, source)?;

        // 写缓存（LRU 淘汰）
        {
            let mut entries = self.entries.write().unwrap();
            if entries.len() >= self.max_entries {
                // 淘汰最旧的条目
                let oldest = entries
                    .iter()
                    .min_by_key(|(_, v)| v.cached_at)
                    .map(|(k, _)| k.clone());
                if let Some(key) = oldest {
                    entries.remove(&key);
                }
            }
            entries.insert(
                cache_key,
                CachedAst {
                    summary: summary.clone(),
                    cached_at: SystemTime::now(),
                },
            );
        }

        Ok(summary)
    }

    /// 清除指定路径的所有缓存
    pub fn invalidate(&self, path: &std::path::Path) {
        let mut entries = self.entries.write().unwrap();
        let prefix = format!("{}:", path.display());
        entries.retain(|key, _| !key.starts_with(&prefix));
    }
}

/// 全局单例
static AST_CACHE: std::sync::LazyLock<AstCache> =
    std::sync::LazyLock::new(|| AstCache::new(512));
```

#### B. 目录级文件列表缓存

```rust
// runtime/src/tools/code/cache.rs 续

#[derive(Debug, Clone)]
struct DirFileListCache {
    files: Vec<std::path::PathBuf>,
    cached_at: SystemTime,
    dir_modified: Option<SystemTime>,
}

pub struct FileListCache {
    entries: RwLock<HashMap<std::path::PathBuf, DirFileListCache>>,
}

impl FileListCache {
    pub fn get_or_collect(
        &self,
        dir: &std::path::Path,
        language: Option<&str>,
    ) -> anyhow::Result<Vec<std::path::PathBuf>> {
        let dir_modified = std::fs::metadata(dir)
            .ok()
            .and_then(|m| m.modified().ok());

        // 检查缓存
        {
            let entries = self.entries.read().unwrap();
            if let Some(cached) = entries.get(dir) {
                if cached.dir_modified == dir_modified {
                    return Ok(cached.files.clone());
                }
            }
        }

        // 重新收集
        let mut files = Vec::new();
        collect_source_files(dir, language, &mut files)?;

        {
            let mut entries = self.entries.write().unwrap();
            entries.insert(
                dir.to_path_buf(),
                DirFileListCache {
                    files: files.clone(),
                    cached_at: SystemTime::now(),
                    dir_modified,
                },
            );
        }

        Ok(files)
    }
}
```

#### C. 集成到现有工具

修改 `symbol.rs` 和 `deps.rs` 的 `execute()` 函数：

```rust
// runtime/src/tools/code/symbol.rs

use super::cache::{AST_CACHE, FILE_LIST_CACHE};

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    // ...
    // 使用缓存收集文件列表
    let files = FILE_LIST_CACHE.get_or_collect(&resolved_path, language)?;
    // ...

    for file in &files {
        let content = fs::read_to_string(file)?;
        // 使用缓存获取 AST summary
        let summary = AST_CACHE.get_or_compute(file, &selected_language, &content)?;
        // ...
    }
}
```

#### D. 缓存失效触发

| 触发条件 | 操作 |
|---------|------|
| `fs.write` 写入文件 | 调用 `AST_CACHE.invalidate(path)` |
| `fs.edit` 编辑文件 | 调用 `AST_CACHE.invalidate(path)` |
| `fs.patch` 打补丁 | 对每个 patch 文件调用 `AST_CACHE.invalidate(path)` |
| `git.commit` 提交 | 不操作（缓存基于文件 mtime） |

### 3.3 需改动文件

| 文件 | 改动 | 工作量 |
|------|------|--------|
| `runtime/src/tools/code/cache.rs` | **新建**，文件级 + 目录级缓存 | 中 |
| `runtime/src/tools/code/mod.rs` | 注册 `cache` 模块 | 小 |
| `runtime/src/tools/code/symbol.rs` | `execute()` 调用缓存 | 小 |
| `runtime/src/tools/code/deps.rs` | `execute()` 调用缓存 | 小 |
| `runtime/src/tools/fs/` (write/edit/patch) | 添加缓存失效调用 | 中 |
| `runtime/src/tools/code/ast.rs` | `summarize()` 保持纯函数不变 | 无 |

### 3.4 验收标准

- [ ] 同一文件连续两次调用 `code.symbols`，第二次从缓存命中（日志可验证）
- [ ] 文件被 `fs.write` 修改后，缓存自动失效
- [ ] 目录文件无变化时 `collect_source_files` 不重复遍历
- [ ] 缓存条目达到上限（512）后自动淘汰最旧条目
- [ ] 缓存不超过合理内存上限（<50MB）

---

## 4. P2：CI 自动修复

### 4.1 现状分析

当前 `.github/workflows/test.yml` 流程：

```
checkout → setup rust → cargo test --workspace → cargo build --release
→ node scripts/check-release.js → ./target/release/sacode --version
```

**缺失**：
- 无 `cargo fmt --check`
- 无 `cargo clippy`
- 无代码风格/lint 检查
- 无自动修复并推送 commit 的工作流

全仓库搜索 "auto-fix"、"lint-fix"、"format-fix"：**0 个匹配**。

### 4.2 技术方案

#### A. 在现有 test.yml 中添加 lint 检查

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - name: Check formatting
        run: cargo fmt --all -- --check
      - name: Run clippy
        run: cargo clippy --workspace --all-targets -- -D warnings
```

#### B. 独立 auto-fix workflow（PR 触发）

```yaml
# .github/workflows/auto-fix.yml (新建)

name: Auto Fix

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write

jobs:
  format-fix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt
      - name: Auto format
        run: cargo fmt --all
      - name: Check for changes
        id: diff
        run: |
          git diff --exit-code || echo "changed=true" >> $GITHUB_OUTPUT
      - name: Commit and push
        if: steps.diff.outputs.changed == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git commit -am "style: auto-format with cargo fmt [skip ci]"
          git push
```

#### C. 扩展 release 检查

```javascript
// scripts/check-release.js 新增检查项

// 6. 检查 clippy 警告数（可选）
// 7. 检查格式化一致性（可选）
```

### 4.3 需改动文件

| 文件 | 改动 | 工作量 |
|------|------|--------|
| `.github/workflows/test.yml` | 新增 lint job（fmt + clippy） | 小 |
| `.github/workflows/auto-fix.yml` | **新建**，PR 自动格式化推送 | 中 |
| `scripts/check-release.js` | 可选扩展 clippy 检查 | 小 |

### 4.4 验收标准

- [ ] PR 提交后自动运行 `cargo fmt --check` + `cargo clippy`
- [ ] 不符合格式的代码在 lint job 中报红
- [ ] PR 中有格式问题的代码被 auto-fix workflow 自动修复推送
- [ ] release 检查脚本含格式/lint 状态校验

---

## 执行计划

### 时间线

| 批次 | 项目 | 预估工时 | 依赖 |
|------|------|---------|------|
| **第 1 周** | P0 Windows 命令适配 | 3 天 | 无 |
| **第 2 周** | P0 Windows 命令适配（收尾）+ P1 macOS CI | 3 天 | 无 |
| **第 3 周** | P1 macOS npm 链路 + 增量缓存 | 4 天 | 无 |
| **第 4 周** | P1 增量缓存（收尾）+ P2 CI 自动修复 | 2 天 | 无 |

**总计：约 12 个工作日，4 周**

### 推荐执行顺序

```
Week 1: P0 Windows 命令适配 ─────────────────────┐
                                                   │
Week 2: P0 收尾 + P1 macOS CI ────────────────────┤
                                                   │
Week 3: P1 macOS npm + P1 增量索引缓存 ───────────┤
                                                   │
Week 4: P1 缓存收尾 + P2 CI 自动修复 ─────────────┘
```

### 风险与控制

| 风险 | 影响 | 缓解 |
|------|------|------|
| macOS CI 首次接入构建失败 | 延迟 1-2 天 | 先在 fork 中验证 CI 配置 |
| Windows Job Objects API 不稳定 | 进程残留 | 提供 fallback `taskkill /T` 方案 |
| 增量缓存的缓存一致性 bug | 代码智能结果过时 | 基于 mtime 失效，保守策略 |
| PR 自动推送 commit 触发 CI 循环 | 浪费 CI 资源 | commit message 加 `[skip ci]` |

### 边界说明

以下项**不纳入本次方案**：
- macOS 平台的完整 E2E 测试（需额外硬件/time）
- 缓存持久化到磁盘（`rusqlite` 索引存储延长到后续 P3）
- 完整 Windows MSVC 工具链适配（当前 `Dockerfile.win64` 使用 mingw-w64，保持现有路径）

---

## 参考

- [功能升级方案](capability-upgrade-plan.md) — 第一阶段能力补齐
- [竞品重新评估报告](../README.md) — 2026-06-08 版本
- [架构说明](../reference/architecture.md) — 分层与模块关系
- [开发指南](../reference/development.md) — 本地开发环境
- [发布流程](../release/RELEASE.md) — 版本发布链路
- [交叉编译指南](../build/CROSS_COMPILE.md) — 跨平台构建
