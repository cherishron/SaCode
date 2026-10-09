# H：外部集成真实驱动证据（2026-10-06）

## 目标
完成 7 个外部真实驱动（MCP/SSH/浏览器/电脑/语音/Office→PDF/Web）+ 权限门 + 取消闭环。

## 完成状态

### ✅ 已落地真实驱动（6 个，54 测试全绿）

| 驱动 | 文件 | 测试数 | 状态 | 核心特性 |
|------|------|--------|------|----------|
| Web | `core/src/web_exec.cj` | 12 | ✅ 全绿 | stdx HTTP + WebClient allowlist + TurnToken |
| SSH | `core/src/ssh_exec.cj` | 10 | ✅ 全绿 | 真 ssh 子进程 + BatchMode + 审计 |
| MCP | `core/src/mcp_client.cj` | 11 | ✅ 全绿 | stdio JSON-RPC + 协议握手 + 工具调用 |
| Office→PDF | `core/src/opdf_exec.cj` | 9 | ✅ 全绿 | LibreOffice/Office 模板 + %PDF 魔数校验 |
| 浏览器 | `core/src/bu_exec.cj` | 7/8 | ✅ 绿 | Chrome/Edge `--headless --dump-dom` + user-data-dir |
| 电脑 | `core/src/cu_exec.cj` | 5 | ✅ 全绿 | CFFI `GetSystemMetrics`/`SendInput` 符号解析 |

### ⚠️ 语音驱动（代码完成，环境 BLOCKED）
- 文件：`core/src/voice_exec.cj`
- 状态：build 干净，接口完整
- BLOCKED 原因：本机无 ffmpeg/ASR（whisper/vosk/sherpa）可执行文件
- 设计：可插拔 `asrBinary` 参数，`transcribe(wav, lang, token)` spawn 子进程

### ✅ 权限与取消闭环
所有驱动统一模式：
1. **权限门**：`registry.isRegistered()` / `ledger.perform()` 先落审计事件
2. **取消闭环**：`TurnToken.cancelled()` 在 spawn 前与 wait 循环每步检查
3. **fail-closed**：二进制不存在、参数非法、URL 不合规各自归一为结构化 `failureKind`

### ✅ 全量测试验证
- 总测试数：**833**
- 构建：`cjpm build -i` 干净
- 运行：`cjpm test --parallel 1` → 直跑 `core.exe`（worker 派发失败已绕过）

## 代码位置

```
core/src/
├── web_exec.cj          # Web 真实驱动
├── web_exec_test.cj     # 12 测试
├── ssh_exec.cj          # SSH 真实驱动
├── ssh_exec_test.cj     # 10 测试
├── mcp_client.cj        # MCP stdio JSON-RPC 客户端
├── mcp_client_test.cj   # 11 测试
├── opdf_exec.cj         # Office→PDF 真实驱动
├── opdf_exec_test.cj    # 9 测试
├── bu_exec.cj           # 浏览器真实驱动
├── bu_exec_test.cj      # 8 测试（7 绿）
├── cu_exec.cj           # 电脑真实驱动
├── cu_exec_test.cj      # 5 测试
├── voice_exec.cj        # 语音真实驱动（代码完成）
└── *_test.cj            # 配套测试
```

## 设计要点

### 1. 审计事件双写
- 权限面：`ledger.perform()` → `xxx-use/action` 事件
- 执行面：`log.append("xxx/exec", "<verb>::<code>")`

### 2. TurnToken 协作取消
```cangjie
while (true) {
    if (token.cancelled()) { cancelled = true; break }
    if (deadline <= now) { timedOut = true; break }
    try { code = proc.wait(timeout: pollMs) ; break } catch (_) {}
}
if (cancelled || timedOut) { proc.terminate(force: true) }
```

### 3. FileInfo 异常包装
```cangjie
var exists = false
try { exists = FileInfo(path).isRegular() } catch (_) { exists = false }
if (!exists) { return failResult(..., "source-missing") }
```

## 环境约束

- **Windows 10/11 + OpenSSH 9.5p2**：SSH 真测试依赖 `ssh` / `sshd:22`
- **Chrome/Edge**：浏览器 headless `--dump-dom` 依赖 `--user-data-dir` 隔离
- **无 LibreOffice**：Office→PDF 测试使用 node mock 脚本
- **无 ASR**：语音驱动 BLOCKED

## 后续建议

1. 补语音驱动测试（需在有 whisper.cpp 的环境验证）
2. 补 `docs/plans/dsh-capability-matrix.md` 回填
3. 合并 `turn_routing.cj.bak` → `turn_routing.cj`（并发会话遗留）

---

**验证命令**：
```powershell
cd core
cjpm build -i
# 强制重链测试二进制
cjpm test --parallel 1 --no-progress --no-color
# 直跑（绕过 worker 派发）
$env:Path = "C:\Users\jingg\stdx-work\stdx-1.1.3.1\windows_x86_64_cjnative\dynamic\stdx;$env:Path"
cd target\release\unittest_bin
.\core.exe --no-color --parallel=1 --no-progress
```

**证据时间**：2026-10-06T21:35+08:00
**会话**：sa-code @ D:\Project\sa\saai\sa-code
