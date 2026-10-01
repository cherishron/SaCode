---
feature: git-platform-oauth
status: delivered
updated: 2026-09-21
branch: dev
commits: uncommitted (dev)
---

# SaCode Git 平台 OAuth 授权（GitHub / Gitee）

## Report

**What was built** — `runtime/src/git_auth/`：GitHub Device Flow、Gitee loopback OAuth、keyring/file 双写 token、git credential helper 协议；CLI `sacode git auth login|status|logout|credential|set-token`；doctor 输出 `git auth: github=ok|unset`；wiki `git-platform-auth.md`。

**Verification**
- `cargo test -p sacode-runtime git_auth` → 7 passed
- `cargo test -p sacode-cli --lib parse_args_parses_git` → 1 passed
- Smoke：set-token → credential 输出 `username=x-access-token` + 干净 password（已去 BOM）；logout 清空 status；login 无 client_id 时提示 `SACODE_GITHUB_CLIENT_ID`

**Journey log**
1. 用户未提供 GitHub/Gitee client_id — 实现 Device/loopback + PAT `set-token` 兼容。
2. Windows 管道 stdin 带 BOM 导致 token 污染 — set-token/credential/store 统一剥 `\u{feff}`。
3. credential helper 仅命中 https + github.com/gitee.com，SSH 不接管。

## [S1] Problem

SaCode 的 `git.push` / `git.pr` 依赖本机 git 凭据；产品内无 GitHub/Gitee 授权入口，token 无处安全存放，也未接入 credential helper。用户需要「浏览器授权 → token 入 keyring → push/pull 可用」。

## [S2] Design

### 命令

```text
sacode git auth login github
sacode git auth login gitee
sacode git auth status
sacode git auth logout [github|gitee]
```

### 授权流（登录真源：sa-idp）

**产品登录必须先走 sa-idp**：`sacode account login`（OIDC）。  
`git auth login`（device/loopback）仅在 identity session 有效后可用；`auth.json` 记录 `idp_subject`。  
`set-token`（PAT）为运维/CI 兼容，不写 `idp_subject`，且不是第二套登录体系。

| 平台 | 模式 | 配置 |
|------|------|------|
| GitHub Device Flow | 打开 `https://github.com/login/device`，用户输入 user_code | `SACODE_GITHUB_CLIENT_ID`（公开客户端；无 secret） |
| GitHub Loopback | `http://127.0.0.1:<port>/callback` + client_id | 同上；需要 OAuth App 的 loopback 允许 |
| Gitee Loopback | `https://gitee.com/oauth/authorize` → token | `SACODE_GITEE_CLIENT_ID` + `SACODE_GITEE_CLIENT_SECRET` |

优先级：**设备码（GitHub）→ loopback 浏览器 → 失败时提示 PAT 兼容路径**（`sacode git auth set-token <host>`，仍写 keyring）。

### 存储（keyring）

| locator | 内容 |
|---------|------|
| `os-keyring:sacode/git/github-token` | GitHub access_token |
| `os-keyring:sacode/git/gitee-token` | Gitee access_token |

会话元数据（无 token 明文）：`~/.sacode/git/auth.json`

### 凭据注入

- Windows：`git config --global credential.helper manager` 不动；新增 **`sacode-git-credential` helper**（或文档要求 helper 调用 `sacode git auth credential`）
- 统一命令：`sacode git auth credential` 按 `protocol/host` 从 keyring 输出 `password=<token>`（stdout，git helper 协议）

```text
# git config
credential.helper=!sacode git auth credential
```

### HTTP 契约（mock 可测）

- GitHub device: `POST https://github.com/login/device/code` → `{device_code,user_code,verification_uri,expires_in,interval}`
- Poll: `POST https://github.com/login/oauth/access_token` `grant_type=urn:ietf:params:oauth:grant-type:device_code`
- Gitee: `POST https://gitee.com/oauth/token` authorization_code；authorize 带 `redirect_uri=loopback`

### Out of Scope

- 企业 GitHub App 安装流、细粒度 OAuth App 管理 UI  
- SSH key 生成/上传  
- 多账号矩阵 UI  

## [S3] Out of Scope

见上；不修改 git 工具实现语义（仍调用本地 git）。

## Tasks

- [x] T1: `runtime/src/git_auth/` keyring + auth.json — acceptance: 往返/注销单测 (covers: S2)
- [x] T2: GitHub device + Gitee loopback + fixture 解析 — acceptance: mock JSON 单测；缺 client_id 可操作错误 (covers: S2; depends: T1)
- [x] T3: `sacode git auth` CLI + credential helper — acceptance: status/set-token/credential/logout smoke (covers: S2; depends: T1)
- [x] T4: wiki + doctor 提示 — acceptance: `git-platform-auth.md` + doctor git auth 行 (covers: S2)
- [x] T5: verify + review — acceptance: 7+1 tests pass；BOM/路径问题已修 (covers: S1–S2)
