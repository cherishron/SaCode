# SaCode Agent Notes

## Repo Shape

- This is a Rust workspace. Real members come from root `Cargo.toml`: `kernel/`, `runtime/`, `interfaces/cli/`, `interfaces/acp/`, `interfaces/lsp/`.
- Dependency direction is strict: `interfaces/* -> runtime -> kernel`.
- `kernel` holds pure execution logic and shared data structures. `runtime` holds side effects and wiring. User-facing CLI/TUI/REPL code lives in `interfaces/cli/`.
- `npm-package/` is the publishable wrapper. `legacy/` is archive material and does not participate in current builds.

## Real Entrypoints

- CLI dispatch lives in `interfaces/cli/src/cmd/mod.rs`.
- Running `sacode` with no args opens the TUI.
- Actual binaries are defined in `interfaces/cli/Cargo.toml`: `sacode` and `sacode-tui`.
- Current top-level commands include `repl`, `tui`, `serve`, `acp`, `lsp`, `init`, `init-deep`, and direct task execution via `sacode "<task>"`.
- `run_with_orchestrator(...)` in `interfaces/cli/src/cmd/mod.rs` is the current multi-agent / structured summary path.

## High-Value Commands

- Full test suite: `cargo test --workspace`
- Release build: `cargo build --release`
- Run CLI: `cargo run -p sacode-cli --bin sacode`
- Focused package tests:
  - `cargo test -p sacode-kernel`
  - `cargo test -p sacode-runtime`
  - `cargo test -p sacode-cli`
- Release consistency check: `node scripts/check-release.js`
- Strict release artifact check: `node scripts/check-release.js --strict-platforms`

## CI Order

- `.github/workflows/test.yml` runs in this order:
  1. `cargo test --workspace`
  2. `cargo build --release`
  3. `node scripts/check-release.js`
  4. `./target/release/sacode --version`
- If your change affects packaging or release flow, verify in that same order.
- `npm-package/**` changes also trigger `.github/workflows/npm-test.yml`, which copies built binaries into `npm-package/platforms/` and validates `node npm-package/bin/sacode.js --version` on Linux and Windows.

## Release Truths

- Version source of truth is root `Cargo.toml` `[workspace.package].version`.
- npm package name is fixed: `@cherishron/sacode`.
- Version sync script: `node scripts/sync-version.js <version>`.
- Platform manifest script: `node scripts/write-platform-manifest.js <version>`.
- `scripts/check-release.js` enforces:
  - npm version matches workspace version
  - `bin.sacode` points to `./bin/sacode.js`
  - install script is `node bin/install.js`
  - npm README mentions `npm install -g @cherishron/sacode`
  - only Linux x64 and Windows x64 are advertised
  - `npm-package/platforms/manifest.json` matches expected files

## Platform Constraints

- npm artifacts currently support only:
  - `sacode-linux-x64`
  - `sacode-win32-x64.exe`
- GitHub release builds Windows with `x86_64-pc-windows-msvc`.
- Local cross-compile docs and `.cargo/config.toml` use `x86_64-pc-windows-gnu`.
- Keep local-flow changes and GitHub Actions changes distinct; they target different Windows toolchains.

## Init Behavior

- `sacode init` and `sacode init-deep` are both implemented in `interfaces/cli/src/cmd/init.rs`.
- Init is a two-step design: build draft first, then apply draft. Reuse `build_init_draft(...)` and `apply_init_draft(...)` instead of bypassing that flow.
- `.gitignore` handling uses the `ignore` crate for real gitignore semantics.
- Root `AGENTS.md` updates merge existing content instead of blind overwrite when the file already exists.

## Runtime Data

- Project runtime data lives under `.sacode/`.
- Important files and dirs:
  - `provider.json`
  - `mcp.json`
  - `profile.json`
  - `mistakes.json`
  - `project.json`
  - `skills/`
  - `checkpoints/`
- TUI log file: `~/.sacode/logs/tui.log`

## Current Architecture Hotspots

- `runtime/src/agents/` contains current role-driven orchestration, worker summaries, and structured conflict handling.
- `kernel/src/execution/report.rs` is the data source for `SummaryRecord`, `ConflictRecord`, and related structured output.
- `runtime/src/model_routing/` holds task profiling and routed model types.
- `runtime/src/memory/` and `runtime/src/wiki/` back the current knowledge / memory flow.

## Easy-to-Guess Wrong

- This repo has no root `package.json`, no `rustfmt.toml`, no `clippy.toml`, and no `.pre-commit-config.yaml`; do not assume extra JS or hook workflows exist.
- `shell.exec` and `fs.search` currently rely on Unix commands (`sh`, `grep`), so Windows behavior is still a real constraint in runtime code.
- If prose docs disagree with scripts or workflows, trust `Cargo.toml`, `.github/workflows/*`, and `scripts/check-release.js`.
