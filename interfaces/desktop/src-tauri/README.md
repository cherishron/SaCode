# Tauri Desktop 壳接入（token 协议）

> 对应 Spec：`docs/compose/spec/desktop-sidecar.md`  
> 本切片交付 Node sidecar + Vite UI；完整 Tauri 二进制后续接入。

## 原则

1. **WebView 不持有 daemon bearer token**。token 由 Rust shell 生成并只注入 `sacode serve` 环境 `SACODE_DAEMON_TOKEN`。
2. ready-file **永不包含** token；只含 host/port/pid/nonce/base_url/auth_required。
3. WebView 仅拿到 `base_url` + 由 shell 注入的短时 token（或经 IPC 每次请求由 shell 附加 Authorization）。
4. 使用 `--port 0`，禁止先扫端口再启动。

## 建议 Tauri 命令

```text
sidecar_start(workspace) -> { base_url, port, nonce }
sidecar_stop()
sidecar_health() -> { ok, version }
daemon_fetch(method, path, body) -> 由 shell 附加 Bearer
```

启动参数：

```text
sacode serve --port 0 --ready-file <user_cache>/sacode-ready-<nonce>.json --nonce <nonce>
env: SACODE_DAEMON_TOKEN=<random>
cwd: workspace
```

## Node 参考实现

```text
interfaces/desktop/scripts/desktop-sidecar.mjs
interfaces/desktop/src/sidecar.ts
```

Vite UI「启动 Sidecar」调用的是本地 shell/脚本能力；纯浏览器模式无 spawn 权限时，回退手工 host/port。

## 验收（本切片）

- `npm test`（parse / health 单测）
- `node scripts/desktop-sidecar.mjs --sacode <sacode.exe> --workdir <workspace>` 输出 `ok:true` 且 ready-file 无 token
