# 2026-10-19 c4 验收 bug 修复批次

## 来源

c4 用户手动验收反馈的 6 个 bug + shell 执行通路扩展任务。

## 修复清单

### Bug1：权限模式切换报 turn-in-flight 原始错误码

- **现象**：turn 进行中切换权限模式，Host 回 `-32001 turn-in-flight`，前端弹原始协议码。
- **修法**：`apps/desktop/renderer/pages/permission-menu.ts` 的 `errorText` 识别 `turn-in-flight`，显示"执行中不能切换权限模式，请等待当前任务完成。"
- **测试**：`apps/desktop/test/permission-menu.test.mjs` 新增 1 例，验证 IPC 包装后 `turn-in-flight` 显示友好提示、不含 `-32001` / `turn-in-flight` 原始码。

### Bug3b：折叠展开没对齐

- **现象**：流式消息文本逐字增长，中途越过 240 字符阈值时 `foldPlan` 突然返回 `folded:true`，fold 按钮凭空出现、正文从全显截成 240 字 + 省略号，布局跳位。
- **根因**：`app.js` TextBubble 对所有消息（含 `live-<sid>` 流式消息）统一应用 `foldPlan`。流式期间文本长度变化导致折叠态频繁切换。
- **修法**：流式消息（`m.live` 为 true）跳过 `foldPlan`，始终全显 `{ folded: false, shown: text }`。只有结算后（id 变 `event-<n>`、`live` 假）才应用折叠阈值。
- **影响文件**：`apps/desktop/renderer/app.js` TextBubble setup。

### Bug3c：工具结果卡底部没有复制等操作

- **现象**：工具结果卡展开后只有参数和结果正文，无复制按钮。
- **修法**：`apps/desktop/renderer/pages/tool-card.ts` 展开结果区底部加 `tool-actions` 区，含"复制结果"按钮。点击后 `navigator.clipboard.writeText(body)`，退化用临时 `textarea + execCommand` 兜底（Electron file:// 下 CSP 可能限制 clipboard API）。复制后短暂显示"已复制"（1.5s 后恢复）。
- **测试**：`apps/desktop/test/tool-card.test.mjs` 新建 3 例：①展开后有复制按钮；②点击写入剪贴板并显示已复制；③无 clipboard API 时退化到 execCommand 兜底。

### Bug4：重命名报 session-revision-conflict

- **现象**：turn 进行中会话 durableCount 增长，`entry.durable` 作为 `expectedRevision` 过期，Host 回 `session-revision-conflict`，重命名失败。
- **修法**：
  1. `apps/desktop/renderer/session-catalog.js` 的 `catalogError` reasons map 加 `session-revision-conflict` 友好提示。
  2. `apps/desktop/renderer/session-state.js` 的 `mutateMetadata` 捕获 `session-revision-conflict` 后自动重读 catalog 拿新 `durable` 再试一次。重读到临时变量，找到 fresh entry 才更新 catalog（不覆盖原目录）；找不到则 rethrow（不无限重试）。
- **测试**：`apps/desktop/test/session-state.test.mjs` 新增 2 例：①冲突后自动重读 catalog 拿新 revision 再试成功；②冲突后重读 catalog 找不到目标会话则报错。

### Bug5：选择卡片提交后 request-provider-failed

- **现象**：选择卡片提交后显示 `request-provider-failed`，无具体原因（凭据过期？baseUrl 不可达？Host 路由错误？），用户无法排查。
- **根因**：`core/src/request_trace.cj` line 126 `throw Exception("request-provider-failed")` 丢失了已分类的 reason（rate-limit/server/client/connection/timeout + HTTP 状态码）。`classifyProviderError` 已脱敏分类，但异常 message 不携带结果。
- **修法**：
  1. `core/src/request_trace.cj`：`throw Exception("request-provider-failed:${reason}")` 携带已脱敏的 reason。reason 只含稳定类目 + HTTP 状态码，不含原始异常文案。
  2. `core/src/model_agent.cj`：`finish = "error:${e.message}"` 自动携带 reason（无需改）。
  3. `apps/desktop/renderer/turn-poll-state.js`：加 `request-provider-failed` 的友好提示映射，按类目（rate-limit/server/client/connection/timeout）显示人话。
  4. `core/src/request_trace_test.cj`：断言从 `@Expect(failure, "request-provider-failed")` 改为 `startsWith` + `!=` 验证 reason 后缀。
- **测试**：`apps/desktop/test/turn-poll-state.test.mjs` 新增 1 例，验证 5 种分类（server:500/rate-limit:429/client:401/connection/timeout）均显示友好提示。

### 扩展：shell 执行通路（bash + pwsh 两条 io-error:shell-*）

- **现象**：用户实测 `io-error:shell-pwsh` 和 `io-error:shell-bash` 两个变体同一通路阻塞，且无真实异常原因。
- **根因**：`core/src/shlex.cj` `runOwnedProcess` catch 块 `return None` 吞掉异常，上游 `agent.cj` line 940-944 只生成 `io-error:shell-${toolName}`（无原因）。
- **修法**：catch 块返回 `Some(ShellResult(-1, "", "", false, "process-start-failed:${e.message}", ...))` 携带异常 message。上游 `agent.cj` line 910-914 已能处理 `r.error`：`io-error:shell-${toolName}:${r.error}`。
- **测试**：
  1. `apps/desktop/test/support/development-task-fixture.cjs` 加 `shell` 参数（'pwsh'/'bash'），按变体生成不同命令格式和工具名。
  2. `apps/host/test/session/development-task.test.mjs` 新增 bash 变体测试用例，验证 `io-error:shell-bash` 携带真实原因（`io-error:shell-bash:[^\s]+`）。

## 测试结果

桌面端 58/58 通过：
- `permission-menu.test.mjs` 15/15（含 Bug1 新增 1 例）
- `tool-card.test.mjs` 3/3（Bug3c 新建）
- `session-state.test.mjs` 14/14（含 Bug4 新增 2 例）
- `turn-poll-state.test.mjs` 7/7（含 Bug5 新增 1 例）
- `msgfold.test.mjs` 19/19（未改动，回归验证）

仓颉端 `request_trace_test.cj` 断言已更新，待构建验证（本轮未跑 `cjpm test`，避免并发争用）。

## 边界

- 不动 ACL、不关沙箱、不提交推送。
- 不改 IPC 面（`preload.cjs` 无变更）。
- 不改安全规则、不降防护。
- 仓颉端改动（`request_trace.cj` / `shlex.cj` / `request_trace_test.cj`）待 `cjpm build` + `cjpm test` 验证。
