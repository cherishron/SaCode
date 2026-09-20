# Desktop sidecar 使用说明

## 架构

```text
Desktop UI (Vite / Tauri WebView)
        │  HTTP + SSE（token 仅内存）
        ▼
sacode serve --port 0 --ready-file <tmp>/ready.json
        │  backend_id 路由
        ├── sacode  native task_runner
        └── opencode ACP (SACODE_OPENCODE_EXECUTABLE)
```

- ready-file **不含 token**；token 只经子进程 env / Tauri invoke 传递。
- 端口由 OS 分配，禁止启动前扫描端口。

## 开发（无 Tauri CLI）

```powershell
# 可选：注册 OpenCode ACP
$env:SACODE_OPENCODE_EXECUTABLE = "C:\Users\jingg\.version-fox\cache\nodejs\v-24.14.1\nodejs-24.14.1\node_modules\bun\bin\bun.exe"
$env:SACODE_OPENCODE_ARGS = "x opencode-ai acp"

cd interfaces/desktop
npm run dev
# Vite 插件会 spawn target/debug/sacode.exe，注入 __SACODE_ENV__
# 页面通过同源 /health /task /agents 访问 daemon
```

或手动 sidecar：

```powershell
node scripts/desktop-sidecar.mjs --workspace E:\Project\sa\saai
# stdout 打印 { baseUrl, port, readyFile }；token 写 .sacode/desktop-sidecar/token
```

## Tauri（待安装 CLI）

```powershell
cargo install tauri-cli
cd interfaces/desktop/src-tauri
# 不把 crate 加入根 workspace，避免 CI 强制编译 Tauri 依赖
cargo tauri dev
```

invoke 命令：`start_daemon` / `stop_daemon` / `daemon_info`。
WebView 侧见 `src/tauri-bridge.ts`。

## 测试

```powershell
cd interfaces/desktop
npm test   # ready-file 解析 + 真实 sacode sidecar handshake
```
