# VSCode 扩展使用与 daemon 排障

SaCode VSCode 扩展位于 `interfaces/vscode/`，要求 VS Code `1.85.0` 或更高版本。扩展 0.2.1 要求 SaCode daemon 1.1.1 或更高版本。扩展通过本地 HTTP/SSE 连接 `sacode serve`，支持任务发起、选区上下文注入、工具/diff 展示和 Build 模式审批。

## 安装

### 从源码运行

```bash
cd interfaces/vscode
npm ci
npm run compile
```

然后在 VS Code 中打开该目录，按 `F5` 启动 Extension Development Host。

运行扩展测试：

```bash
npm test
```

### 从 VSIX 安装

使用锁文件中的固定 VSCE 版本打包并安装生成的 VSIX：

```bash
cd interfaces/vscode
npm ci
npm run package:vsix
code --install-extension sacode-vscode-0.2.1.vsix --force
```

`package:vsix` 会调用 `scripts/normalize-vsix.py` 固定 ZIP 条目顺序、时间戳和压缩参数。发布门禁连续构建两次并比较 SHA-256，禁止改用浮动版本的 `npx vsce`。

若 `code` 命令不可用，在 VS Code 扩展视图的菜单中选择 **Install from VSIX...**。

仓库内的 `sacode ide install` 会输出基于当前源码目录的编译/安装指引；正式发布包与兼容矩阵以对应版本的发布说明为准。

## daemon 自动管理

扩展激活时会执行以下流程：

1. 请求配置地址的 `GET /health`；
2. 若已有 daemon 状态健康且版本满足最低要求，直接复用，不再启动子进程；
3. 若地址可达但 daemon 版本过旧、缺少版本字段或报告非健康状态，显示错误且不启动第二个进程；
4. 只有连接失败时，才执行 `sacode serve --port=<port> --host=<host>`；
5. 每 2 秒检查一次健康状态，最多 10 次；
6. 扩展退出时，只清理它自己启动的 daemon 子进程，不终止预先存在的 daemon。

状态栏含义：

- `$(check) SaCode`：daemon 可用；
- `$(sync~spin) SaCode`：正在启动；
- `$(error) SaCode`：启动或健康检查失败。

可从命令面板执行：

- **SaCode: Run Task**
- **SaCode: Check Status**
- **SaCode: Stop Task**
- **SaCode: Restart Daemon**
- **SaCode: Configure**

## 设置

```json
{
  "sacode.daemonHost": "127.0.0.1",
  "sacode.daemonPort": 8080,
  "sacode.binaryPath": "sacode"
}
```

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `sacode.daemonHost` | `127.0.0.1` | daemon 主机；通常保持 loopback |
| `sacode.daemonPort` | `8080` | daemon HTTP/SSE 端口 |
| `sacode.binaryPath` | `sacode` | 可执行文件名或绝对路径 |

Windows 绝对路径示例：

```json
{
  "sacode.binaryPath": "C:\\Tools\\sacode.exe"
}
```

修改 host/port/binaryPath 后，建议执行 **Developer: Reload Window**，确保 HTTP 客户端与 daemon 管理器使用同一组启动时配置。

## 安全建议

`sacode serve` 当前没有内建认证或 TLS。扩展默认只连接 `127.0.0.1:8080`，这是预期安全边界。

- 不要为了远程接入直接把 daemon 绑定到 `0.0.0.0`；
- 不要通过端口转发把未认证 daemon 暴露给不可信用户；
- 必须远程使用时，在网络层增加 TLS、认证、访问控制与防火墙规则；
- 审批弹窗只能降低误操作风险，不能替代 daemon 的网络访问控制。

完整协议见 [Daemon HTTP、SSE 与审批 API](../reference/daemon-api.md)。

## 审批交互

Build 模式中的非 `mcp.*` 工具调用会产生审批请求。扩展展示：

- 工具名；
- 副作用级别；
- 文件路径、命令或参数摘要；
- 允许和拒绝选项。

关闭 QuickPick 等价于拒绝，理由为 `user_dismissed`；显式拒绝使用 `user_denied`。审批提交失败时，扩展允许用户重试或关闭。daemon 端等待超过 300 秒、任务取消或审批通道关闭时都会默认拒绝。

每次审批都有独立 `approval_id`。扩展会去重同一任务流中的重复请求，避免相同 SSE 事件重复弹窗；过期或已处理的审批再次提交会返回 404，不会批准后续工具调用。

扩展首次建立 SSE 与断线重连成功后会查询 `GET /task/<id>/approvals`，恢复连接前或离线期间仍在等待的审批。恢复结果和 SSE 回放共享 `approval_id` 去重状态，因此不会为同一请求重复弹窗。

## 常见问题

### 状态栏一直显示 starting

1. 在终端运行 `sacode --version`，确认可执行文件可用；
2. 若不在 PATH，设置 `sacode.binaryPath` 为绝对路径；
3. 手动运行 `sacode serve --host=127.0.0.1 --port=8080` 查看启动错误；
4. 检查端口是否被其他进程占用；
5. 确认扩展设置的 host/port 与手动启动参数一致。

### 显示 daemon error 或 “Failed to start SaCode daemon”

常见原因：

- `sacode.binaryPath` 不存在或无执行权限；
- 二进制版本低于扩展声明的最低 daemon 版本；
- 端口已占用；
- 安全软件阻止子进程启动；
- daemon 启动后在健康检查时间内退出。

先手动执行相同命令：

```bash
sacode serve --host=127.0.0.1 --port=8080
```

Windows 上若配置绝对路径，确认 JSON 中反斜杠已写成 `\\`。

### 手动 daemon 正常，但扩展仍连接失败

- 请求 `http://127.0.0.1:8080/health` 确认地址可达；
- 检查 `sacode.daemonHost` / `sacode.daemonPort`；
- 修改配置后重新加载 VS Code 窗口；
- 确认没有同时运行两个不同端口或不同版本的 daemon；
- 查看 **Help → Toggle Developer Tools** 中的扩展错误。

### 审批弹窗不出现

- 确认任务模式是 `build`；`plan` 不执行工具，`auto` 不走此交互审批；
- `mcp.*` 工具当前不走 daemon 的该审批决策器；
- 确认使用支持 `approval_id` 的扩展和 daemon 版本；
- 查询 `/task/<id>/approvals`，确认 daemon 当前是否仍有待审批条目；
- 查询 `/task/<id>/status`，确认任务尚未结束或取消。

扩展会在 SSE 连接和重连成功后自动查询待审批列表。如果客户端完全未应答，daemon 会在 300 秒后自动拒绝，任务不会因缺少 UI 响应而无限等待。

### 审批提交返回 404

表示 `approval_id` 不存在、已经处理、已超时或因任务取消被清理。关闭旧弹窗并刷新任务状态，不要把该 ID 用于新的审批。

### 审批提交返回 409

表示 `approval_id` 属于另一任务。通常由陈旧 UI、错误缓存或客户端把 task ID 配对错导致。关闭该审批 UI，重新订阅正确任务，不要修改 ID 后盲目重试。

### SSE 中断或事件缺失

扩展在首次连接失败时报告错误；已成功建立的任务流意外中断后，会等待 1 秒自动重连并携带最后收到的 `Last-Event-ID`。每次重连成功还会查询 `/task/<id>/approvals` 恢复仍在等待的审批。历史缓冲只有 256 条且 daemon 重启后不保留，待审批状态也仅存在于当前 daemon 进程内，不能把二者当作持久化日志。

### Stop Task 后仍看到 approval_resolved

这是预期行为。取消任务会清理 pending 审批，使等待者立即以 `approved=false`、`reason=cancelled` 收口；SSE 可能先后看到 `task_cancelled` 与该 `approval_resolved`。客户端应按 `task_id` 和 `approval_id` 幂等处理。
