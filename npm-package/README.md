# SaCode

SaCode is a terminal-first AI coding assistant built for real repository work: reading code, planning changes, running tools, and keeping execution controllable.

## Install

```bash
npm install -g @cherishron/sacode
sacode --version
```

## Quick Start

```bash
sacode
```

Inside TUI or REPL:

```text
/login
/models
```

Then run a task:

```bash
sacode "analyze the current repository structure"
```

## Common Usage

```bash
sacode                              # open the default TUI
sacode repl                         # open REPL
sacode "fix the failing tests"      # run a build task
sacode "design a refactor plan" --mode plan
sacode "format this repository" --mode auto
git diff | sacode "write a commit message"
```

## TUI Shortcuts

- `Ctrl+Q`: quit
- `Esc`: clear input or cancel current execution
- `Ctrl+T`: toggle thinking
- `Ctrl+M`: switch `plan` / `build` / `auto`

## Built-in Commands

- `/login`
- `/connect`
- `/providers`
- `/models`
- `/memory`
- `/wiki`
- `/loop <task>`

## Project Data

SaCode stores project runtime data in `.sacode/`:

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

## Platform Status

| Platform | Build Status | Support Status | Notes |
|---|---|---|---|
| Linux x64 | 已验收 | 已验收 | Official release platform |
| Windows x64 | 已验收 | 已验收 | Official release platform |
| macOS x64 | 已验收 | 部分验收 | Build configured; real Intel installation validation pending |
| macOS arm64 | 已验收 | 部分验收 | Build configured; real Apple Silicon installation validation pending |

The legacy input value `yolo` remains accepted for compatibility, but user-facing examples and output use `auto`.

## More Docs

- Main docs: `../docs/README.md`
- Getting started: `../docs/guides/getting-started.md`
- Architecture: `../docs/reference/architecture.md`
- Release: `../docs/release/RELEASE.md`

## License

MulanPSL-2.0
