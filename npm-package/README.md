# SaCode

Terminal-first AI coding assistant.

## Install

```bash
npm install -g @cherishron/sacode
```

## Usage

```bash
sacode
sacode "分析代码结构"
sacode "修复登录 bug" --mode build
sacode --help
```

`sacode` 无参数时会直接进入终端 TUI。

## Modes

- `--mode plan`: 仅生成计划，不执行
- `--mode build`: 生成计划并执行，高风险操作需审批
- `--mode yolo`: 全自动执行（谨慎使用）

## Commands

```bash
sacode profile ls       # 列出配置
sacode checkpoint list  # 列出保存点
sacode tui              # 显式进入终端 TUI
sacode repl             # 进入 REPL 模式
```

## Configuration

创建 `~/.sacode/profiles.yaml`:

```yaml
current: default

providers:
  openai:
    api_key_env: OPENAI_API_KEY
  deepseek:
    api_key_env: DEEPSEEK_API_KEY

profiles:
  default:
    agents:
      planner: { provider: openai, model: gpt-4o }
      coder: { provider: deepseek, model: deepseek-coder }
```

## Supported Platforms

- Linux x64
- Windows x64

macOS binaries are planned and are not included in the current npm package.

## License

MIT
