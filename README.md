# SaCode

SaCode 是一个终端优先的 AI 编程工具，已完成从 Node/TS 到 Rust 的完整迁移。

## 安装

```bash
npm install -g @cherishron/sacode
sacode --version
```

## 项目结构

```text
.
├── Cargo.toml          # Workspace 配置
├── kernel/             # 纯逻辑层
├── runtime/            # 副作用层
├── interfaces/cli/     # CLI 入口
├── npm-package/        # npm 发布包
└── docs/               # 文档
```

## 核心架构

### `kernel/`

纯逻辑层，无副作用：

- `agent`: Planner、Coder、Reviewer、Supervisor
- `schema`: Task、Session、Plan、Step、Checkpoint
- `event`: 统一事件模型
- `error`: 统一错误类型

### `runtime/`

副作用和能力层：

- `tools`: FS、Shell、Git 工具
- `provider`: ProviderClient (OpenAI、DeepSeek、Ollama)
- `plugin`: WASM 插件加载
- `daemon`: SSE 服务
- `sandbox`: 执行沙箱

### `interfaces/cli/`

CLI 入口 `sacode` 命令：

- 默认进入聊天式 TUI
- 支持 Ghost、REPL、Daemon 模式

## CLI 使用

### TUI 模式（默认）

```bash
sacode                    # 进入聊天式终端 UI
```

TUI 界面为聊天式交互：
- 上方显示对话历史
- 底部输入框接收任务
- 支持 Ctrl+Q 退出、Esc 清空输入

### Ghost 模式

```bash
sacode "分析代码结构"              # Build 模式执行
sacode "设计方案" --mode plan      # 仅规划
sacode "格式化代码" --mode yolo    # 全自动执行
cat README.md | sacode "总结"      # stdin 输入
sacode "找 bug" --json             # JSON 输出
```

### REPL 模式

```bash
sacode repl               # 进入 REPL 交互
```

### Daemon 模式

```bash
sacode daemon --port 3000 # 启动 HTTP + SSE 服务
```

## 子命令

```bash
sacode profile ls         # 列出 profile
sacode profile use <name> # 切换 profile
sacode plugin ls          # 列出插件
sacode checkpoint list    # 列出 checkpoint
sacode init               # 初始化配置
```

## 工具系统

| 工具 | 描述 | 需审批 |
|------|------|--------|
| fs.read | 读取文件 | 否 |
| fs.search | 搜索内容 | 否 |
| fs.write | 写入文件 | 是 |
| git.diff | Git diff | 否 |
| shell.exec | Shell 命令 | 是 |

## 文档

- `docs/PRD.md`: 产品需求文档
- `docs/API.md`: API/CLI 文档
- `docs/release/RELEASE.md`: 发布流程
- `docs/build/CROSS_COMPILE.md`: 交叉编译
- `CHANGELOG.md`: 版本变更

## 发布

```bash
# 版本同步
node scripts/sync-version.js <version>

# 构建产物
cargo build --release
cargo build --release --target x86_64-pc-windows-gnu

# 平台清单
node scripts/write-platform-manifest.js <version>

# 发布检查
node scripts/check-release.js --strict-platforms

# npm 发布
cd npm-package && npm publish --access public
```

## 归档

`legacy/` 保留旧 Node/TS 代码作为历史参考，不参与编译。

## 许可证

[MulanPSL-2.0](./LICENSE)
