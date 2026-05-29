# SaCode

Terminal-first AI coding assistant.

## Install

```bash
npm install -g @cherishron/sacode
```

## Usage

```bash
sacode                     # 进入聊天式 TUI
sacode "分析代码结构"       # Build 模式执行
sacode /commit             # 使用 skill
sacode "修复 bug" --mode build
sacode --help
```

## TUI Interface

默认进入聊天式终端 UI：

- **Ctrl+Q**: 退出
- **Esc**: 清空输入
- **↑/↓**: 滚动历史
- **Enter**: 发送任务

## Modes

- `--mode plan`: 仅生成计划，不执行
- `--mode build`: 生成计划并执行，高风险操作需审批
- `--mode yolo`: 全自动执行（谨慎使用）

## Commands

```bash
sacode profile ls       # 列出配置
sacode skill list       # 列出 skills
sacode mcp list         # 列出 MCP 服务
sacode checkpoint list  # 列出保存点
sacode repl             # 进入 REPL 模式
sacode serve --acp --lsp
```

## Configuration

项目级配置和运行数据默认写入 `.sacode/`：

```text
.sacode/
├── provider.json
├── mcp.json
├── profile.json
├── mistakes.json
├── project.json
├── skills/
└── checkpoints/
```

## Supported Platforms

- Linux x64
- Windows x64

## License

MIT
