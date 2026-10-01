---
feature: tauri-desktop-m2
status: delivered
updated: 2026-09-21
branch: dev
commits: uncommitted (working tree on top of 877749b)
---

# Tauri Desktop M2（sidecar + IPC 代理 + MVP UI）

## Report

**What was built** — Tauri 壳接入 workspace：`interfaces/desktop/src-tauri` 持有 `sacode serve` sidecar 与 daemon bearer token；WebView **不接收 token**。命令：`start_daemon` / `stop_daemon` / `daemon_info` / `daemon_proxy`（path 白名单校验）/ `start_event_bridge`（Rust 拉 SSE 再 emit `daemon-event`）。前端 M2 UI：Workspace 连接、Daemon/Agents、Session 时间线、Run/Stop、Approvals 允许/拒绝、Changes（fs.write 等工具事件）、Settings/诊断导出。Tauri 走 `createTauriTransport()`；Vite 模式继续同源代理。

**Verification** —
- `npm run typecheck` + `npm test`（desktop）→ PASS 6
- `npm run build` → PASS（client-core 需 ESM：`module: ES2022` + `dist/cjs/package.json` type=commonjs）
- `cargo check -p sacode-desktop` → PASS
- `cargo test -p sacode-desktop` → PASS 3（proxy path / DTO 无 token）

**Journey log** —
1. Tauri 2 `bundle.identifier` 未知字段；`frontendDist` 需存在；Windows 需合法 `icons/icon.ico`。
2. client-core 原 Node16 构建输出 CJS 到 `dist/index.js`，Vite 无法 import `DaemonClient` — 改 ESM 构建。
3. Token 协议：DTO 与 WebView 均不带 token；仅 `daemon_proxy` / event bridge 在 Rust 内附加 Bearer。

## [S1] Problem

Desktop 需要可运行的 Tauri 客户端：自动启动 daemon sidecar、完成任务/审批/变更查看，且遵守 PRD「token 只在 Rust shell」。

## [S2] Design

### 安全

- ready-file 无 token；`SidecarHandleDto` 无 token 字段
- WebView 仅 invoke：`daemon_proxy(method, path, body?)`
- `validate_proxy_path`：必须以 `/` 开头，禁止 `://`、`..`、host:port 嵌入

### IPC

| Command | 作用 |
|---------|------|
| start_daemon(workspace?) | spawn serve，health 校验，返回 handle（无 token） |
| daemon_proxy | HTTP 代理 + Bearer |
| start_event_bridge | `/api/stream` → emit `daemon-event` |
| stop_daemon | 杀进程 + 清 ready-file |

### UI（vanilla TS）

`src/app/service.ts` + `src/app/ui.ts`：session timeline、approvals、changes、settings。

## [S3] Out of Scope

- NSIS/DMG 发布打包门禁
- 多 workspace 多 sidecar
- 远程 TLS daemon
- 完整 Diff 渲染（当前 Changes 为工具事件卡片）

## Tasks

- [x] T1: Rust sidecar 持 token + proxy path 校验 — acceptance: cargo test 3 PASS
- [x] T2: IPC transport + client-core ESM — acceptance: desktop tests PASS
- [x] T3: M2 UI（session/approval/changes/settings）— acceptance: typecheck + vite build PASS
- [x] T4: cargo check sacode-desktop — acceptance: PASS
