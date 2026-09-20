---
feature: desktop-sidecar
status: delivered
updated: 2026-09-20
branch: dev
commits: uncommitted (dev main worktree)
---

# Desktop Sidecar（sacode serve ready-file 握手）

## Report

**What was built** — Desktop sidecar 切片（T11）：`interfaces/desktop/src/sidecar.ts`（ready-file 解析、health 轮询）；`scripts/desktop-sidecar.mjs`（spawn `sacode serve --port 0`、nonce 校验、默认不打印 token）；Vite 插件改为**仅进程内 token + 代理注入**（不落盘、不进 `__SACODE_ENV__`）；UI 启停按钮与 `memoryToken`（不写 DOM）；`src-tauri/README.md` 协议说明。

**Verification**
- `npm run typecheck`（desktop）— PASS
- `npm test`（desktop sidecar）— 3 passed
- `npm run sidecar` — `ok:true` `base_url=http://127.0.0.1:5966` health v1.1.1；ready-file 无 token 字段
- 审查 critical：package.json `sidecar` 已指向 `scripts/desktop-sidecar.mjs`；Vite 不再把 token 注入 WebView

**Journey log**
1. 审查指出 token 落盘 + WebView 注入违反 S2 — 改为 Vite 服务端内存 + 代理 Authorization。
2. `npm run sidecar` 相对路径 spawn ENOENT — 脚本内用绝对 `target/debug/sacode.exe`。
3. 与 sa-idp 联调另见 I3 e2e（本机 8080）：Login OK、models=gpt-mock-test。

**关联 I3（sa-idp 实测，非本 spec 交付物）**
- `scripts/e2e-identity-i3.ps1` → I3 E2E PASS；`account models` 在 `SACODE_IDENTITY_INSECURE_FILE_SECRETS=1` 下 Synced 1 model。

## [S1] Problem

Desktop 客户端需要本机 `sacode serve` daemon，但端口固定 8080 会与其它进程冲突（例如 sa-idp），且 WebView 不应持有 daemon bearer token。计划中的 T11 切片要求：Desktop 能**启动** sidecar、**读取 ready-file** 得到真实 `base_url`，并把 token 留在宿主进程；当前仅有 Vite UI 手工填 host/port，无自动握手。

## [S2] Design

### 契约（与 runtime daemon 一致）

`sacode serve --port 0 --ready-file <path> [--auth-token <token>] [--nonce <n>]`  
ready-file JSON（**不含 token**）：

```json
{
  "schema_version": 1,
  "host": "127.0.0.1",
  "port": 49152,
  "pid": 12345,
  "version": "1.1.1",
  "protocol_version": 1,
  "base_url": "http://127.0.0.1:49152",
  "nonce": "...",
  "auth_required": true
}
```

Token 仅通过 sidecar 进程环境 / stdout 旁路传给 UI 配置，不写入 ready-file。

### 组件

| 组件 | 职责 |
|------|------|
| `interfaces/desktop/src/sidecar.ts` | ReadyInfo 类型、parse/validate、`connectFromReady`（health 轮询） |
| `interfaces/desktop/scripts/desktop-sidecar.mjs` | Node sidecar：生成 token+nonce、spawn `sacode serve`、等 ready-file、health、打印 JSON 摘要（token 仅 stdout 一次） |
| `interfaces/desktop/src/main.ts` | 「启动 Sidecar / 停止」按钮；成功后回填 host/port/secret 到 DaemonClient |
| `interfaces/desktop/src-tauri/README.md` | Tauri 壳接入说明（shell 持 token；WebView 只拿 port）；完整 Tauri 二进制不在本切片验收内 |

### 启动流程

1. 生成 nonce、可选高熵 token  
2. `--port 0 --ready-file <tmp>/sacode-ready-<nonce>.json --nonce <n>`（可选 env `SACODE_DAEMON_TOKEN=<token>`）  
3. 轮询 ready-file：`schema_version==1`、`port>0`、`nonce` 匹配、`base_url` 合法  
4. `GET {base_url}/health` 直至 `status=healthy` 或超时（默认 20s）  
5. UI 使用 base_url；若 `auth_required` 则带 Authorization Bearer（仅内存）  
6. 停止：杀 pid 进程树；尽量删除 ready-file  

### 安全（Vite 代理模式 · 审查后修正）

- `__SACODE_ENV__` **不得**注入 `SACODE_AUTH_TOKEN`；不写 `.sacode/desktop-sidecar/token` 落盘。
- Vite `configureServer` 在 **Node 进程内存** 持有 token，仅由中间件附加 `Authorization`。
- WebView/`main.ts` 不从 env 读 token；bridge 回传的 token 只进 `memoryToken`，不写 DOM。
- CLI sidecar 脚本默认 **stdout 不打印 token**（`--print-token` 才输出）。

### Out of Scope / 边界

- 完整 Tauri 打包、NSIS/DMG 发布  
- 多工作区多 sidecar 并发  
- 远程 daemon TLS  

## [S3] Out of Scope

见上节；网关/sa-idp/模型目录不在本切片。

## Tasks

- [x] T1: desktop `sidecar.ts` ReadyInfo 解析与 health 校验 — acceptance: 单测通过 (covers: S2)
- [x] T2: `scripts/desktop-sidecar.mjs` 启动/等待/摘要输出 — acceptance: live sacode ready+health；stdout 无 token (covers: S2; depends: T1)
- [x] T3: main.ts Sidecar 启停 + memoryToken（不写 DOM）— acceptance: typecheck PASS (covers: S2; depends: T1)
- [x] T4: `src-tauri/README.md` 协议说明 — acceptance: token 协议已写明 (covers: S2)
- [x] T5: npm test + typecheck + live sidecar — acceptance: 3 tests + sidecar ok:true (covers: S2)
- [x] T6: 独立 review 并修复 critical — acceptance: sidecar 脚本路径 + Vite token 安全已修 (covers: S1–S2)
