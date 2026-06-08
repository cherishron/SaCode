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
sacode "format this repository" --mode yolo
git diff | sacode "write a commit message"
```

## TUI Shortcuts

- `Ctrl+Q`: quit
- `Esc`: clear input or cancel current execution
- `Ctrl+T`: toggle thinking
- `Ctrl+M`: switch `plan` / `build` / `yolo`

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

## Supported Platforms

- Linux x64
- Windows x64
- macOS x64 (Intel)
- macOS arm64 (Apple Silicon)

## More Docs

- Main docs: `../docs/README.md`
- Getting started: `../docs/guides/getting-started.md`
- Architecture: `../docs/reference/architecture.md`
- Release: `../docs/release/RELEASE.md`

## License

MulanPSL-2.0
